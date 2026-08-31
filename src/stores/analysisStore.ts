import { create } from 'zustand';

import type { EventCategory, NormalizedEvent } from '@/core/domain/NormalizedEvent';
import type { DetectedCrisis } from '@/core/analysis/crisisPatterns';
import { boundsFromCircle } from '@/core/analysis/crisisPatterns';
import {
  CATEGORY_TO_LAYER,
  DYNAMIC_LAYER_IDS,
  eventStore,
  useEventStore,
} from '@/stores/eventStore';

interface CorrelationRequestMessage {
  requestId: string;
  events: NormalizedEvent[];
  now: number;
}

interface CorrelationResponseMessage {
  requestId: string;
  crises: DetectedCrisis[];
  globalTensionIndex: number;
}

export interface CrisisFocusRequest {
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  bounds: [number, number, number, number];
  label: string;
  nonce: number;
}

interface AnalysisStore {
  crises: DetectedCrisis[];
  globalTensionIndex: number;
  selectedCrisisId: string | null;
  isComputing: boolean;
  lastComputedAt: number | null;
  focusRequest: CrisisFocusRequest | null;

  recompute: () => void;
  selectCrisis: (id: string | null) => void;
  focusCrisis: (id: string) => void;
  clearFocus: () => void;
}

let correlationWorker: Worker | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let requestSequence = 0;

function getWorker(): Worker {
  if (!correlationWorker) {
    correlationWorker = new Worker(
      new URL('../workers/correlation.worker.ts', import.meta.url),
      { type: 'module' },
    );

    correlationWorker.onmessage = (message: MessageEvent<CorrelationResponseMessage>) => {
      const { crises, globalTensionIndex } = message.data;

      useAnalysisStore.setState({
        crises,
        globalTensionIndex,
        isComputing: false,
        lastComputedAt: Date.now(),
      });
    };

    correlationWorker.onerror = () => {
      useAnalysisStore.setState({ isComputing: false });
    };
  }

  return correlationWorker;
}

export const useAnalysisStore = create<AnalysisStore>()((set, get) => ({
  crises: [],
  globalTensionIndex: 0,
  selectedCrisisId: null,
  isComputing: false,
  lastComputedAt: null,
  focusRequest: null,

  recompute: () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      set({ isComputing: true });

      const requestId = String(requestSequence++);
      const events = Object.values(eventStore.getState().eventsById);

      const request: CorrelationRequestMessage = {
        requestId,
        events,
        now: Date.now(),
      };

      getWorker().postMessage(request);
    }, 800);
  },

  selectCrisis: (id) => set({ selectedCrisisId: id }),

  focusCrisis: (id) => {
    const crisis = get().crises.find((entry) => entry.id === id);

    if (!crisis) {
      return;
    }

    const eventsById = eventStore.getState().eventsById;
    const involvedLayers = new Set<string>();

    for (const eventId of crisis.eventIds) {
      const event = eventsById[eventId];

      if (!event) {
        continue;
      }

      const layerId = CATEGORY_TO_LAYER[event.category as EventCategory];

      if (layerId) {
        involvedLayers.add(layerId);
      }
    }

    for (const layerId of DYNAMIC_LAYER_IDS) {
      eventStore.getState().setLayerActive(layerId, involvedLayers.has(layerId));
    }

    set((state) => ({
      selectedCrisisId: id,
      focusRequest: {
        centerLatitude: crisis.centerLatitude,
        centerLongitude: crisis.centerLongitude,
        radiusKm: crisis.radiusKm,
        bounds: boundsFromCircle(
          crisis.centerLatitude,
          crisis.centerLongitude,
          crisis.radiusKm,
        ),
        label: crisis.label,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  clearFocus: () => set({ focusRequest: null }),
}));

export const analysisStore = useAnalysisStore;

// Recalcule la corrélation à chaque mutation du store d'évènements
// (arrivée de nouvelles données de sync). Le débounce interne à
// `recompute` absorbe les rafales d'upsert successifs.
useEventStore.subscribe(() => {
  useAnalysisStore.getState().recompute();
});
