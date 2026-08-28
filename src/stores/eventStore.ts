import { create } from 'zustand';

import type {
  EventCategory,
  NormalizedEvent,
} from '@/core/domain/NormalizedEvent';
import { db } from '@/core/storage/db';

export type SourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export type MapLayerId =
  | 'layer-seismic'
  | 'layer-weather'
  | 'layer-news'
  | 'layer-infra';

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
 * Table de routage catégorie → couche MapLibre dédiée (Round 2/3).
 * `null` signifie que la catégorie n'est pour l'instant portée par aucune
 * des couches dynamiques (cas de `infrastructure`, réservé à un futur flux
 * d'incidents dédié plutôt qu'à la couche statique `layer-infra`, qui elle
 * n'est jamais alimentée depuis Dexie/Zustand).
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
};

const DYNAMIC_LAYER_IDS: Exclude<MapLayerId, 'layer-infra'>[] = [
  'layer-seismic',
  'layer-weather',
  'layer-news',
];

interface EventStore {
  eventsById: Record<string, NormalizedEvent>;
  filters: EventFilters;
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

  // Cas simple, sans déroulement à l'antiméridien : suffisant pour un
  // tableau de bord tactique généraliste ; documenté comme limite connue.
  if (west <= east) {
    return longitude >= west && longitude <= east;
  }

  return longitude >= west || longitude <= east;
}

export const useEventStore = create<EventStore>()((set, get) => ({
  eventsById: {},
  filters: {
    minimumSeverity: 0,
  },
  activeLayers: {
    'layer-seismic': true,
    'layer-weather': true,
    'layer-news': true,
    'layer-infra': false,
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

      set({
        eventsById: Object.fromEntries(events.map((event) => [event.id, event])),
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
    set((state) => {
      const eventsById = { ...state.eventsById };

      for (const event of events) {
        eventsById[event.id] = event;
      }

      return { eventsById };
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
    const { eventsById, filters, activeLayers } = get();

    return Object.values(eventsById)
      .filter((event) => {
        const layerId = CATEGORY_TO_LAYER[event.category];
        return layerId !== null && activeLayers[layerId];
      })
      .filter((event) => event.severity >= filters.minimumSeverity)
      .sort((a, b) => b.timestamp - a.timestamp);
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
export { DYNAMIC_LAYER_IDS };
