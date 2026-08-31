import type { EventCategory, NormalizedEvent } from '@/core/domain/NormalizedEvent';
import type { DetectedCrisis } from '@/core/analysis/crisisPatterns';

interface ThreatGraphProps {
  crisis: DetectedCrisis | null;
  eventsById: Record<string, NormalizedEvent>;
  onNodeSelect?: (eventId: string) => void;
}

const NODE_RADIUS = 16;
const ROW_HEIGHT = 74;
const COLUMN_OFFSET = 92;
const CENTER_X = 160;
const TOP_MARGIN = 40;

const CATEGORY_COLORS: Record<EventCategory, string> = {
  seismic: '#f2994a',
  volcanic: '#f2994a',
  wildfire: '#9b51e0',
  flood: '#9b51e0',
  storm: '#9b51e0',
  disaster: '#9b51e0',
  conflict: '#eb5757',
  news: '#2f80ed',
  infrastructure: '#2ecc71',
  energy: '#f2c94c',
  finance: '#27ae60',
  diplomacy: '#56ccf2',
  tech_ai: '#bb6bd9',
  space: '#e0e6f0',
};

function formatElapsed(ms: number): string {
  const hours = ms / 3_600_000;

  if (hours < 1) {
    return `+${Math.round(ms / 60_000)} min`;
  }

  if (hours < 48) {
    return `+${hours.toFixed(1)} h`;
  }

  return `+${Math.round(hours / 24)} j`;
}

/**
 * Graphe de causalité léger en SVG pur : disposition en colonne
 * chronologique (pas de force-directed layout, coûteux et instable pour
 * un si petit nombre de nœuds). Les arêtes relient les évènements
 * consécutifs par ordre temporel — heuristique de proximité temporelle,
 * pas une inférence causale vérifiée, explicitement documentée comme
 * telle.
 */
export function ThreatGraph({ crisis, eventsById, onNodeSelect }: ThreatGraphProps) {
  if (!crisis) {
    return (
      <div className="threat-graph-empty">
        Sélectionnez une crise corrélée pour inspecter sa chaîne d'évènements.
      </div>
    );
  }

  const sortedEvents = crisis.eventIds
    .map((id) => eventsById[id])
    .filter((event): event is NormalizedEvent => Boolean(event))
    .sort((a, b) => a.timestamp - b.timestamp);

  const hasAnchor = Boolean(crisis.anchor);
  const totalRows = sortedEvents.length + (hasAnchor ? 1 : 0);
  const height = Math.max(160, TOP_MARGIN * 2 + totalRows * ROW_HEIGHT);

  const nodes: Array<{
    x: number;
    y: number;
    color: string;
    title: string;
    id: string | null;
  }> = [];

  if (hasAnchor) {
    nodes.push({
      x: CENTER_X,
      y: TOP_MARGIN,
      color: '#ffb000',
      title: crisis.anchor ?? '',
      id: null,
    });
  }

  sortedEvents.forEach((event, index) => {
    const row = index + (hasAnchor ? 1 : 0);
    const side = index % 2 === 0 ? -1 : 1;

    nodes.push({
      x: CENTER_X + side * COLUMN_OFFSET,
      y: TOP_MARGIN + row * ROW_HEIGHT,
      color: CATEGORY_COLORS[event.category],
      title: event.title,
      id: event.id,
    });
  });

  const edges: Array<{ x1: number; y1: number; x2: number; y2: number; label: string }> = [];

  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];

    const previousEvent = previous.id ? eventsById[previous.id] : undefined;
    const currentEvent = current.id ? eventsById[current.id] : undefined;

    const elapsedMs = previousEvent && currentEvent
      ? currentEvent.timestamp - previousEvent.timestamp
      : 0;

    edges.push({
      x1: previous.x,
      y1: previous.y,
      x2: current.x,
      y2: current.y,
      label: previousEvent && currentEvent ? formatElapsed(elapsedMs) : '',
    });
  }

  return (
    <svg
      className="threat-graph"
      viewBox={`0 0 320 ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={`Graphe de liaison causale — ${crisis.label}`}
    >
      <defs>
        <marker
          id="threat-graph-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 Z" fill="#4ca5ff" />
        </marker>
      </defs>

      {edges.map((edge, index) => (
        <g key={`edge-${index}`}>
          <line
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke="#4ca5ff"
            strokeWidth={1.5}
            markerEnd="url(#threat-graph-arrow)"
          />
          {edge.label && (
            <text
              x={(edge.x1 + edge.x2) / 2}
              y={(edge.y1 + edge.y2) / 2 - 6}
              textAnchor="middle"
              className="threat-graph-edge-label"
            >
              {edge.label}
            </text>
          )}
        </g>
      ))}

      {nodes.map((node, index) => (
        <g
          key={`node-${index}`}
          transform={`translate(${node.x}, ${node.y})`}
          className={node.id ? 'threat-graph-node is-clickable' : 'threat-graph-node'}
          onClick={() => {
            if (node.id) {
              onNodeSelect?.(node.id);
            }
          }}
        >
          <circle r={NODE_RADIUS} fill={node.color} stroke="#07111f" strokeWidth={2} />
          <text
            x={0}
            y={NODE_RADIUS + 14}
            textAnchor="middle"
            className="threat-graph-node-label"
          >
            {node.title.length > 28 ? `${node.title.slice(0, 26)}…` : node.title}
          </text>
        </g>
      ))}
    </svg>
  );
}
