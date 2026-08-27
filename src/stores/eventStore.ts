import { create } from 'zustand';

import type {
  EventCategory,
  NormalizedEvent,
} from '@/core/domain/NormalizedEvent';
import { db } from '@/core/storage/db';

export type SourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EventFilters {
  categories: EventCategory[];
  minimumSeverity: number;
}

export interface EventGeoJson extends GeoJSON.FeatureCollection<
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

interface EventStore {
  eventsById: Record<string, NormalizedEvent>;
  filters: EventFilters;
  sourceStatus: Record<string, SourceStatus>;
  selectedEventId: string | null;
  hydrated: boolean;
  hydrationError: string | null;

  hydrateFromCache: () => Promise<void>;
  upsertEvents: (events: NormalizedEvent[]) => void;
  setFilters: (filters: Partial<EventFilters>) => void;
  setSourceStatus: (sourceId: string, status: SourceStatus) => void;
  selectEvent: (eventId: string | null) => void;
  getFilteredEvents: () => NormalizedEvent[];
  getGeoJson: () => EventGeoJson;
}

export const useEventStore = create<EventStore>()((set, get) => ({
  eventsById: {},
  filters: {
    categories: ['seismic', 'conflict', 'news'],
    minimumSeverity: 0,
  },
  sourceStatus: {},
  selectedEventId: null,
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

  getFilteredEvents: () => {
    const { eventsById, filters } = get();

    return Object.values(eventsById)
      .filter((event) => filters.categories.includes(event.category))
      .filter((event) => event.severity >= filters.minimumSeverity)
      .sort((a, b) => b.timestamp - a.timestamp);
  },

  getGeoJson: () => ({
    type: 'FeatureCollection',
    features: get().getFilteredEvents().flatMap((event) => {
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
  }),
}));

export const eventStore = useEventStore;
