import type { NormalizedEvent } from '@/core/domain/NormalizedEvent';
import {
  HUMANITARIAN_CATEGORY_SET,
  PATTERN_THRESHOLDS,
  SEMICONDUCTOR_HUBS,
  STRATEGIC_CHOKEPOINTS,
  SUBMARINE_INFRA_NODES,
  haversineKm,
  type DetectedCrisis,
} from '@/core/analysis/crisisPatterns';

interface CorrelationRequest {
  requestId: string;
  events: NormalizedEvent[];
  now: number;
}

interface CorrelationResponse {
  requestId: string;
  crises: DetectedCrisis[];
  globalTensionIndex: number;
}

const worker = self as unknown as {
  onmessage: ((message: MessageEvent<CorrelationRequest>) => void) | null;
  postMessage: (message: CorrelationResponse) => void;
};

worker.onmessage = (message: MessageEvent<CorrelationRequest>) => {
  const { requestId, events, now } = message.data;

  const crises = [
    ...detectChokepointSqueeze(events, now),
    ...detectCableSabotage(events, now),
    ...detectSemiconductorShock(events, now),
    ...detectHumanitarianRupture(events, now),
  ].sort((a, b) => b.score - a.score);

  const globalTensionIndex = computeGlobalTensionIndex(events, crises, now);

  worker.postMessage({ requestId, crises, globalTensionIndex });
};

/**
 * Modèle 1 — Goulot d'étranglement maritime : un incident conflit ou
 * diplomatie survient à moins de 300 km d'un détroit stratégique, ET un
 * pic de dépêches énergie/finance est observé dans la même fenêtre de
 * 72h (sans contrainte de proximité pour ces dernières : une dépêche
 * "cours du pétrole" n'est en général pas géolocalisée, seule sa
 * concomitance temporelle avec la tension régionale compte).
 */
function detectChokepointSqueeze(
  events: NormalizedEvent[],
  now: number,
): DetectedCrisis[] {
  const windowMs = PATTERN_THRESHOLDS.chokepointWindowHours * 3_600_000;
  const results: DetectedCrisis[] = [];

  const energySpike = events.filter(
    (event) => (event.category === 'energy' || event.category === 'finance') &&
      now - event.timestamp <= windowMs,
  );

  if (energySpike.length === 0) {
    return results;
  }

  for (const chokepoint of STRATEGIC_CHOKEPOINTS) {
    const nearbyTension = events.filter((event) =>
      event.coordinates !== null &&
      (event.category === 'conflict' || event.category === 'diplomacy') &&
      now - event.timestamp <= windowMs &&
      haversineKm(
        [chokepoint.longitude, chokepoint.latitude],
        event.coordinates as [number, number],
      ) <= PATTERN_THRESHOLDS.chokepointRadiusKm,
    );

    if (nearbyTension.length === 0) {
      continue;
    }

    const contributing = [...nearbyTension, ...energySpike];
    const maxSeverity = Math.max(...contributing.map((event) => event.severity));
    const score = Math.min(
      100,
      Math.round(40 + contributing.length * 6 + maxSeverity * 30),
    );

    results.push({
      id: `chokepoint:${chokepoint.name}`,
      pattern: 'chokepoint-squeeze',
      label: `Tension au ${chokepoint.name}`,
      score,
      centerLatitude: chokepoint.latitude,
      centerLongitude: chokepoint.longitude,
      radiusKm: PATTERN_THRESHOLDS.chokepointRadiusKm,
      anchor: chokepoint.name,
      eventIds: contributing.map((event) => event.id),
      detectedAt: now,
      windowStart: now - windowMs,
      windowEnd: now,
    });
  }

  return results;
}

/**
 * Modèle 2 — Sabotage / câbles sous-marins : séisme maritime ou incident
 * d'infrastructure à moins de 30 km d'un nœud stratégique de
 * concentration de câbles.
 */
function detectCableSabotage(
  events: NormalizedEvent[],
  now: number,
): DetectedCrisis[] {
  const results: DetectedCrisis[] = [];

  const candidates = events.filter(
    (event) => event.coordinates !== null &&
      (event.category === 'seismic' || event.category === 'infrastructure'),
  );

  if (candidates.length === 0) {
    return results;
  }

  for (const node of SUBMARINE_INFRA_NODES) {
    const nearby = candidates.filter((event) =>
      haversineKm(
        [node.longitude, node.latitude],
        event.coordinates as [number, number],
      ) <= PATTERN_THRESHOLDS.cableRadiusKm,
    );

    if (nearby.length === 0) {
      continue;
    }

    const maxSeverity = Math.max(...nearby.map((event) => event.severity));
    const score = Math.min(
      100,
      Math.round(35 + nearby.length * 12 + maxSeverity * 35),
    );

    results.push({
      id: `cable:${node.name}`,
      pattern: 'cable-sabotage',
      label: `Risque infrastructure sous-marine — ${node.name}`,
      score,
      centerLatitude: node.latitude,
      centerLongitude: node.longitude,
      radiusKm: PATTERN_THRESHOLDS.cableRadiusKm,
      anchor: node.name,
      eventIds: nearby.map((event) => event.id),
      detectedAt: now,
      windowStart: Math.min(...nearby.map((event) => event.timestamp)),
      windowEnd: now,
    });
  }

  return results;
}

/**
 * Modèle 3 — Choc de production technologique : séisme M6.0+ (sévérité
 * ≥ 0.62 selon la formule existante) ou perturbation tech/IA à moins de
 * 100 km d'une fonderie stratégique.
 */
function detectSemiconductorShock(
  events: NormalizedEvent[],
  now: number,
): DetectedCrisis[] {
  const results: DetectedCrisis[] = [];

  const candidates = events.filter((event) =>
    event.coordinates !== null &&
    (
      (event.category === 'seismic' && event.severity >= PATTERN_THRESHOLDS.minMagnitudeForFabShock) ||
      event.category === 'tech_ai'
    ),
  );

  if (candidates.length === 0) {
    return results;
  }

  for (const hub of SEMICONDUCTOR_HUBS) {
    const nearby = candidates.filter((event) =>
      haversineKm(
        [hub.longitude, hub.latitude],
        event.coordinates as [number, number],
      ) <= PATTERN_THRESHOLDS.semiconductorRadiusKm,
    );

    if (nearby.length === 0) {
      continue;
    }

    const maxSeverity = Math.max(...nearby.map((event) => event.severity));
    const score = Math.min(
      100,
      Math.round(50 + nearby.length * 10 + maxSeverity * 30),
    );

    results.push({
      id: `chipshock:${hub.name}`,
      pattern: 'semiconductor-shock',
      label: `Risque de choc de production — ${hub.name}`,
      score,
      centerLatitude: hub.latitude,
      centerLongitude: hub.longitude,
      radiusKm: PATTERN_THRESHOLDS.semiconductorRadiusKm,
      anchor: hub.name,
      eventIds: nearby.map((event) => event.id),
      detectedAt: now,
      windowStart: Math.min(...nearby.map((event) => event.timestamp)),
      windowEnd: now,
    });
  }

  return results;
}

/**
 * Modèle 4 — Cumul de sinistres : au moins 3 évènements de catastrophe
 * naturelle dans un rayon de 500 km sur une fenêtre de 48h. Clustering
 * glouton par expansion de voisinage (O(n²), acceptable dans un Worker
 * dédié pour un volume borné par la rétention de 14 jours).
 */
function detectHumanitarianRupture(
  events: NormalizedEvent[],
  now: number,
): DetectedCrisis[] {
  const windowMs = PATTERN_THRESHOLDS.humanitarianWindowHours * 3_600_000;

  const candidates = events.filter((event) =>
    event.coordinates !== null &&
    now - event.timestamp <= windowMs &&
    HUMANITARIAN_CATEGORY_SET.has(event.category),
  );

  const used = new Set<string>();
  const results: DetectedCrisis[] = [];

  for (const seed of candidates) {
    if (used.has(seed.id)) {
      continue;
    }

    const cluster = candidates.filter((other) =>
      !used.has(other.id) &&
      haversineKm(
        seed.coordinates as [number, number],
        other.coordinates as [number, number],
      ) <= PATTERN_THRESHOLDS.humanitarianRadiusKm,
    );

    if (cluster.length < PATTERN_THRESHOLDS.minHumanitarianClusterSize) {
      continue;
    }

    for (const member of cluster) {
      used.add(member.id);
    }

    const centerLatitude = cluster.reduce(
      (sum, event) => sum + (event.coordinates as [number, number])[1],
      0,
    ) / cluster.length;

    const centerLongitude = cluster.reduce(
      (sum, event) => sum + (event.coordinates as [number, number])[0],
      0,
    ) / cluster.length;

    const maxSeverity = Math.max(...cluster.map((event) => event.severity));
    const score = Math.min(
      100,
      Math.round(45 + cluster.length * 8 + maxSeverity * 30),
    );

    results.push({
      id: `humanitarian:${seed.id}`,
      pattern: 'humanitarian-rupture',
      label: `Cumul de catastrophes (${cluster.length} évènements)`,
      score,
      centerLatitude,
      centerLongitude,
      radiusKm: PATTERN_THRESHOLDS.humanitarianRadiusKm,
      eventIds: cluster.map((event) => event.id),
      detectedAt: now,
      windowStart: Math.min(...cluster.map((event) => event.timestamp)),
      windowEnd: now,
    });
  }

  return results;
}

/**
 * Baromètre de tension global (0-100) : 40 % pondéré sur la sévérité
 * moyenne du trafic récent (72h, tous évènements), 60 % pondéré sur la
 * somme normalisée des scores de crises corrélées détectées.
 */
function computeGlobalTensionIndex(
  events: NormalizedEvent[],
  crises: DetectedCrisis[],
  now: number,
): number {
  const recentWindowMs = 72 * 3_600_000;
  const recent = events.filter((event) => now - event.timestamp <= recentWindowMs);

  const averageSeverity = recent.length > 0
    ? recent.reduce((sum, event) => sum + event.severity, 0) / recent.length
    : 0;

  const crisisSum = crises.reduce((sum, crisis) => sum + crisis.score, 0);
  const crisisComponent = Math.min(1, crisisSum / 300);

  const composite = averageSeverity * 40 + crisisComponent * 60;

  return Math.round(Math.min(100, Math.max(0, composite)));
}
