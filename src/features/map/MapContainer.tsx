import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapEventsLayer } from '@/features/map/useMapEventsLayer';
import { eventStore } from '@/stores/eventStore';

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

let lastCamera: CameraSnapshot = DEFAULT_CAMERA;

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

    // Round 1 : on ne committe jamais les bounds sur chaque frame de
    // 'move' (30-60 fois/s pendant l'inertie tactile). Un debounce
    // arrière-plan hors-React limite le coût, tandis que 'moveend'
    // committe immédiatement dès la fin réelle du geste.
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

    // Canal impératif "liste → carte" (Round 1/3) : un nonce croissant
    // permet de redéclencher un flyTo vers la même cible sans dépendre
    // d'un changement de coordonnées.
    let previousFlyToNonce = eventStore.getState().flyToRequest?.nonce ?? 0;

    const unsubscribeFlyTo = eventStore.subscribe((state) => {
      const request = state.flyToRequest;

      if (!request || request.nonce === previousFlyToNonce) {
        return;
      }

      previousFlyToNonce = request.nonce;

      requestAnimationFrame(() => {
        // Sécurité écran pliable : si le conteneur vient de repasser de
        // display:none à display:block (bascule d'onglet compact), les
        // dimensions internes de MapLibre doivent être recalculées avant
        // toute animation de caméra.
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

    setMap(instance);

    return () => {
      resizeObserver.disconnect();
      unsubscribeFlyTo();

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
