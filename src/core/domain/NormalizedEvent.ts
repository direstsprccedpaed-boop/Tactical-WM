export type EventCategory =
  | 'seismic'
  | 'volcanic'
  | 'wildfire'
  | 'flood'
  | 'storm'
  | 'conflict'
  | 'infrastructure'
  | 'disaster'
  | 'news';

export type AlertLevel = 'green' | 'orange' | 'red';

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

  /**
   * Champs enrichis (Round 2). Tous optionnels afin de garantir la
   * rétrocompatibilité avec les lignes déjà persistées dans Dexie par les
   * adaptateurs existants (USGS, RSS) qui ne les renseignent pas.
   */
  alertLevel?: AlertLevel;
  sourceLabel?: string;
  countryLabel?: string;
  startTime?: number;
  endTime?: number;

  /**
   * Géométrie étendue (polygone de tempête/feu, tracé linéaire, etc.).
   * Non alimenté par l'adaptateur GDACS actuel (qui ne remonte que le
   * centroïde ponctuel via l'endpoint de liste, afin d'éviter un fan-out
   * N+1 de requêtes vers l'endpoint de géométrie détaillée pendant la
   * synchronisation en tâche de fond — voir Round 1). Prévu comme point
   * d'extension pour une récupération à la demande, lors de l'ouverture
   * du détail d'un évènement spécifique.
   */
  polygon?: EventGeometry | null;
}
