import { create } from 'zustand';

import type {
  EventCategory,
  NormalizedEvent,
  TimeFilter,
} from '@/core/domain/NormalizedEvent';
import { db } from '@/core/storage/db';

export type SourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export type MapLayerId =
  | 'layer-seismic'
  | 'layer-weather'
  | 'layer-news'
  | 'layer-infra'
  | 'layer-energy'
  | 'layer-finance'
  | 'layer-diplomacy'
  | 'layer-tech'
  | 'layer-space';

export type BoundsTuple = [west: number, south: number, east: number, north: number];

export interface EventFilters {
  minimumSeverity: number;
}

export interface FlyToRequest {
  eventId: string;
  coordinates: [number, number];
  zoom?: number;
  nonce: number;
}

export interface LayerGeoJson extends GeoJSON.FeatureCollection<
  GeoJSON.Point,
  {
    id: string;
    sourceId: string;
    title: string;
    summary: string;
    timestamp: number;
    severity: number;
    category: EventCategory;
    rawUrl: string;
  }
> {}

/**
 * Table de routage catégorie → couche MapLibre dédiée. Point unique de
 * vérité partagé par le store, le hook carte et le tableau de bord — un
 * futur pilier ne nécessite qu'une entrée ici, jamais de nouveau type.
 */
export const CATEGORY_TO_LAYER: Record<EventCategory, MapLayerId | null> = {
  seismic: 'layer-seismic',
  volcanic: 'layer-seismic',
  wildfire: 'layer-weather',
  flood: 'layer-weather',
  storm: 'layer-weather',
  disaster: 'layer-weather',
  conflict: 'layer-news',
  news: 'layer-news',
  infrastructure: null,
  energy: 'layer-energy',
  finance: 'layer-finance',
  diplomacy: 'layer-diplomacy',
  tech_ai: 'layer-tech',
  space: 'layer-space',
};

export const DYNAMIC_LAYER_IDS: Exclude<MapLayerId, 'layer-infra'>[] = [
  'layer-seismic',
  'layer-weather',
  'layer-news',
  'layer-energy',
  'layer-finance',
  'layer-diplomacy',
  'layer-tech',
  'layer-space',
];

const TIME_FILTER_MS: Record<TimeFilter, number | null> = {
  '3d': 3 * 24 * 60 * 60 * 1_000,
  '10d': 10 * 24 * 60 * 60 * 1_000,
  '30d': 30 * 24 * 60 * 60 * 1_000,
  all: null,
};

interface EventStore {
  eventsById: Record<string, NormalizedEvent>;
  /** Ids triés par timestamp décroissant, recalculé uniquement lors des
   *  écritures de données (sync), jamais lors des interactions de filtre. */
  orderedIds: string[];
  filters: EventFilters;
  timeFilter: TimeFilter;
  activeLayers: Record<MapLayerId, boolean>;
  visibleBounds: BoundsTuple | null;
  viewportFilterEnabled: boolean;
  sourceStatus: Record<string, SourceStatus>;
  selectedEventId: string | null;
  flyToRequest: FlyToRequest | null;
  hydrated: boolean;
  hydrationError: string | null;

  hydrateFromCache: () => Promise<void>;
  upsertEvents: (events: NormalizedEvent[]) => void;
  setFilters: (filters: Partial<EventFilters>) => void;
  setTimeFilter: (timeFilter: TimeFilter) => void;
  setSourceStatus: (sourceId: string, status: SourceStatus) => void;
  selectEvent: (eventId: string | null) => void;
  toggleLayer: (layerId: MapLayerId) => void;
  setLayerActive: (layerId: MapLayerId, active: boolean) => void;
  setVisibleBounds: (bounds: BoundsTuple) => void;
  toggleViewportFilter: () => void;
  requestFlyTo: (eventId: string, zoom?: number) => void;
  clearFlyToRequest: () => void;
  getListEvents: () => NormalizedEvent[];
  getVisibleListEvents: () => NormalizedEvent[];
  getLayerGeoJson: (layerId: Exclude<MapLayerId, 'layer-infra'>) => LayerGeoJson;
}

function isWithinBounds(
  coordinates: [number, number],
  bounds: BoundsTuple,
): boolean {
  const [west, south, east, north] = bounds;
  const [longitude, latitude] = coordinates;

  if (latitude < south || latitude > north) {
    return false;
  }

  if (west <= east) {
    return longitude >= west && longitude <= east;
  }

  return longitude >= west || longitude <= east;
}

function buildOrderedIds(eventsById: Record<string, NormalizedEvent>): string[] {
  return Object.keys(eventsById).sort(
    (a, b) => eventsById[b].timestamp - eventsById[a].timestamp,
  );
}

/**
 * Recherche binaire de la frontière de coupure temporelle sur un tableau
 * d'ids déjà triés par timestamp décroissant. Retourne l'index du premier
 * id dont le timestamp est strictement antérieur au seuil : slice(0, index)
 * donne alors tous les évènements récents en O(log n), sans balayage
 * linéaire complet à chaque changement de filtre.
 */
function findCutoffIndex(
  orderedIds: string[],
  eventsById: Record<string, NormalizedEvent>,
  cutoffTimestamp: number,
): number {
  let low = 0;
  let high = orderedIds.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    const event = eventsById[orderedIds[mid]];

    if (event.timestamp >= cutoffTimestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

export const useEventStore = create<EventStore>()((set, get) => ({
  eventsById: {},
  orderedIds: [],
  filters: {
    minimumSeverity: 0,
  },
  timeFilter: 'all',
  activeLayers: {
    'layer-seismic': true,
    'layer-weather': true,
    'layer-news': true,
    'layer-infra': false,
    'layer-energy': true,
    'layer-finance': true,
    'layer-diplomacy': true,
    'layer-tech': true,
    'layer-space': true,
  },
  visibleBounds: null,
  viewportFilterEnabled: false,
  sourceStatus: {},
  selectedEventId: null,
  flyToRequest: null,
  hydrated: false,
  hydrationError: null,

  hydrateFromCache: async () => {
    try {
      const events = await db.events.orderBy('timestamp').reverse().toArray();
      const eventsById = Object.fromEntries(events.map((event) => [event.id, event]));

      set({
        eventsById,
        // Déjà trié par la requête Dexie : simple projection, pas de tri.
        orderedIds: events.map((event) => event.id),
        hydrated: true,
        hydrationError: null,
      });
    } catch (error) {
      set({
        hydrated: true,
        hydrationError: error instanceof Error
          ? error.message
          : 'Erreur de lecture du snapshot local.',
      });
    }
  },

  upsertEvents: (events) => {
    if (events.length === 0) {
      return;
    }

    set((state) => {
      const eventsById = { ...state.eventsById };
      let structureChanged = false;

      for (const event of events) {
        const existing = eventsById[event.id];

        if (!existing || existing.timestamp !== event.timestamp) {
          structureChanged = true;
        }

        eventsById[event.id] = event;
      }

      return {
        eventsById,
        orderedIds: structureChanged ? buildOrderedIds(eventsById) : state.orderedIds,
      };
    });
  },

  setFilters: (filters) => {
    set((state) => ({
      filters: {
        ...state.filters,
        ...filters,
        minimumSeverity: Math.min(
          1,
          Math.max(0, filters.minimumSeverity ?? state.filters.minimumSeverity),
        ),
      },
    }));
  },

  setTimeFilter: (timeFilter) => set({ timeFilter }),

  setSourceStatus: (sourceId, status) => {
    set((state) => ({
      sourceStatus: {
        ...state.sourceStatus,
        [sourceId]: status,
      },
    }));
  },

  selectEvent: (eventId) => set({ selectedEventId: eventId }),

  toggleLayer: (layerId) => {
    set((state) => ({
      activeLayers: {
        ...state.activeLayers,
        [layerId]: !state.activeLayers[layerId],
      },
    }));
  },

  setLayerActive: (layerId, active) => {
    set((state) => ({
      activeLayers: {
        ...state.activeLayers,
        [layerId]: active,
      },
    }));
  },

  setVisibleBounds: (bounds) => set({ visibleBounds: bounds }),

  toggleViewportFilter: () => {
    set((state) => ({ viewportFilterEnabled: !state.viewportFilterEnabled }));
  },

  requestFlyTo: (eventId, zoom) => {
    const event = get().eventsById[eventId];

    if (!event?.coordinates) {
      return;
    }

    set((state) => ({
      selectedEventId: eventId,
      flyToRequest: {
        eventId,
        coordinates: event.coordinates as [number, number],
        zoom,
        nonce: (state.flyToRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  clearFlyToRequest: () => set({ flyToRequest: null }),

  getListEvents: () => {
    const { eventsById, orderedIds, filters, activeLayers, timeFilter } = get();
    const cutoffMs = TIME_FILTER_MS[timeFilter];
    const cutoffTimestamp = cutoffMs === null ? null : Date.now() - cutoffMs;

    const relevantIds = cutoffTimestamp === null
      ? orderedIds
      : orderedIds.slice(0, findCutoffIndex(orderedIds, eventsById, cutoffTimestamp));

    const results: NormalizedEvent[] = [];

    for (const id of relevantIds) {
      const event = eventsById[id];

      if (!event) {
        continue;
      }

      const layerId = CATEGORY_TO_LAYER[event.category];

      if (layerId === null || !activeLayers[layerId]) {
        continue;
      }

      if (event.severity < filters.minimumSeverity) {
        continue;
      }

      results.push(event);
    }

    return results;
  },

  getVisibleListEvents: () => {
    const { visibleBounds, viewportFilterEnabled } = get();
    const listEvents = get().getListEvents();

    if (!viewportFilterEnabled || !visibleBounds) {
      return listEvents;
    }

    return listEvents.filter(
      (event) => event.coordinates !== null &&
        isWithinBounds(event.coordinates, visibleBounds),
    );
  },

  getLayerGeoJson: (layerId) => {
    const { eventsById, filters } = get();

    return {
      type: 'FeatureCollection',
      features: Object.values(eventsById)
        .filter((event) => CATEGORY_TO_LAYER[event.category] === layerId)
        .filter((event) => event.severity >= filters.minimumSeverity)
        .flatMap((event) => {
          if (!event.coordinates) {
            return [];
          }

          return [{
            type: 'Feature' as const,
            id: event.id,
            geometry: {
              type: 'Point' as const,
              coordinates: event.coordinates,
            },
            properties: {
              id: event.id,
              sourceId: event.sourceId,
              title: event.title,
              summary: event.summary,
              timestamp: event.timestamp,
              severity: event.severity,
              category: event.category,
              rawUrl: event.rawUrl,
            },
          }];
        }),
    };
  },
}));

export const eventStore = useEventStore;
