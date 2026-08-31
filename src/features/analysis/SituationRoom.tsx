import { useMemo } from 'react';

import { ThreatGraph } from '@/features/analysis/ThreatGraph';
import { CRISIS_PATTERN_LABELS } from '@/core/analysis/crisisPatterns';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useEventStore } from '@/stores/eventStore';

import './SituationRoom.css';

function getTensionZone(index: number): { label: string; color: string } {
  if (index < 34) {
    return { label: 'CALME', color: '#39ff14' };
  }

  if (index < 67) {
    return { label: 'VIGILANCE', color: '#ffb000' };
  }

  return { label: 'CRITIQUE', color: '#ff2b2b' };
}

function formatWindow(startMs: number, endMs: number): string {
  const hours = Math.round((endMs - startMs) / 3_600_000);

  if (hours < 48) {
    return `Fenêtre ${hours} h`;
  }

  return `Fenêtre ${Math.round(hours / 24)} j`;
}

/**
 * Onglet « Salle de situation tactique & Analyse croisée ». Cockpit à
 * quatre volets : baromètre global en bande supérieure, liste des
 * crises corrélées triées par score, graphe de causalité et action de
 * focus opérationnel.
 */
export function SituationRoom() {
  const crises = useAnalysisStore((state) => state.crises);
  const globalTensionIndex = useAnalysisStore((state) => state.globalTensionIndex);
  const selectedCrisisId = useAnalysisStore((state) => state.selectedCrisisId);
  const isComputing = useAnalysisStore((state) => state.isComputing);
  const selectCrisis = useAnalysisStore((state) => state.selectCrisis);
  const focusCrisis = useAnalysisStore((state) => state.focusCrisis);

  const eventsById = useEventStore((state) => state.eventsById);

  const zone = getTensionZone(globalTensionIndex);

  const selectedCrisis = useMemo(
    () => crises.find((crisis) => crisis.id === selectedCrisisId) ?? null,
    [crises, selectedCrisisId],
  );

  const criticalCount = crises.filter((crisis) => crisis.score >= 67).length;
  const watchCount = crises.filter((crisis) => crisis.score >= 34 && crisis.score < 67).length;

  return (
    <main className="situation-room">
      <header className="situation-header">
        <div className="tension-gauge" style={{ '--tension-color': zone.color } as React.CSSProperties}>
          <div className="tension-gauge-ring">
            <span className="tension-gauge-value">{globalTensionIndex}</span>
            <span className="tension-gauge-label">{zone.label}</span>
          </div>
        </div>

        <div className="situation-metrics">
          <div className="metric-block">
            <span className="metric-value" style={{ color: '#ff2b2b' }}>{criticalCount}</span>
            <span className="metric-label">Crises critiques</span>
          </div>

          <div className="metric-block">
            <span className="metric-value" style={{ color: '#ffb000' }}>{watchCount}</span>
            <span className="metric-label">Sous vigilance</span>
          </div>

          <div className="metric-block">
            <span className="metric-value">{crises.length}</span>
            <span className="metric-label">Motifs corrélés</span>
          </div>

          <div className="metric-block">
            <span className="metric-value">{isComputing ? '…' : 'À jour'}</span>
            <span className="metric-label">Moteur de corrélation</span>
          </div>
        </div>
      </header>

      <section className="situation-body">
        <section className="crisis-list-panel">
          <h2>Crises détectées</h2>

          {crises.length === 0 && !isComputing && (
            <p className="panel-message">
              Aucun motif de crise corrélé dans les données actuelles.
            </p>
          )}

          <ul className="crisis-list">
            {crises.map((crisis) => {
              const tier = getTensionZone(crisis.score);

              return (
                <li key={crisis.id}>
                  <button
                    type="button"
                    className={crisis.id === selectedCrisisId ? 'crisis-row is-selected' : 'crisis-row'}
                    onClick={() => selectCrisis(crisis.id)}
                  >
                    <div className="crisis-row-header">
                      <span className="crisis-score" style={{ color: tier.color }}>
                        {crisis.score}
                      </span>
                      <span className="crisis-pattern-tag">
                        {CRISIS_PATTERN_LABELS[crisis.pattern]}
                      </span>
                    </div>

                    <strong>{crisis.label}</strong>

                    <small>
                      {crisis.eventIds.length} évènement(s) déclencheur(s) · {formatWindow(crisis.windowStart, crisis.windowEnd)}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="inspection-panel">
          <div className="inspection-header">
            <h2>Inspection tactique</h2>

            {selectedCrisis && (
              <button
                type="button"
                className="focus-button"
                onClick={() => focusCrisis(selectedCrisis.id)}
              >
                🎯 Prendre la main
              </button>
            )}
          </div>

          {selectedCrisis ? (
            <>
              <p className="crisis-summary">
                <strong>{selectedCrisis.label}</strong>
                {selectedCrisis.anchor && ` — ancré sur ${selectedCrisis.anchor}`}.
                Rayon d'analyse : {selectedCrisis.radiusKm} km.
              </p>

              <ThreatGraph
                crisis={selectedCrisis}
                eventsById={eventsById}
              />

              <p className="graph-disclaimer">
                Chaîne de liaison par proximité temporelle entre évènements
                corrélés — heuristique de renseignement, pas une causalité
                vérifiée.
              </p>
            </>
          ) : (
            <ThreatGraph crisis={null} eventsById={eventsById} />
          )}
        </section>
      </section>
    </main>
  );
}
