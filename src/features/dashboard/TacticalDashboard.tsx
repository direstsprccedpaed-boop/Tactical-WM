import { useMemo, useState } from 'react';

import { MapContainer } from '@/features/map/MapContainer';
import { useEventStore } from '@/stores/eventStore';

import './TacticalDashboard.css';

type CompactTab = 'map' | 'alerts';

export function TacticalDashboard() {
  const [compactTab, setCompactTab] = useState<CompactTab>('map');

  const hydrated = useEventStore((state) => state.hydrated);
  const hydrationError = useEventStore((state) => state.hydrationError);
  const selectedEventId = useEventStore((state) => state.selectedEventId);
  const eventsById = useEventStore((state) => state.eventsById);
  const getFilteredEvents = useEventStore((state) => state.getFilteredEvents);
  const selectEvent = useEventStore((state) => state.selectEvent);

  const events = getFilteredEvents();
  const selectedEvent = selectedEventId
    ? eventsById[selectedEventId] ?? null
    : null;

  const status = useMemo(() => {
    if (!hydrated) {
      return 'Chargement du snapshot Dexie…';
    }

    return `${events.length} événement(s) en cache local`;
  }, [events.length, hydrated]);

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
            styleUrl="/map/style.json"
          />
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
                Aucun événement local. Utilisez Synchroniser.
              </p>
            )}

            <ul className="event-list">
              {events.slice(0, 100).map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    className={event.id === selectedEventId ? 'is-selected' : ''}
                    onClick={() => selectEvent(event.id)}
                  >
                    <span className={`event-category category-${event.category}`}>
                      {event.category}
                    </span>
                    <strong>{event.title}</strong>
                    <small>
                      Sévérité {Math.round(event.severity * 100)} %
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="event-detail" aria-live="polite">
            <h2>Détail</h2>

            {selectedEvent ? (
              <>
                <h3>{selectedEvent.title}</h3>
                <p>{selectedEvent.summary || 'Aucun résumé disponible.'}</p>
                <time dateTime={new Date(selectedEvent.timestamp).toISOString()}>
                  {new Date(selectedEvent.timestamp).toLocaleString('fr-FR')}
                </time>

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
