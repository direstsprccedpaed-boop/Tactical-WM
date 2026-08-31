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

/**
 * Sources RSS vérifiées gratuites, sans clé, compatibles CapacitorHttp.
 * Aucune source "Finance/Marchés" dédiée n'a pu être ajoutée avec une URL
 * garantie stable (Bloomberg a fermé son RSS public, Investing.com exige
 * une inscription webmaster) — le pilier finance reste alimenté par
 * classification thématique du contenu des flux ci-dessous en attendant
 * une source qualifiée.
 */
export const RSS_SOURCES: RssSourceDefinition[] = [
  {
    sourceId: 'rfi-monde',
    name: 'RFI Monde',
    url: 'https://www.rfi.fr/fr/monde/rss',
    freshnessTargetMs: 15 * 60 * 1_000,
    transport: 'native',
    priority: 70,
  },
  {
    sourceId: 'nasa-breaking-news',
    name: 'NASA',
    url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
    freshnessTargetMs: 30 * 60 * 1_000,
    transport: 'native',
    priority: 60,
  },
  {
    sourceId: 'techcrunch-ai',
    name: 'TechCrunch IA',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    freshnessTargetMs: 20 * 60 * 1_000,
    transport: 'native',
    priority: 55,
  },
  {
    sourceId: 'oilprice-main',
    name: 'OilPrice.com',
    url: 'https://oilprice.com/rss/main',
    freshnessTargetMs: 30 * 60 * 1_000,
    transport: 'native',
    priority: 55,
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
