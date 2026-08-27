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

  if (/(breaking|urgent|attack|war|missile|guerre|attaque|frappe)/.test(allText)) {
    return 0.8;
  }

  if (/(warning|sanction|protest|election|alerte|sanction|manifestation)/.test(allText)) {
    return 0.45;
  }

  return 0.2;
}

function inferCategory(title: string, summary: string): EventCategory {
  const allText = `${title} ${summary}`.toLowerCase();

  return /(war|attack|missile|military|conflict|guerre|attaque|missile|conflit)/.test(allText)
    ? 'conflict'
    : 'news';
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
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
