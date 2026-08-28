import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

import { scheduler } from '@/core/net/Scheduler';
import { TacticalDashboard } from '@/features/dashboard/TacticalDashboard';
import { createGdacsTask } from '@/features/sources/GdacsAdapter';
import { createRssTask, RSS_SOURCES } from '@/features/sources/RssAdapter';
import { createUsgsTask } from '@/features/sources/UsgsAdapter';
import { useEventStore } from '@/stores/eventStore';

function enqueueSync(): void {
  scheduler.enqueue(createUsgsTask());
  scheduler.enqueue(createGdacsTask());

  for (const source of RSS_SOURCES) {
    scheduler.enqueue(createRssTask(source));
  }
}

export default function App() {
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

  return <TacticalDashboard />;
}
