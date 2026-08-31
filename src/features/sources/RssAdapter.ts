import { httpTransport } from '@/core/net/HttpTransport';
import type { ScheduledTask } from '@/core/net/Scheduler';
import { parserClient } from '@/core/parsing/ParserClient';
import type { SourceLanguage } from '@/core/domain/NormalizedEvent';
import { db } from '@/core/storage/db';
import { eventStore } from '@/stores/eventStore';

export interface RssSourceDefinition {
  sourceId: string;
  name: string;
  url: string;
  freshnessTargetMs: number;
  transport: 'native';
  priority: number;
  /**
   * Langue native du flux. Détermine si le contenu doit être proposé à la
   * traduction côté affichage (Round 1) — jamais pour du contenu déjà
   * francophone.
   */
  language: SourceLanguage;
}

/**
 * Sources RSS vérifiées gratuites, sans clé, compatibles CapacitorHttp.
 *
 * NB : une source "CNBC World Economy/Markets" avait été demandée mais
 * aucune URL RSS CNBC vérifiable n'a pu être confirmée (ni via recherche,
 * ni via requête directe) au moment de cette intégration — elle est donc
 * volontairement omise plutôt que fabriquée. Si tu disposes de l'URL
 * exacte, elle s'ajoute au tableau ci-dessous selon le même schéma.
 */
export const RSS_SOURCES: RssSourceDefinition[] = [
  {
    sourceId: 'rfi-monde',
    name: 'RFI Monde',
    url: 'https://www.rfi.fr/fr/monde/rss',
    freshnessTargetMs: 15 * 60 * 1_000,
    transport: 'native',
    priority: 70,
    language: 'fr',
  },
  {
    sourceId: 'nasa-breaking-news',
    name: 'NASA',
    url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
    freshnessTargetMs: 30 * 60 * 1_000,
    transport: 'native',
    priority: 60,
    language: 'en',
  },
  {
    sourceId: 'techcrunch-ai',
    name: 'TechCrunch IA',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    freshnessTargetMs: 20 * 60 * 1_000,
    transport: 'native',
    priority: 55,
    language: 'en',
  },
  {
    sourceId: 'oilprice-main',
    name: 'OilPrice.com',
    url: 'https://oilprice.com/rss/main',
    freshnessTargetMs: 30 * 60 * 1_000,
    transport: 'native',
    priority: 55,
    language: 'en',
  },
  {
    sourceId: 'marketwatch-commodities',
    name: 'MarketWatch Commodities',
    url: 'https://feeds.content.dowjones.io/public/rss/mw_commodities',
    freshnessTargetMs: 15 * 60 * 1_000,
    transport: 'native',
    priority: 65,
    language: 'en',
  },
  {
    sourceId: 'boursier-com',
    name: 'Boursier.com',
    url: 'https://www.boursier.com/rss/news/actualites.xml',
    freshnessTargetMs: 15 * 60 * 1_000,
    transport: 'native',
    priority: 65,
    language: 'fr',
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

      const parsedEvents = await parserClient.parse(
        'rss-atom',
        source.sourceId,
        response.bodyText,
      );

      // La langue native de la source est connue ici (métadonnée
      // d'adaptateur), pas dans le Worker de parsing structurel : on
      // l'attache après coup plutôt que d'étendre le protocole du Worker.
      const events = parsedEvents.map((event) => ({
        ...event,
        sourceLanguage: source.language,
        sourceLabel: event.sourceLabel ?? source.name,
      }));

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
