import { useMemo, useState } from 'react';

import { MapContainer } from '@/features/map/MapContainer';
import type { EventCategory } from '@/core/domain/NormalizedEvent';
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
};

const LAYER_LABELS: Record<MapLayerId, string> = {
  'layer-seismic': 'Séismes & volcans',
  'layer-weather': 'Météo & catastrophes',
  'layer-news': 'Actualités & conflits',
  'layer-infra': 'Infrastructures stratégiques',
};

const LAYER_ORDER: MapLayerId[] = [
  'layer-seismic',
  'layer-weather',
  'layer-news',
  'layer-infra',
];

const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

export function TacticalDashboard() {
  const [compactTab, setCompactTab] = useState<CompactTab>('map');
  const [controllerOpen, setControllerOpen] = useState(true);

  const hydrated = useEventStore((state) => state.hydrated);
  const hydrationError = useEventStore((state) => state.hydrationError);
  const selectedEventId = useEventStore((state) => state.selectedEventId);
  const eventsById = useEventStore((state) => state.eventsById);
  const activeLayers = useEventStore((state) => state.activeLayers);
  const filters = useEventStore((state) => state.filters);
  const viewportFilterEnabled = useEventStore((state) => state.viewportFilterEnabled);
  const getVisibleListEvents = useEventStore((state) => state.getVisibleListEvents);
  const selectEvent = useEventStore((state) => state.selectEvent);
  const toggleLayer = useEventStore((state) => state.toggleLayer);
  const setFilters = useEventStore((state) => state.setFilters);
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

    return `${events.length} événement(s) affiché(s)${viewportFilterEnabled ? ' · zone visible' : ''}`;
  }, [events.length, hydrated, viewportFilterEnabled]);

  const handleLocate = (eventId: string) => {
    setCompactTab('map');
    requestFlyTo(eventId);
  };

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
              Contrôleur tactique {controllerOpen ? '▾' : '▸'}
            </button>

            {controllerOpen && (
              <div className="tactical-controller-body">
                <fieldset className="layer-toggle-list">
                  <legend>Calques</legend>

                  {LAYER_ORDER.map((layerId) => (
                    <label key={layerId} className="layer-toggle">
                      <input
                        type="checkbox"
                        checked={activeLayers[layerId]}
                        onChange={() => toggleLayer(layerId)}
                      />
                      {LAYER_LABELS[layerId]}
                    </label>
                  ))}
                </fieldset>

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
              {events.slice(0, 100).map((event) => (
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
                      <small>
                        Sévérité {Math.round(event.severity * 100)} %
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
              ))}
            </ul>
          </section>

          <section className="event-detail" aria-live="polite">
            <h2>Détail</h2>

            {selectedEvent ? (
              <>
                <span className={`event-category category-${selectedEvent.category}`}>
                  {CATEGORY_LABELS[selectedEvent.category]}
                </span>
                <h3>{selectedEvent.title}</h3>
                <p>{selectedEvent.summary || 'Aucun résumé disponible.'}</p>
                <time dateTime={new Date(selectedEvent.timestamp).toISOString()}>
                  {new Date(selectedEvent.timestamp).toLocaleString('fr-FR')}
                </time>

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
