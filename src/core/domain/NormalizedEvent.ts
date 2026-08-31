export type EventCategory =
  | 'seismic'
  | 'volcanic'
  | 'wildfire'
  | 'flood'
  | 'storm'
  | 'conflict'
  | 'infrastructure'
  | 'disaster'
  | 'news'
  | 'energy'
  | 'finance'
  | 'diplomacy'
  | 'tech_ai'
  | 'space';

export type AlertLevel = 'green' | 'orange' | 'red';

/**
 * Filtre temporel à chaud (Round 1). 'all' désactive toute coupure.
 */
export type TimeFilter = '3d' | '10d' | '30d' | 'all';

export type EventGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface NormalizedEvent {
  id: string;
  sourceId: string;
  title: string;
  summary: string;
  timestamp: number;
  severity: number;
  coordinates: [number, number] | null;
  category: EventCategory;
  rawUrl: string;

  alertLevel?: AlertLevel;
  sourceLabel?: string;
  countryLabel?: string;
  startTime?: number;
  endTime?: number;
  polygon?: EventGeometry | null;
}
