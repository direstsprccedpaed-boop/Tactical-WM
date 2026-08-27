import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapEventsLayer } from '@/features/map/useMapEventsLayer';

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

    const saveCamera = () => {
      const center = instance.getCenter();

      lastCamera = {
        center: [center.lng, center.lat],
        zoom: instance.getZoom(),
        bearing: instance.getBearing(),
        pitch: instance.getPitch(),
      };
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
    instance.on('moveend', saveCamera);
    instance.on('webglcontextlost', onContextLost);
    setMap(instance);

    return () => {
      resizeObserver.disconnect();

      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      saveCamera();
      instance.off('moveend', saveCamera);
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
