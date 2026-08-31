import { db } from '@/core/storage/db';

const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

// MyMemory limite chaque requête à 500 octets pour le paramètre `q` et
// impose un quota anonyme de 5 000 caractères/jour par IP. On se garde
// une marge (450 octets par segment, 4 500 caractères/jour) pour ne
// jamais heurter la limite exacte et provoquer un rejet brutal.
const MAX_CHUNK_BYTES = 450;
const DAILY_CHAR_BUDGET = 4_500;
const QUOTA_STORAGE_KEY = 'wm-translate-quota-v1';
const MAX_CONCURRENT_REQUESTS = 2;

export interface TranslationResult {
  text: string;
  translated: boolean;
}

/**
 * Corrections déterministes appliquées après la traduction automatique,
 * pour les sigles/acronymes tactiques et financiers que les moteurs de
 * traduction gratuits laissent souvent inchangés ou traduisent de façon
 * incohérente (ex : "OPEC" au lieu de "OPEP").
 */
const TACTICAL_DICTIONARY: Array<[RegExp, string]> = [
  [/\bOPEC\b/gi, 'OPEP'],
  [/\bGDP\b/gi, 'PIB'],
  [/\bNATO\b/gi, 'OTAN'],
  [/\bUN\b/g, 'ONU'],
  [/\bEU\b/g, 'UE'],
  [/\bIMF\b/gi, 'FMI'],
  [/\bWHO\b/g, 'OMS'],
  [/\bCEO\b/gi, 'PDG'],
  [/\bIPO\b/gi, 'IPO'],
  [/\bbarrels?\b/gi, 'barils'],
  [/\bbpd\b/gi, 'bpj'],
  [/\by\/y\b/gi, 'sur un an'],
  [/\bq\/q\b/gi, 'sur un trimestre'],
];

let activeRequests = 0;
const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests += 1;
    return;
  }

  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activeRequests += 1;
}

function releaseSlot(): void {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = waitQueue.shift();
  next?.();
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readQuota(): { date: string; charsUsed: number } {
  try {
    const raw = localStorage.getItem(QUOTA_STORAGE_KEY);

    if (!raw) {
      return { date: todayKey(), charsUsed: 0 };
    }

    const parsed = JSON.parse(raw) as { date: string; charsUsed: number };

    if (parsed.date !== todayKey()) {
      return { date: todayKey(), charsUsed: 0 };
    }

    return parsed;
  } catch {
    return { date: todayKey(), charsUsed: 0 };
  }
}

function writeQuota(charsUsed: number): void {
  try {
    localStorage.setItem(
      QUOTA_STORAGE_KEY,
      JSON.stringify({ date: todayKey(), charsUsed }),
    );
  } catch {
    // Stockage indisponible (navigation privée, quota plein) : on
    // dégrade silencieusement plutôt que d'interrompre l'application.
  }
}

function hasQuotaFor(length: number): boolean {
  const quota = readQuota();
  return quota.charsUsed + length <= DAILY_CHAR_BUDGET;
}

function consumeQuota(length: number): void {
  const quota = readQuota();
  writeQuota(quota.charsUsed + length);
}

function hashText(value: string): string {
  let result = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }

  return (result >>> 0).toString(36);
}

function splitIntoChunks(text: string, maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current + word;

    if (encoder.encode(candidate).length > maxBytes && current.trim().length > 0) {
      chunks.push(current.trim());
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

function applyDictionary(text: string): string {
  let result = text;

  for (const [pattern, replacement] of TACTICAL_DICTIONARY) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

async function translateChunk(chunk: string): Promise<string> {
  const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(chunk)}&langpair=en|fr`;

  await acquireSlot();

  try {
    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) {
      throw new Error(`MyMemory HTTP ${response.status}`);
    }

    const payload = await response.json() as {
      responseData?: { translatedText?: string };
      responseStatus?: number | string;
    };

    const status = Number(payload.responseStatus ?? 200);

    if (Number.isFinite(status) && status >= 400) {
      throw new Error(`MyMemory statut ${status}`);
    }

    return payload.responseData?.translatedText ?? chunk;
  } finally {
    releaseSlot();
  }
}

/**
 * Traduit un texte anglais vers le français avec cache Dexie indexé par
 * hash du texte source, budget quotidien anti-dépassement de quota, et
 * parallélisme limité à deux requêtes simultanées.
 *
 * Aucun appel n'est jamais bloquant pour le thread principal : le réseau
 * est intrinsèquement asynchrone, et tout échec (HTTP, quota épuisé,
 * réseau indisponible) retombe silencieusement sur le texte original
 * plutôt que de lever une erreur visible.
 */
export async function translateToFrench(text: string): Promise<TranslationResult> {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { text, translated: false };
  }

  const hash = hashText(trimmed);

  try {
    const cached = await db.translations.get(hash);

    if (cached) {
      return { text: cached.translatedText, translated: true };
    }
  } catch {
    // Cache indisponible (Dexie non initialisé) : on retente quand même
    // la traduction réseau, simplement sans bénéficier du cache.
  }

  if (!hasQuotaFor(trimmed.length)) {
    return { text, translated: false };
  }

  try {
    const chunks = splitIntoChunks(trimmed, MAX_CHUNK_BYTES);
    const translatedChunks = await Promise.all(chunks.map(translateChunk));
    const rawTranslated = translatedChunks.join(' ');
    const translatedText = applyDictionary(rawTranslated);

    consumeQuota(trimmed.length);

    await db.translations.put({
      hash,
      sourceText: trimmed,
      translatedText,
      sourceLang: 'en',
      targetLang: 'fr',
      cachedAt: Date.now(),
    });

    return { text: translatedText, translated: true };
  } catch {
    return { text, translated: false };
  }
}
