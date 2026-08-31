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

export type TimeFilter = '3d' | '10d' | '30d' | 'all';

export type SourceLanguage = 'fr' | 'en';

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

  /**
   * Langue native du contenu tel que publié par la source. Permet à
   * l'affichage de ne déclencher une traduction que pour le contenu
   * réellement anglophone (Round 1), sans jamais appeler l'API de
   * traduction pour des sources déjà francophones.
   */
  sourceLanguage?: SourceLanguage;
}
