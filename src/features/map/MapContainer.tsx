import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapEventsLayer } from '@/features/map/useMapEventsLayer';
import { eventStore } from '@/stores/eventStore';
import { analysisStore } from '@/stores/analysisStore';
import { buildCirclePolygon } from '@/core/analysis/crisisPatterns';

interface MapContainerProps {
  className?: string;
  styleUrl: string;
}

interface CameraSnapshot {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

const DEFAULT_CAMERA: CameraSnapshot = {
  center: [8, 30],
  zoom: 1.4,
  bearing: 0,
  pitch: 0,
};

const BOUNDS_DEBOUNCE_MS = 220;
const THREAT_SOURCE_ID = 'source-threat-circle';
const THREAT_FILL_LAYER_ID = 'layer-threat-circle-fill';
const THREAT_OUTLINE_LAYER_ID = 'layer-threat-circle-outline';

let lastCamera: CameraSnapshot = DEFAULT_CAMERA;

function ensureThreatCircleLayers(map: Map): void {
  if (!map.getSource(THREAT_SOURCE_ID)) {
    map.addSource(THREAT_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  if (!map.getLayer(THREAT_FILL_LAYER_ID)) {
    map.addLayer({
      id: THREAT_FILL_LAYER_ID,
      type: 'fill',
      source: THREAT_SOURCE_ID,
      paint: {
        'fill-color': '#ff2b2b',
        'fill-opacity': 0.08,
      },
    });
  }

  if (!map.getLayer(THREAT_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: THREAT_OUTLINE_LAYER_ID,
      type: 'line',
      source: THREAT_SOURCE_ID,
      paint: {
        'line-color': '#ff2b2b',
        'line-width': 2,
        'line-dasharray': [2, 1.5],
      },
    });
  }
}

function setThreatCircleData(
  map: Map,
  centerLatitude: number,
  centerLongitude: number,
  radiusKm: number,
  label: string,
): void {
  const source = map.getSource(THREAT_SOURCE_ID);

  if (!source || source.type !== 'geojson') {
    return;
  }

  (source as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { label },
      geometry: buildCirclePolygon(centerLatitude, centerLongitude, radiusKm),
    }],
  });
}

export function MapContainer({
  className,
  styleUrl,
}: MapContainerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<Map | null>(null);

  useMapEventsLayer(map);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const instance = new maplibregl.Map({
      container,
      style: styleUrl,
      center: lastCamera.center,
      zoom: lastCamera.zoom,
      bearing: lastCamera.bearing,
      pitch: lastCamera.pitch,
      attributionControl: { compact: true },
      fadeDuration: 0,
    });

    let frameId: number | null = null;
    let boundsTimer: ReturnType<typeof setTimeout> | undefined;

    const saveCamera = () => {
      const center = instance.getCenter();

      lastCamera = {
        center: [center.lng, center.lat],
        zoom: instance.getZoom(),
        bearing: instance.getBearing(),
        pitch: instance.getPitch(),
      };
    };

    const commitBounds = () => {
      const bounds = instance.getBounds();

      eventStore.getState().setVisibleBounds([
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ]);
    };

    const scheduleBoundsCommit = () => {
      if (boundsTimer) {
        clearTimeout(boundsTimer);
      }

      boundsTimer = setTimeout(commitBounds, BOUNDS_DEBOUNCE_MS);
    };

    const onMoveEnd = () => {
      saveCamera();

      if (boundsTimer) {
        clearTimeout(boundsTimer);
        boundsTimer = undefined;
      }

      commitBounds();
    };

    const resizeObserver = new ResizeObserver(() => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          instance.resize();
        }

        frameId = null;
      });
    });

    const onContextLost = (event: Event) => {
      event.preventDefault();
      saveCamera();
    };

    resizeObserver.observe(container);
    instance.on('move', scheduleBoundsCommit);
    instance.on('moveend', onMoveEnd);
    instance.on('webglcontextlost', onContextLost);
    instance.once('load', commitBounds);

    let previousFlyToNonce = eventStore.getState().flyToRequest?.nonce ?? 0;
    let previousFocusNonce = analysisStore.getState().focusRequest?.nonce ?? 0;

    const unsubscribeFlyTo = eventStore.subscribe((state) => {
      const request = state.flyToRequest;

      if (!request || request.nonce === previousFlyToNonce) {
        return;
      }

      previousFlyToNonce = request.nonce;

      requestAnimationFrame(() => {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          instance.resize();
        }

        instance.flyTo({
          center: request.coordinates,
          zoom: Math.max(instance.getZoom(), request.zoom ?? 5.5),
          duration: 900,
          essential: true,
        });
      });
    });

    // Canal « Prendre la main » (Round 3) : cadre la carte sur l'emprise
    // de la crise et dessine un périmètre de menace dynamique.
    const unsubscribeFocus = analysisStore.subscribe((state) => {
      const request = state.focusRequest;

      if (!request || request.nonce === previousFocusNonce) {
        return;
      }

      previousFocusNonce = request.nonce;

      requestAnimationFrame(() => {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          instance.resize();
        }

        const runFocus = () => {
          ensureThreatCircleLayers(instance);
          setThreatCircleData(
            instance,
            request.centerLatitude,
            request.centerLongitude,
            request.radiusKm,
            request.label,
          );

          const [west, south, east, north] = request.bounds;

          instance.fitBounds(
            [[west, south], [east, north]],
            { padding: 48, duration: 900 },
          );
        };

        if (instance.isStyleLoaded()) {
          runFocus();
        } else {
          instance.once('load', runFocus);
        }
      });
    });

    setMap(instance);

    return () => {
      resizeObserver.disconnect();
      unsubscribeFlyTo();
      unsubscribeFocus();

      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      if (boundsTimer) {
        clearTimeout(boundsTimer);
      }

      saveCamera();
      instance.off('move', scheduleBoundsCommit);
      instance.off('moveend', onMoveEnd);
      instance.off('webglcontextlost', onContextLost);
      instance.remove();
      setMap(null);
    };
  }, [styleUrl]);

  return (
    <div
      ref={containerRef}
      className={className}
      aria-label="Carte mondiale des événements"
    />
  );
}
