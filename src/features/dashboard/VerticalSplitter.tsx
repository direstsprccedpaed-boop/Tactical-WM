import { useEffect, useRef, useState, type ReactNode } from 'react';

const HANDLE_HEIGHT_PX = 18;
const KEYBOARD_STEP = 0.05;

interface VerticalSplitterProps {
  top: ReactNode;
  bottom: ReactNode;
  storageKey: string;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  className?: string;
}

interface DragState {
  startY: number;
  startRatio: number;
  containerHeight: number;
}

function readStoredRatio(storageKey: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(storageKey);

    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredRatio(storageKey: string, ratio: number): void {
  try {
    localStorage.setItem(storageKey, String(ratio));
  } catch {
    // Stockage indisponible : la préférence ne sera pas mémorisée pour
    // la session suivante, sans que cela n'affecte l'usage courant.
  }
}

function trackTemplate(ratio: number): string {
  const topPercent = (ratio * 100).toFixed(2);
  const bottomPercent = (100 - ratio * 100).toFixed(2);
  return `minmax(0, ${topPercent}%) ${HANDLE_HEIGHT_PX}px minmax(0, ${bottomPercent}%)`;
}

/**
 * Poignée de redimensionnement vertical tactile (Round 2). La
 * manipulation pendant le drag écrit directement le style DOM du
 * conteneur via une ref, sans passer par setState React à chaque
 * pointermove — seul le relâchement du pointeur committe la valeur
 * finale dans le state et le localStorage. Cela évite tout re-render de
 * sous-arbre pendant le geste, condition nécessaire pour un drag fluide
 * sur WebView Android.
 */
export function VerticalSplitter({
  top,
  bottom,
  storageKey,
  defaultRatio = 0.55,
  minRatio = 0.2,
  maxRatio = 0.8,
  className,
}: VerticalSplitterProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState(() => readStoredRatio(storageKey, defaultRatio));
  const dragState = useRef<DragState | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.gridTemplateRows = trackTemplate(ratio);
    }
  }, [ratio]);

  const clamp = (value: number): number => Math.min(maxRatio, Math.max(minRatio, value));

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    dragState.current = {
      startY: event.clientY,
      startRatio: ratio,
      containerHeight: container.getBoundingClientRect().height,
    };

    document.body.style.userSelect = 'none';
    document.body.style.touchAction = 'none';
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    const container = containerRef.current;

    if (!drag || !container || drag.containerHeight <= 0) {
      return;
    }

    const deltaY = event.clientY - drag.startY;
    const deltaRatio = deltaY / drag.containerHeight;
    const nextRatio = clamp(drag.startRatio + deltaRatio);

    // Écriture DOM directe : aucun re-render React déclenché pendant le
    // geste, garantissant la fluidité du drag.
    container.style.gridTemplateRows = trackTemplate(nextRatio);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;

    if (!drag) {
      return;
    }

    const deltaY = event.clientY - drag.startY;
    const deltaRatio = drag.containerHeight > 0 ? deltaY / drag.containerHeight : 0;
    const finalRatio = clamp(drag.startRatio + deltaRatio);

    dragState.current = null;
    document.body.style.userSelect = '';
    document.body.style.touchAction = '';

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Le pointeur peut déjà avoir été relâché par le système
      // (annulation de geste, changement de focus) : sans conséquence.
    }

    setRatio(finalRatio);
    writeStoredRatio(storageKey, finalRatio);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = clamp(ratio - KEYBOARD_STEP);
      setRatio(next);
      writeStoredRatio(storageKey, next);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = clamp(ratio + KEYBOARD_STEP);
      setRatio(next);
      writeStoredRatio(storageKey, next);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`vertical-splitter ${className ?? ''}`}
      style={{ gridTemplateRows: trackTemplate(ratio) }}
    >
      <div className="vertical-splitter-pane vertical-splitter-top">{top}</div>

      <div
        className="vertical-splitter-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        aria-label="Redimensionner la liste et le détail"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
      >
        <span className="vertical-splitter-grip" />
      </div>

      <div className="vertical-splitter-pane vertical-splitter-bottom">{bottom}</div>
    </div>
  );
}
