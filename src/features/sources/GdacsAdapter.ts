import { httpTransport } from '@/core/net/HttpTransport';
import type { ScheduledTask } from '@/core/net/Scheduler';
import { db } from '@/core/storage/db';
import type {
  AlertLevel,
  EventCategory,
  NormalizedEvent,
} from '@/core/domain/NormalizedEvent';
import { eventStore } from '@/stores/eventStore';

export const GDACS_SOURCE_ID = 'gdacs-alerts';

export const gdacsSource = {
  sourceId: GDACS_SOURCE_ID,
  name: 'GDACS',
  url: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH',
  freshnessTargetMs: 10 * 60 * 1_000,
  // Transport natif : contrairement à USGS, GDACS n'annonce pas
  // explicitement le support CORS pour les requêtes navigateur. Le
  // transport Capacitor natif contourne ce risque sans dépendre d'un
  // proxy.
  transport: 'native' as const,
  priority: 90,
};

const EVENT_TYPE_CATEGORY: Record<string, EventCategory> = {
  EQ: 'seismic',
  VO: 'volcanic',
  WF: 'wildfire',
  FL: 'flood',
  TC: 'storm',
  DR: 'disaster',
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  EQ: 'Séisme',
  VO: 'Éruption volcanique',
  WF: 'Feu de forêt',
  FL: 'Inondation',
  TC: 'Cyclone tropical',
  DR: 'Sécheresse',
};

const ALERT_SEVERITY: Record<AlertLevel, number> = {
  green: 0.35,
  orange: 0.65,
  red: 0.9,
};

interface GdacsFeature {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: {
    eventtype?: string;
    eventid?: number;
    episodeid?: number;
    name?: string;
    description?: string;
    alertlevel?: string;
    country?: string;
    fromdate?: string;
    todate?: string;
    iso3?: string;
    source?: string;
    url?: { report?: string };
    severitydata?: { severitytext?: string };
  };
}

interface GdacsResponse {
  type?: string;
  features?: GdacsFeature[];
}

export function createGdacsTask(): ScheduledTask<void> {
  return {
    id: GDACS_SOURCE_ID,
    priority: gdacsSource.priority,

    run: async (signal) => {
      const store = eventStore.getState();
      store.setSourceStatus(GDACS_SOURCE_ID, 'loading');

      const metadata = await db.source_metadata.get(GDACS_SOURCE_ID);

      const response = await httpTransport.get({
        url: gdacsSource.url,
        transport: gdacsSource.transport,
        etag: metadata?.etag,
        lastModified: metadata?.lastModified,
        signal,
        timeoutMs: 20_000,
      });

      if (response.notModified) {
        await db.recordSourceSuccess(GDACS_SOURCE_ID, {
          etag: metadata?.etag,
          lastModified: metadata?.lastModified,
        });

        store.setSourceStatus(GDACS_SOURCE_ID, 'ready');
        return;
      }

      if (!response.ok) {
        throw new Error(`GDACS HTTP ${response.status}`);
      }

      const events = parseGdacsPayload(response.bodyText);

      await db.upsertEvents(events);

      await db.recordSourceSuccess(GDACS_SOURCE_ID, {
        etag: response.etag,
        lastModified: response.lastModified,
      });

      await db.purgeEventsOlderThan();

      store.upsertEvents(events);
      store.setSourceStatus(GDACS_SOURCE_ID, 'ready');
    },

    onError: async () => {
      await db.recordSourceFailure(GDACS_SOURCE_ID);
      eventStore.getState().setSourceStatus(GDACS_SOURCE_ID, 'error');
    },
  };
}

function parseGdacsPayload(bodyText: string): NormalizedEvent[] {
  let payload: GdacsResponse;

  try {
    payload = JSON.parse(bodyText) as GdacsResponse;
  } catch {
    throw new Error('Réponse GDACS invalide : JSON illisible.');
  }

  if (!Array.isArray(payload.features)) {
    throw new Error('Réponse GDACS invalide : liste de features absente.');
  }

  return payload.features.flatMap((feature) => {
    const properties = feature.properties;

    if (!properties?.eventtype || properties.eventid === undefined) {
      return [];
    }

    const coordinates = parsePointCoordinates(feature.geometry?.coordinates);
    const category = EVENT_TYPE_CATEGORY[properties.eventtype] ?? 'disaster';
    const alertLevel = normalizeAlertLevel(properties.alertlevel);
    const severity = alertLevel ? ALERT_SEVERITY[alertLevel] : 0.5;
    const typeLabel = EVENT_TYPE_LABEL[properties.eventtype] ?? 'Catastrophe';
    const zoneLabel = properties.country ?? properties.name ?? 'Zone non précisée';
    const title = `${typeLabel} — ${zoneLabel}`;

    const summaryParts = [
      properties.severitydata?.severitytext,
      properties.description && properties.description !== properties.name
        ? properties.description
        : '',
    ].filter((part): part is string => Boolean(part && part.trim().length > 0));

    const startTime = parseGdacsDate(properties.fromdate);

    const event: NormalizedEvent = {
      id: `${GDACS_SOURCE_ID}:${properties.eventtype}:${properties.eventid}`,
      sourceId: GDACS_SOURCE_ID,
      title,
      summary: summaryParts.join(' · ').slice(0, 2_000),
      timestamp: startTime,
      severity,
      coordinates,
      category,
      rawUrl: properties.url?.report ?? '',
      alertLevel,
      sourceLabel: properties.source ?? 'GDACS',
      countryLabel: properties.country,
      startTime,
      endTime: properties.todate ? parseGdacsDate(properties.todate) : undefined,
      polygon: null,
    };

    return [event];
  });
}

function parsePointCoordinates(value: unknown): [number, number] | null {
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

function normalizeAlertLevel(value: string | undefined): AlertLevel | undefined {
  const normalized = value?.toLowerCase();

  return normalized === 'green' || normalized === 'orange' || normalized === 'red'
    ? normalized
    : undefined;
}

function parseGdacsDate(value: string | undefined): number {
  if (!value) {
    return Date.now();
  }

  const isoCandidate = value.endsWith('Z') ? value : `${value}Z`;
  const timestamp = Date.parse(isoCandidate);

  return Number.isFinite(timestamp) ? timestamp : Date.now();
}
