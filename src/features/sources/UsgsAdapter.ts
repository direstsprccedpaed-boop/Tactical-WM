import { httpTransport } from '@/core/net/HttpTransport';
import type { ScheduledTask } from '@/core/net/Scheduler';
import { parserClient } from '@/core/parsing/ParserClient';
import { db } from '@/core/storage/db';
import { eventStore } from '@/stores/eventStore';

export const USGS_SOURCE_ID = 'usgs-earthquakes';

export const usgsSource = {
  sourceId: USGS_SOURCE_ID,
  name: 'USGS Earthquakes',
  url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  freshnessTargetMs: 5 * 60 * 1_000,
  transport: 'web' as const,
  priority: 100,
};

export function createUsgsTask(): ScheduledTask<void> {
  return {
    id: USGS_SOURCE_ID,
    priority: usgsSource.priority,

    run: async (signal) => {
      const store = eventStore.getState();
      store.setSourceStatus(USGS_SOURCE_ID, 'loading');

      const metadata = await db.source_metadata.get(USGS_SOURCE_ID);

      const response = await httpTransport.get({
        url: usgsSource.url,
        transport: 'web',
        etag: metadata?.etag,
        lastModified: metadata?.lastModified,
        signal,
        timeoutMs: 20_000,
      });

      if (response.notModified) {
        await db.recordSourceSuccess(USGS_SOURCE_ID, {
          etag: metadata?.etag,
          lastModified: metadata?.lastModified,
        });

        store.setSourceStatus(USGS_SOURCE_ID, 'ready');
        return;
      }

      if (!response.ok) {
        throw new Error(`USGS HTTP ${response.status}`);
      }

      const events = await parserClient.parse(
        'usgs-geojson',
        USGS_SOURCE_ID,
        response.bodyText,
      );

      await db.upsertEvents(events);

      await db.recordSourceSuccess(USGS_SOURCE_ID, {
        etag: response.etag,
        lastModified: response.lastModified,
      });

      await db.purgeEventsOlderThan();

      store.upsertEvents(events);
      store.setSourceStatus(USGS_SOURCE_ID, 'ready');
    },

    onError: async () => {
      await db.recordSourceFailure(USGS_SOURCE_ID);
      eventStore.getState().setSourceStatus(USGS_SOURCE_ID, 'error');
    },
  };
}
