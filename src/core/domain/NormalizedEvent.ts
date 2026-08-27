export type EventCategory = 'seismic' | 'conflict' | 'disaster' | 'news';

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
}
