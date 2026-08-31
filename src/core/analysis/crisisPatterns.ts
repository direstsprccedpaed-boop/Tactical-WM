import type { EventCategory } from '@/core/domain/NormalizedEvent';

export interface GeoAnchor {
  name: string;
  latitude: number;
  longitude: number;
}

export type CrisisPatternType =
  | 'chokepoint-squeeze'
  | 'cable-sabotage'
  | 'semiconductor-shock'
  | 'humanitarian-rupture';

export interface DetectedCrisis {
  id: string;
  pattern: CrisisPatternType;
  label: string;
  score: number;
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  anchor?: string;
  eventIds: string[];
  detectedAt: number;
  windowStart: number;
  windowEnd: number;
}

/**
 * Points d'étranglement maritimes stratégiques. Coordonnées approximatives
 * de repère tactique, cohérentes avec celles déjà embarquées dans
 * `public/data/critical-infrastructure.geojson`.
 */
export const STRATEGIC_CHOKEPOINTS: GeoAnchor[] = [
  { name: "Détroit d'Ormuz", latitude: 26.57, longitude: 56.25 },
  { name: 'Détroit de Malacca', latitude: 3.0, longitude: 100.5 },
  { name: 'Détroit de Bab-el-Mandeb', latitude: 12.6, longitude: 43.4 },
  { name: 'Détroit du Bosphore', latitude: 41.11, longitude: 29.06 },
  { name: 'Canal de Suez', latitude: 31.26, longitude: 32.32 },
  { name: 'Canal de Panama', latitude: 8.95, longitude: -79.55 },
  { name: 'Détroit de Gibraltar', latitude: 35.95, longitude: -5.6 },
  { name: 'Détroits danois (Øresund)', latitude: 55.65, longitude: 12.6 },
];

/**
 * Proxy pour les zones de concentration d'infrastructures sous-marines :
 * les détroits stratégiques sont aussi, dans la réalité, les points de
 * plus forte densité de câbles et de stations d'atterrissage. Ce n'est
 * pas un tracé de câble réel (non disponible sans jeu de données
 * propriétaire vérifié), mais une approximation déclarée comme telle.
 */
export const SUBMARINE_INFRA_NODES: GeoAnchor[] = STRATEGIC_CHOKEPOINTS;

/**
 * Fonderies de semi-conducteurs stratégiques. Coordonnées vérifiées :
 * TSMC Hsinchu (24°46'N, 120°60'E, siège et Fab 12A/12B), Samsung
 * Pyeongtaek et SK Hynix Icheon (Gyeonggi-do, Corée du Sud).
 */
export const SEMICONDUCTOR_HUBS: GeoAnchor[] = [
  { name: 'TSMC — Hsinchu (Taïwan)', latitude: 24.774, longitude: 120.999 },
  { name: 'Samsung — Pyeongtaek (Corée du Sud)', latitude: 37.0, longitude: 127.11 },
  { name: 'SK Hynix — Icheon (Corée du Sud)', latitude: 37.27, longitude: 127.44 },
];

export const PATTERN_THRESHOLDS = {
  chokepointRadiusKm: 300,
  cableRadiusKm: 30,
  semiconductorRadiusKm: 100,
  humanitarianRadiusKm: 500,
  chokepointWindowHours: 72,
  humanitarianWindowHours: 48,
  /** ≈ M6.0 selon la formule de sévérité sismique déjà utilisée par
   *  `parser.worker.ts` : min(1, max(0, (magnitude - 2) / 6)). */
  minMagnitudeForFabShock: 0.62,
  minHumanitarianClusterSize: 3,
};

export const CRISIS_PATTERN_LABELS: Record<CrisisPatternType, string> = {
  'chokepoint-squeeze': 'Goulot d\u2019étranglement maritime',
  'cable-sabotage': 'Risque infrastructure sous-marine',
  'semiconductor-shock': 'Choc de production technologique',
  'humanitarian-rupture': 'Cumul de sinistres',
};

const HUMANITARIAN_CATEGORIES: EventCategory[] = [
  'seismic',
  'volcanic',
  'wildfire',
  'flood',
  'storm',
  'disaster',
];

export const HUMANITARIAN_CATEGORY_SET = new Set<EventCategory>(HUMANITARIAN_CATEGORIES);

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

const EARTH_RADIUS_KM = 6371;

/**
 * Distance orthodromique entre deux points [longitude, latitude], en
 * kilomètres. Utilisée par le moteur de corrélation pour tous les tests
 * de proximité géographique.
 */
export function haversineKm(
  a: [number, number],
  b: [number, number],
): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);

  const s = sinLat * sinLat +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinLon * sinLon;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Génère un polygone GeoJSON approximant un cercle géodésique autour d'un
 * centre donné, par navigation bearing/distance. Utilisé pour dessiner le
 * périmètre de menace dynamique sur la carte (Round 3).
 */
export function buildCirclePolygon(
  centerLatitude: number,
  centerLongitude: number,
  radiusKm: number,
  segments = 64,
): GeoJSON.Polygon {
  const latRad = toRadians(centerLatitude);
  const lonRad = toRadians(centerLongitude);
  const angularRadius = radiusKm / EARTH_RADIUS_KM;

  const ring: [number, number][] = [];

  for (let index = 0; index <= segments; index += 1) {
    const bearing = (index / segments) * 2 * Math.PI;

    const pointLat = Math.asin(
      Math.sin(latRad) * Math.cos(angularRadius) +
      Math.cos(latRad) * Math.sin(angularRadius) * Math.cos(bearing),
    );

    const pointLon = lonRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(latRad),
      Math.cos(angularRadius) - Math.sin(latRad) * Math.sin(pointLat),
    );

    ring.push([toDegrees(pointLon), toDegrees(pointLat)]);
  }

  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Boîte englobante approximative pour un cercle géodésique, utilisée par
 * `map.fitBounds()`. Approximation planaire suffisante à l'échelle d'un
 * rayon de crise (≤ 500 km) — pas de gestion de l'antiméridien, limite
 * documentée et acceptable pour ce cas d'usage.
 */
export function boundsFromCircle(
  centerLatitude: number,
  centerLongitude: number,
  radiusKm: number,
): [number, number, number, number] {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos(toRadians(centerLatitude)) || 1);

  return [
    centerLongitude - lonDelta,
    centerLatitude - latDelta,
    centerLongitude + lonDelta,
    centerLatitude + latDelta,
  ];
}
