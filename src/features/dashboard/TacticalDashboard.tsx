import { useMemo, useState } from 'react';

import { MapContainer } from '@/features/map/MapContainer';
import type { EventCategory, NormalizedEvent, TimeFilter } from '@/core/domain/NormalizedEvent';
import { type MapLayerId, useEventStore } from '@/stores/eventStore';

import './TacticalDashboard.css';

type CompactTab = 'map' | 'alerts';

const CATEGORY_LABELS: Record<EventCategory, string> = {
  seismic: 'Séisme',
  volcanic: 'Volcan',
  wildfire: 'Feu de forêt',
  flood: 'Inondation',
  storm: 'Cyclone',
  conflict: 'Conflit',
  infrastructure: 'Infrastructure',
  disaster: 'Catastrophe',
  news: 'Actualité',
  energy: 'Énergie',
  finance: 'Finance',
  diplomacy: 'Diplomatie',
  tech_ai: 'Tech / IA',
  space: 'Espace',
};

const LAYER_LABELS: Record<MapLayerId, string> = {
  'layer-seismic': 'Séismes & volcans',
  'layer-weather': 'Météo & catastrophes',
  'layer-news': 'Actualités & conflits',
  'layer-infra': 'Infrastructures',
  'layer-energy': 'Énergie',
  'layer-finance': 'Finance',
  'layer-diplomacy': 'Diplomatie',
  'layer-tech': 'Tech / IA',
  'layer-space': 'Espace',
};

const LAYER_ORDER: MapLayerId[] = [
  'layer-seismic',
  'layer-weather',
  'layer-news',
  'layer-energy',
  'layer-finance',
  'layer-diplomacy',
  'layer-tech',
  'layer-space',
  'layer-infra',
];

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  '3d': '3 j',
  '10d': '10 j',
  '30d': '30 j',
  all: 'Tout',
};

const TIME_FILTER_ORDER: TimeFilter[] = ['3d', '10d', '30d', 'all'];

const SEVERITY_TIERS: Array<{ max: number; label: string; hex: string }> = [
  { max: 0.35, label: 'Faible', hex: '#27ae60' },
  { max: 0.65, label: 'Modérée', hex: '#f2c94c' },
  { max: 0.85, label: 'Élevée', hex: '#f2994a' },
  { max: 1, label: 'Critique', hex: '#eb5757' },
];

const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

const STOPWORDS = new Set([
  'dans', 'pour', 'avec', 'plus', 'cette', 'sont', 'être', 'leur', 'leurs',
  'elle', 'nous', 'vous', 'mais', 'comme', 'aussi', 'après', 'entre',
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'been',
  'were', 'will', 'their', 'about', 'into', 'over', 'said', 'says',
]);

function getSeverityTier(score: number): { label: string; hex: string } {
  for (const tier of SEVERITY_TIERS) {
    if (score <= tier.max) {
      return { label: tier.label, hex: tier.hex };
    }
  }
  return SEVERITY_TIERS[SEVERITY_TIERS.length - 1];
}

function toDMS(decimal: number, isLatitude: boolean): string {
  const absolute = Math.abs(decimal);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = ((minutesFloat - minutes) * 60).toFixed(1);
  const direction = isLatitude
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'O');

  return `${degrees}°${minutes}'${seconds}"${direction}`;
}

function extractTags(event: NormalizedEvent): string[] {
  const combined = `${event.title} ${event.summary}`;
  const tokens = combined.match(/[A-Za-zÀ-ÖØ-öø-ÿ]{4,}/g) ?? [];
  const frequency = new Map<string, number>();

  for (const token of tokens) {
    const normalized = token.toLowerCase();

    if (STOPWORDS.has(normalized)) {
      continue;
    }

    frequency.set(normalized, (frequency.get(normalized) ?? 0) + 1);
  }

  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
}

export function TacticalDashboard() {
  const [compactTab, setCompactTab] = useState<CompactTab>('map');
  const [controllerOpen, setControllerOpen] = useState(true);

  const hydrated = useEventStore((state) => state.hydrated);
  const hydrationError = useEventStore((state) => state.hydrationError);
  const selectedEventId = useEventStore((state) => state.selectedEventId);
  const eventsById = useEventStore((state) => state.eventsById);
  const activeLayers = useEventStore((state) => state.activeLayers);
  const filters = useEventStore((state) => state.filters);
  const timeFilter = useEventStore((state) => state.timeFilter);
  const viewportFilterEnabled = useEventStore((state) => state.viewportFilterEnabled);
  const getVisibleListEvents = useEventStore((state) => state.getVisibleListEvents);
  const selectEvent = useEventStore((state) => state.selectEvent);
  const toggleLayer = useEventStore((state) => state.toggleLayer);
  const setFilters = useEventStore((state) => state.setFilters);
  const setTimeFilter = useEventStore((state) => state.setTimeFilter);
  const toggleViewportFilter = useEventStore((state) => state.toggleViewportFilter);
  const requestFlyTo = useEventStore((state) => state.requestFlyTo);

  const events = getVisibleListEvents();
  const selectedEvent = selectedEventId
    ? eventsById[selectedEventId] ?? null
    : null;

  const status = useMemo(() => {
    if (!hydrated) {
      return 'Chargement du snapshot Dexie…';
    }

    return `${events.length} événement(s) · ${TIME_FILTER_LABELS[timeFilter]}${viewportFilterEnabled ? ' · zone visible' : ''}`;
  }, [events.length, hydrated, timeFilter, viewportFilterEnabled]);

  const handleLocate = (eventId: string) => {
    setCompactTab('map');
    requestFlyTo(eventId, 6.5);
  };

  const selectedTags = selectedEvent ? extractTags(selectedEvent) : [];
  const selectedTier = selectedEvent ? getSeverityTier(selectedEvent.severity) : null;

  return (
    <main className="tactical-dashboard">
      <header className="dashboard-header">
        <div>
          <h1>World Monitor Tactical</h1>
          <p>{status}</p>
        </div>

        <div className="compact-tabs" role="tablist" aria-label="Navigation mobile">
          <button
            type="button"
            role="tab"
            aria-selected={compactTab === 'map'}
            className={compactTab === 'map' ? 'is-active' : ''}
            onClick={() => setCompactTab('map')}
          >
            Carte
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={compactTab === 'alerts'}
            className={compactTab === 'alerts' ? 'is-active' : ''}
            onClick={() => setCompactTab('alerts')}
          >
            Flux
          </button>
        </div>
      </header>

      <section className={`dashboard-content compact-${compactTab}`}>
        <section className="map-panel">
          <MapContainer
            className="map-canvas"
            styleUrl={BASEMAP_STYLE_URL}
          />

          <div className={`tactical-controller ${controllerOpen ? 'is-open' : 'is-collapsed'}`}>
            <button
              type="button"
              className="tactical-controller-toggle"
              onClick={() => setControllerOpen((open) => !open)}
              aria-expanded={controllerOpen}
            >
              {controllerOpen ? '▾' : '▸'} Contrôleur tactique
            </button>

            {controllerOpen && (
              <div className="tactical-controller-body">
                <div className="time-filter-row" role="tablist" aria-label="Filtre temporel">
                  {TIME_FILTER_ORDER.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="tab"
                      aria-selected={timeFilter === option}
                      className={timeFilter === option ? 'time-chip is-active' : 'time-chip'}
                      onClick={() => setTimeFilter(option)}
                    >
                      {TIME_FILTER_LABELS[option]}
                    </button>
                  ))}
                </div>

                <div className="layer-badge-row">
                  {LAYER_ORDER.map((layerId) => (
                    <button
                      key={layerId}
                      type="button"
                      className={activeLayers[layerId] ? 'layer-badge is-active' : 'layer-badge'}
                      onClick={() => toggleLayer(layerId)}
                      aria-pressed={activeLayers[layerId]}
                    >
                      {LAYER_LABELS[layerId]}
                    </button>
                  ))}
                </div>

                <label className="severity-control">
                  Gravité minimale : {Math.round(filters.minimumSeverity * 100)} %
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(filters.minimumSeverity * 100)}
                    onChange={(event) => setFilters({
                      minimumSeverity: Number(event.target.value) / 100,
                    })}
                  />
                </label>

                <label className="viewport-toggle">
                  <input
                    type="checkbox"
                    checked={viewportFilterEnabled}
                    onChange={toggleViewportFilter}
                  />
                  Filtrer la liste par zone visible
                </label>
              </div>
            )}
          </div>
        </section>

        <aside className="intelligence-rail">
          <section className="alerts-panel">
            <h2>Alertes</h2>

            {!hydrated && (
              <p className="panel-message">Lecture du cache en cours.</p>
            )}

            {hydrationError && (
              <p className="panel-message error-message">{hydrationError}</p>
            )}

            {hydrated && !hydrationError && events.length === 0 && (
              <p className="panel-message">
                Aucun événement pour les calques et filtres actifs.
              </p>
            )}

            <ul className="event-list">
              {events.slice(0, 100).map((event) => {
                const tier = getSeverityTier(event.severity);

                return (
                  <li key={event.id}>
                    <div
                      className={event.id === selectedEventId ? 'event-row is-selected' : 'event-row'}
                    >
                      <button
                        type="button"
                        className="event-row-main"
                        onClick={() => selectEvent(event.id)}
                      >
                        <span className={`event-category category-${event.category}`}>
                          {CATEGORY_LABELS[event.category]}
                        </span>
                        <strong>{event.title}</strong>
                        <small style={{ color: tier.hex }}>
                          ● {tier.label} — {Math.round(event.severity * 100)} %
                        </small>
                      </button>

                      {event.coordinates && (
                        <button
                          type="button"
                          className="locate-button"
                          onClick={() => handleLocate(event.id)}
                          aria-label={`Localiser ${event.title} sur la carte`}
                        >
                          📍
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="event-detail" aria-live="polite">
            <h2>Fiche tactique</h2>

            {selectedEvent ? (
              <>
                <div className="detail-meta-row">
                  <span className={`event-category category-${selectedEvent.category}`}>
                    {CATEGORY_LABELS[selectedEvent.category]}
                  </span>
                  <span className="detail-source">
                    {selectedEvent.sourceLabel ?? selectedEvent.sourceId}
                  </span>
                </div>

                <h3>{selectedEvent.title}</h3>

                {selectedTier && (
                  <div className="severity-gauge">
                    <div className="severity-gauge-track">
                      <div
                        className="severity-gauge-fill"
                        style={{
                          width: `${Math.round(selectedEvent.severity * 100)}%`,
                          background: selectedTier.hex,
                        }}
                      />
                    </div>
                    <span style={{ color: selectedTier.hex }}>
                      {selectedTier.label} — {Math.round(selectedEvent.severity * 100)} % ({selectedTier.hex})
                    </span>
                  </div>
                )}

                <p>{selectedEvent.summary || 'Aucun résumé disponible.'}</p>

                {selectedTags.length > 0 && (
                  <div className="tag-row">
                    {selectedTags.map((tag) => (
                      <span key={tag} className="tag-chip">#{tag}</span>
                    ))}
                  </div>
                )}

                <dl className="detail-metadata">
                  <dt>Horodatage</dt>
                  <dd>
                    <time dateTime={new Date(selectedEvent.timestamp).toISOString()}>
                      {new Date(selectedEvent.timestamp).toLocaleString('fr-FR')}
                    </time>
                  </dd>

                  {selectedEvent.coordinates && (
                    <>
                      <dt>Coordonnées (décimal)</dt>
                      <dd>
                        {selectedEvent.coordinates[1].toFixed(4)}, {selectedEvent.coordinates[0].toFixed(4)}
                      </dd>

                      <dt>Coordonnées (DMS)</dt>
                      <dd>
                        {toDMS(selectedEvent.coordinates[1], true)} {toDMS(selectedEvent.coordinates[0], false)}
                      </dd>
                    </>
                  )}
                </dl>

                {selectedEvent.coordinates && (
                  <button
                    type="button"
                    className="locate-button-inline"
                    onClick={() => handleLocate(selectedEvent.id)}
                  >
                    Localiser sur la carte
                  </button>
                )}

                {selectedEvent.rawUrl && (
                  <a
                    href={selectedEvent.rawUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Consulter la source
                  </a>
                )}
              </>
            ) : (
              <p className="panel-message">
                Sélectionnez un point ou une dépêche.
              </p>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
