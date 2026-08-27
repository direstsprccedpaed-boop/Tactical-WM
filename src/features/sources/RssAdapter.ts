import { httpTransport } from '@/core/net/HttpTransport';
import type { ScheduledTask } from '@/core/net/Scheduler';
import { parserClient } from '@/core/parsing/ParserClient';
import { db } from '@/core/storage/db';
import { eventStore } from '@/stores/eventStore';

export interface RssSourceDefinition {
  sourceId: string;
  name: string;
  url: string;
  freshnessTargetMs: number;
  transport: 'native';
  priority: number;
}

export const RSS_SOURCES: RssSourceDefinition[] = [
  {
    sourceId: 'bbc-world',
    name: 'BBC World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    freshnessTargetMs: 15 * 60 * 1_000,
    transport: 'native',
    priority: 70,
  },
];

export function createRssTask(
  source: RssSourceDefinition,
): ScheduledTask<void> {
  return {
    id: source.sourceId,
    priority: source.priority,

    run: async (signal) => {
      const store = eventStore.getState();
      store.setSourceStatus(source.sourceId, 'loading');

      const metadata = await db.source_metadata.get(source.sourceId);

      const response = await httpTransport.get({
        url: source.url,
        transport: 'native',
        etag: metadata?.etag,
        lastModified: metadata?.lastModified,
        signal,
        timeoutMs: 25_000,
        headers: {
          'User-Agent': 'WorldMonitorTactical/0.1',
        },
      });

      if (response.notModified) {
        await db.recordSourceSuccess(source.sourceId, {
          etag: metadata?.etag,
          lastModified: metadata?.lastModified,
        });

        store.setSourceStatus(source.sourceId, 'ready');
        return;
      }

      if (!response.ok) {
        throw new Error(`${source.name} HTTP ${response.status}`);
      }

      const events = await parserClient.parse(
        'rss-atom',
        source.sourceId,
        response.bodyText,
      );

      await db.upsertEvents(events);

      await db.recordSourceSuccess(source.sourceId, {
        etag: response.etag,
        lastModified: response.lastModified,
      });

      await db.purgeEventsOlderThan();

      store.upsertEvents(events);
      store.setSourceStatus(source.sourceId, 'ready');
    },

    onError: async () => {
      await db.recordSourceFailure(source.sourceId);
      eventStore.getState().setSourceStatus(source.sourceId, 'error');
    },
  };
}
