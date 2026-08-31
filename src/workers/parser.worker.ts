import { XMLParser } from 'fast-xml-parser';

import type {
  EventCategory,
  NormalizedEvent,
} from '@/core/domain/NormalizedEvent';

type ParseKind = 'usgs-geojson' | 'rss-atom';

interface ParseRequest {
  requestId: string;
  kind: ParseKind;
  sourceId: string;
  payload: string;
  receivedAt: number;
}

const worker = self as unknown as {
  onmessage: ((message: MessageEvent<ParseRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
});

worker.onmessage = (message: MessageEvent<ParseRequest>) => {
  const request = message.data;

  try {
    const events = request.kind === 'usgs-geojson'
      ? parseUsgs(request)
      : parseRss(request);

    worker.postMessage({
      requestId: request.requestId,
      ok: true,
      events,
    });
  } catch (error) {
    worker.postMessage({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : 'Erreur de parsing.',
    });
  }
};

function parseUsgs(request: ParseRequest): NormalizedEvent[] {
  const payload = JSON.parse(request.payload) as {
    features?: Array<{
      id?: string;
      properties?: {
        mag?: number;
        place?: string;
        time?: number;
        url?: string;
        alert?: string;
        sig?: number;
        tsunami?: number;
      };
      geometry?: {
        coordinates?: unknown;
      };
    }>;
  };

  if (!Array.isArray(payload.features)) {
    throw new Error('Flux USGS invalide : features absent.');
  }

  return payload.features.flatMap((feature) => {
    if (!feature.id) {
      return [];
    }

    const properties = feature.properties ?? {};
    const magnitude = Number(properties.mag ?? 0);
    const coordinates = parseCoordinates(feature.geometry?.coordinates);

    return [{
      id: `${request.sourceId}:${feature.id}`,
      sourceId: request.sourceId,
      title: `Séisme M${magnitude.toFixed(1)} — ${properties.place ?? 'Lieu inconnu'}`,
      summary: [
        `Magnitude ${magnitude.toFixed(1)}`,
        properties.alert ? `alerte ${properties.alert}` : '',
        properties.tsunami === 1 ? 'indicateur tsunami' : '',
      ].filter(Boolean).join(' · '),
      timestamp: validTimestamp(properties.time, request.receivedAt),
      severity: calculateSeismicSeverity(
        magnitude,
        properties.alert,
        properties.sig,
      ),
      coordinates,
      category: 'seismic' as const,
      rawUrl: properties.url ?? '',
    }];
  });
}

function parseRss(request: ParseRequest): NormalizedEvent[] {
  const document = xmlParser.parse(request.payload) as Record<string, unknown>;

  const rss = asRecord(document.rss);
  const channel = asRecord(rss?.channel);
  const rssItems = toArray(channel?.item).map(asRecord).filter(isRecord);

  const feed = asRecord(document.feed);
  const atomEntries = toArray(feed?.entry).map(asRecord).filter(isRecord);

  const entries = rssItems.length > 0 ? rssItems : atomEntries;

  return entries.map((entry, index) => {
    const title = text(entry.title) || 'Dépêche sans titre';
    const summary = stripHtml(
      text(entry.description) || text(entry.summary) || text(entry.content),
    );

    const timestamp = parseDate(
      text(entry.pubDate) ||
      text(entry.published) ||
      text(entry.updated),
      request.receivedAt,
    );

    const rawUrl = extractLink(entry);
    const rawId = text(entry.guid) || text(entry.id) || rawUrl || `${timestamp}:${title}:${index}`;

    return {
      id: `${request.sourceId}:${hash(rawId)}`,
      sourceId: request.sourceId,
      title,
      summary: summary.slice(0, 2_000),
      timestamp,
      severity: calculateNewsSeverity(title, summary),
      coordinates: extractCoordinates(entry),
      category: inferCategory(title, summary),
      rawUrl,
    };
  });
}

function calculateSeismicSeverity(
  magnitude: number,
  alert?: string,
  significance?: number,
): number {
  const alertValues: Record<string, number> = {
    green: 0.45,
    yellow: 0.65,
    orange: 0.82,
    red: 1,
  };

  const alertValue = alert ? alertValues[alert.toLowerCase()] : undefined;

  if (alertValue !== undefined) {
    return alertValue;
  }

  const magnitudeValue = Math.min(1, Math.max(0, (magnitude - 2) / 6));
  const significanceValue = significance === undefined
    ? 0
    : Math.min(1, Math.max(0, significance / 1_000));

  return Math.max(magnitudeValue, significanceValue);
}

function calculateNewsSeverity(title: string, summary: string): number {
  const allText = `${title} ${summary}`.toLowerCase();

  if (/(breaking|urgent|attack|war|missile|guerre|attaque|frappe|catastrophe|meurtrier|crash|effondrement|plunge|soars?|crisis|crise)/.test(allText)) {
    return 0.8;
  }

  if (/(warning|sanction|protest|election|alerte|sanction|manifestation|inondation|tempête|tornade|pénurie|rupture|volatil|rate hike|hausse des taux)/.test(allText)) {
    return 0.45;
  }

  return 0.2;
}

/**
 * Moteur d'inférence thématique. Ordre de priorité volontaire : conflit
 * et catastrophe (motifs les plus critiques et les moins ambigus) sont
 * évalués avant les piliers plus généraux, afin de limiter les faux
 * positifs sur du vocabulaire partagé ("crise", "tension").
 *
 * Round 3 : les motifs énergie/finance ont été enrichis de vocabulaire
 * spécifique aux matières premières et aux marchés (WTI, Brent, once
 * d'or, CAC 40, taux directeur…) pour classifier de façon déterministe
 * les flux MarketWatch Commodities et Boursier.com sans avoir à faire
 * transiter un indice de catégorie à travers le protocole du Worker.
 * Le terme français "or" est volontairement exclu des motifs bruts
 * (ambigu avec la conjonction "or") ; seules des locutions composées
 * univoques sont retenues (once d'or, cours de l'or, lingot d'or).
 */
function inferCategory(title: string, summary: string): EventCategory {
  const allText = `${title} ${summary}`.toLowerCase();

  const conflictPattern = /(war|attack|missile|military|conflict|troops|strike|guerre|attaque|missile|conflit|armée|frappe|offensive)/;
  const disasterPattern = /(flood|storm|tornado|wildfire|hurricane|cyclone|drought|eruption|volcano|landslide|inondation|tempête|tornade|incendie|feu de forêt|ouragan|cyclone|sécheresse|éruption|volcan|glissement de terrain|crue)/;
  const spacePattern = /(rocket|satellite|launch|orbit|nasa|spacex|esa|starship|falcon 9|fusée|satellite|lancement|orbite|spatial(e)?|astronaute|iss\b)/;
  const techAiPattern = /(chip|semiconductor|nvidia|artificial intelligence|\bai\b|gpu|processor|puce|semi-conducteur|intelligence artificielle|\bia\b|processeur|algorithme|data center|centre de données)/;
  const energyPattern = /(oil|barrel|opec|pipeline|refinery|natural gas|crude|wti\b|brent\b|commodit(y|ies)|pétrole|baril|opep|pipeline|raffinerie|gaz naturel|énergie|nucléaire|nuclear plant|matières premières|cours du pétrole|cours du gaz|once d'or|lingot d'or|cours de l'or|cuivre|copper|argent métal)/;
  const diplomacyPattern = /(summit|treaty|embassy|ambassador|diplomat|negotiation|sommet|traité|ambassade|diplomat(e|ique)|négociation|accord bilatéral|sanctions? diplomatique)/;
  const financePattern = /(stock market|inflation|central bank|gdp|interest rate|rate hike|forex|currency|wall street|dow jones|nasdaq\b|bourse|inflation|banque centrale|pib\b|taux d'intérêt|taux directeur|marché boursier|marché(s)? financier|obligation(s)? d'état|cac 40|indice boursier|devise)/;

  if (conflictPattern.test(allText)) {
    return 'conflict';
  }

  if (disasterPattern.test(allText)) {
    return 'disaster';
  }

  if (spacePattern.test(allText)) {
    return 'space';
  }

  if (techAiPattern.test(allText)) {
    return 'tech_ai';
  }

  if (energyPattern.test(allText)) {
    return 'energy';
  }

  if (diplomacyPattern.test(allText)) {
    return 'diplomacy';
  }

  if (financePattern.test(allText)) {
    return 'finance';
  }

  return 'news';
}

function extractLink(entry: Record<string, unknown>): string {
  for (const candidate of toArray(entry.link)) {
    if (typeof candidate === 'string') {
      return candidate;
    }

    const item = asRecord(candidate);
    const href = text(item?.['@_href']);

    if (href) {
      return href;
    }
  }

  return '';
}

function extractCoordinates(entry: Record<string, unknown>): [number, number] | null {
  const point = text(entry.point) || text(entry['georss:point']);

  if (point) {
    const values = point.split(/\s+/).map(Number);

    if (
      values.length >= 2 &&
      Number.isFinite(values[0]) &&
      Number.isFinite(values[1]) &&
      Math.abs(values[0]) <= 90 &&
      Math.abs(values[1]) <= 180
    ) {
      return [values[1], values[0]];
    }
  }

  const latitude = Number(entry.lat ?? entry['geo:lat']);
  const longitude = Number(entry.long ?? entry.lon ?? entry['geo:long']);

  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  ) {
    return [longitude, latitude];
  }

  return null;
}

function parseCoordinates(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const longitude = Number(value[0]);
  const latitude = Number(value[1]);

  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  ) {
    return null;
  }

  return [longitude, latitude];
}

function validTimestamp(value: unknown, fallback: number): number {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function parseDate(value: string, fallback: number): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }

  if (isRecord(value)) {
    return text(value['#text'] ?? value.__cdata ?? '');
  }

  return '';
}

function hash(value: string): string {
  let result = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }

  return (result >>> 0).toString(36);
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined || value === null ? [] : [value];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
