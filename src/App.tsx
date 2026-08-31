import { useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

import { scheduler } from '@/core/net/Scheduler';
import { TacticalDashboard } from '@/features/dashboard/TacticalDashboard';
import { SituationRoom } from '@/features/analysis/SituationRoom';
import { createGdacsTask } from '@/features/sources/GdacsAdapter';
import { createRssTask, RSS_SOURCES } from '@/features/sources/RssAdapter';
import { createUsgsTask } from '@/features/sources/UsgsAdapter';
import { useEventStore } from '@/stores/eventStore';

type AppTab = 'map' | 'situation';

function enqueueSync(): void {
  scheduler.enqueue(createUsgsTask());
  scheduler.enqueue(createGdacsTask());

  for (const source of RSS_SOURCES) {
    scheduler.enqueue(createRssTask(source));
  }
}

export default function App() {
  const [tab, setTab] = useState<AppTab>('map');
  const hydrateFromCache = useEventStore((state) => state.hydrateFromCache);
  const hasBootstrapped = useRef(false);

  useEffect(() => {
    void hydrateFromCache().finally(() => {
      if (!hasBootstrapped.current) {
        hasBootstrapped.current = true;
        enqueueSync();
      }
    });

    const listenerPromise = CapacitorApp.addListener(
      'appStateChange',
      ({ isActive }) => {
        if (!isActive) {
          scheduler.abortAll();
          return;
        }

        if (!hasBootstrapped.current) {
          return;
        }

        scheduler.resume();
        enqueueSync();
      },
    );

    return () => {
      void listenerPromise.then((listener) => listener.remove());
      scheduler.abortAll();
    };
  }, [hydrateFromCache]);

  return (
    <div className="app-root">
      <nav className="app-tab-switcher" role="tablist" aria-label="Modules opérationnels">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'map'}
          className={tab === 'map' ? 'is-active' : ''}
          onClick={() => setTab('map')}
        >
          Carte tactique
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'situation'}
          className={tab === 'situation' ? 'is-active' : ''}
          onClick={() => setTab('situation')}
        >
          Salle de situation
        </button>
      </nav>

      <div className="app-tab-content">
        {tab === 'map' ? <TacticalDashboard /> : <SituationRoom />}
      </div>
    </div>
  );
}
