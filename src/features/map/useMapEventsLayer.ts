import { useEffect } from 'react';
import type {
  GeoJSONSource,
  Map,
  MapLayerMouseEvent,
} from 'maplibre-gl';

import { eventStore, useEventStore } from '@/stores/eventStore';

const SOURCE_ID = 'events-source';
const CLUSTER_LAYER_ID = 'events-clusters';
const CLUSTER_COUNT_LAYER_ID = 'events-cluster-count';
const POINT_LAYER_ID = 'events-points';

function addLayersIfMissing(map: Map): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 8,
      clusterRadius: 48,
    });
  }

  if (!map.getLayer(CLUSTER_LAYER_ID)) {
    map.addLayer({
      id: CLUSTER_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#2f80ed',
          10, '#f2c94c',
          50, '#eb5757',
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          18,
          10, 25,
          50, 34,
        ],
        'circle-opacity': 0.88,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
  }

  if (!map.getLayer(CLUSTER_COUNT_LAYER_ID)) {
    map.addLayer({
      id: CLUSTER_COUNT_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
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

  if (!map.getLayer(POINT_LAYER_ID)) {
    map.addLayer({
      id: POINT_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['get', 'severity'],
          0, 5,
          0.3, 8,
          0.6, 13,
          1, 20,
        ],
        'circle-color': [
          'match',
          ['get', 'category'],
          'seismic', '#f2994a',
          'conflict', '#eb5757',
          'disaster', '#9b51e0',
          '#2f80ed',
        ],
        'circle-opacity': 0.9,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.3,
      },
    });
  }
}

export function restoreEventsLayer(map: Map): void {
  if (!map.isStyleLoaded()) {
    map.once('load', () => restoreEventsLayer(map));
    return;
  }

  addLayersIfMissing(map);

  const source = map.getSource(SOURCE_ID);

  if (source?.type === 'geojson') {
    (source as GeoJSONSource).setData(eventStore.getState().getGeoJson());
  }
}

export function useMapEventsLayer(map: Map | null): void {
  const eventsById = useEventStore((state) => state.eventsById);
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

      const clusterId = Number(feature.properties?.cluster_id);
      const source = map.getSource(SOURCE_ID);

      if (!Number.isFinite(clusterId) || source?.type !== 'geojson') {
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

    const restore = () => restoreEventsLayer(map);

    restoreEventsLayer(map);

    map.on('click', POINT_LAYER_ID, handlePointClick);
    map.on('click', CLUSTER_LAYER_ID, handleClusterClick);
    map.on('mouseenter', POINT_LAYER_ID, setPointer);
    map.on('mouseenter', CLUSTER_LAYER_ID, setPointer);
    map.on('mouseleave', POINT_LAYER_ID, clearPointer);
    map.on('mouseleave', CLUSTER_LAYER_ID, clearPointer);
    map.on('webglcontextrestored', restore);

    return () => {
      map.off('click', POINT_LAYER_ID, handlePointClick);
      map.off('click', CLUSTER_LAYER_ID, handleClusterClick);
      map.off('mouseenter', POINT_LAYER_ID, setPointer);
      map.off('mouseenter', CLUSTER_LAYER_ID, setPointer);
      map.off('mouseleave', POINT_LAYER_ID, clearPointer);
      map.off('mouseleave', CLUSTER_LAYER_ID, clearPointer);
      map.off('webglcontextrestored', restore);
    };
  }, [map]);

  useEffect(() => {
    if (map) {
      restoreEventsLayer(map);
    }
  }, [map, eventsById, filters]);
}
