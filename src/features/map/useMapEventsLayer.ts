import { useEffect } from 'react';
import type {
  GeoJSONSource,
  Map,
  MapLayerMouseEvent,
} from 'maplibre-gl';

import {
  DYNAMIC_LAYER_IDS,
  eventStore,
  useEventStore,
  type MapLayerId,
} from '@/stores/eventStore';

const EVENT_SOURCE_IDS: Record<Exclude<MapLayerId, 'layer-infra'>, string> = {
  'layer-seismic': 'source-seismic',
  'layer-weather': 'source-weather',
  'layer-news': 'source-news',
};

const CLUSTER_LAYER_SUFFIX = '-clusters';
const CLUSTER_COUNT_SUFFIX = '-cluster-count';
const POINT_LAYER_SUFFIX = '-points';

const INFRA_SOURCE_ID = 'source-infra';
const INFRA_LAYER_ID = 'layer-infra';
const INFRA_DATA_URL = '/data/critical-infrastructure.geojson';

const LAYER_PAINT: Record<
  Exclude<MapLayerId, 'layer-infra'>,
  { clusterColor: string; pointColor: string }
> = {
  'layer-seismic': { clusterColor: '#f2994a', pointColor: '#f2994a' },
  'layer-weather': { clusterColor: '#9b51e0', pointColor: '#9b51e0' },
  'layer-news': { clusterColor: '#2f80ed', pointColor: '#2f80ed' },
};

function ensureEventLayer(map: Map, layerId: Exclude<MapLayerId, 'layer-infra'>): void {
  const sourceId = EVENT_SOURCE_IDS[layerId];
  const clusterLayerId = `${layerId}${CLUSTER_LAYER_SUFFIX}`;
  const clusterCountLayerId = `${layerId}${CLUSTER_COUNT_SUFFIX}`;
  const pointLayerId = `${layerId}${POINT_LAYER_SUFFIX}`;
  const palette = LAYER_PAINT[layerId];

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 8,
      clusterRadius: 46,
    });
  }

  if (!map.getLayer(clusterLayerId)) {
    map.addLayer({
      id: clusterLayerId,
      type: 'circle',
      source: sourceId,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': palette.clusterColor,
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          16,
          10, 23,
          50, 32,
        ],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
  }

  if (!map.getLayer(clusterCountLayerId)) {
    map.addLayer({
      id: clusterCountLayerId,
      type: 'symbol',
      source: sourceId,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 12,
      },
      paint: {
        'text-color': '#07111f',
      },
    });
  }

  if (!map.getLayer(pointLayerId)) {
    map.addLayer({
      id: pointLayerId,
      type: 'circle',
      source: sourceId,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['get', 'severity'],
          0, 5,
          0.3, 8,
          0.6, 13,
          1, 19,
        ],
        'circle-color': palette.pointColor,
        'circle-opacity': 0.92,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.3,
      },
    });
  }
}

function ensureInfraLayer(map: Map): void {
  if (!map.getSource(INFRA_SOURCE_ID)) {
    map.addSource(INFRA_SOURCE_ID, {
      type: 'geojson',
      data: INFRA_DATA_URL,
    });
  }

  if (!map.getLayer(INFRA_LAYER_ID)) {
    map.addLayer({
      id: INFRA_LAYER_ID,
      type: 'circle',
      source: INFRA_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': '#2ecc71',
        'circle-opacity': 0.9,
        'circle-stroke-color': '#07111f',
        'circle-stroke-width': 1.5,
      },
    });
  }
}

function applyLayerVisibility(map: Map, layerId: MapLayerId, active: boolean): void {
  const visibility = active ? 'visible' : 'none';

  if (layerId === 'layer-infra') {
    if (map.getLayer(INFRA_LAYER_ID)) {
      map.setLayoutProperty(INFRA_LAYER_ID, 'visibility', visibility);
    }
    return;
  }

  const clusterLayerId = `${layerId}${CLUSTER_LAYER_SUFFIX}`;
  const clusterCountLayerId = `${layerId}${CLUSTER_COUNT_SUFFIX}`;
  const pointLayerId = `${layerId}${POINT_LAYER_SUFFIX}`;

  for (const id of [clusterLayerId, clusterCountLayerId, pointLayerId]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visibility);
    }
  }
}

function syncLayers(map: Map): void {
  if (!map.isStyleLoaded()) {
    map.once('load', () => syncLayers(map));
    return;
  }

  const { activeLayers } = eventStore.getState();

  for (const layerId of DYNAMIC_LAYER_IDS) {
    ensureEventLayer(map, layerId);

    const sourceId = EVENT_SOURCE_IDS[layerId];
    const source = map.getSource(sourceId);

    if (source?.type === 'geojson') {
      (source as GeoJSONSource).setData(eventStore.getState().getLayerGeoJson(layerId));
    }

    applyLayerVisibility(map, layerId, activeLayers[layerId] ?? true);
  }

  // Couche statique paresseuse : on ne crée la source/layer qu'à la
  // première activation par l'utilisateur (Round 1 — cold-start).
  if (activeLayers['layer-infra']) {
    ensureInfraLayer(map);
  }

  if (map.getLayer(INFRA_LAYER_ID)) {
    applyLayerVisibility(map, 'layer-infra', activeLayers['layer-infra'] ?? false);
  }
}

function pointLayerIds(): string[] {
  return DYNAMIC_LAYER_IDS.map((layerId) => `${layerId}${POINT_LAYER_SUFFIX}`);
}

function clusterLayerIds(): string[] {
  return DYNAMIC_LAYER_IDS.map((layerId) => `${layerId}${CLUSTER_LAYER_SUFFIX}`);
}

export function restoreEventsLayer(map: Map): void {
  syncLayers(map);
}

export function useMapEventsLayer(map: Map | null): void {
  const eventsById = useEventStore((state) => state.eventsById);
  const activeLayers = useEventStore((state) => state.activeLayers);
  const filters = useEventStore((state) => state.filters);

  useEffect(() => {
    if (!map) {
      return;
    }

    const selectEvent = eventStore.getState().selectEvent;

    const handlePointClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const id = String(feature?.properties?.id ?? '');

      if (id) {
        selectEvent(id);
      }
    };

    const handleClusterClick = async (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];

      if (!feature || feature.geometry.type !== 'Point') {
        return;
      }

      const sourceId = feature.layer?.source;
      const clusterId = Number(feature.properties?.cluster_id);

      if (!sourceId || !Number.isFinite(clusterId)) {
        return;
      }

      const source = map.getSource(sourceId);

      if (source?.type !== 'geojson') {
        return;
      }

      const zoom = await (source as GeoJSONSource).getClusterExpansionZoom(clusterId);
      const coordinates = feature.geometry.coordinates as [number, number];

      map.easeTo({ center: coordinates, zoom, duration: 350 });
    };

    const setPointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };

    const clearPointer = () => {
      map.getCanvas().style.cursor = '';
    };

    const restore = () => syncLayers(map);

    syncLayers(map);

    const pointIds = pointLayerIds();
    const clusterIds = clusterLayerIds();

    for (const layerId of pointIds) {
      map.on('click', layerId, handlePointClick);
      map.on('mouseenter', layerId, setPointer);
      map.on('mouseleave', layerId, clearPointer);
    }

    for (const layerId of clusterIds) {
      map.on('click', layerId, handleClusterClick);
      map.on('mouseenter', layerId, setPointer);
      map.on('mouseleave', layerId, clearPointer);
    }

    map.on('webglcontextrestored', restore);

    return () => {
      for (const layerId of pointIds) {
        map.off('click', layerId, handlePointClick);
        map.off('mouseenter', layerId, setPointer);
        map.off('mouseleave', layerId, clearPointer);
      }

      for (const layerId of clusterIds) {
        map.off('click', layerId, handleClusterClick);
        map.off('mouseenter', layerId, setPointer);
        map.off('mouseleave', layerId, clearPointer);
      }

      map.off('webglcontextrestored', restore);
    };
  }, [map]);

  useEffect(() => {
    if (map) {
      syncLayers(map);
    }
  }, [map, eventsById, activeLayers, filters]);
}
