import Dexie, { type Table } from 'dexie';

import type { NormalizedEvent } from '@/core/domain/NormalizedEvent';

export interface SourceMetadata {
  sourceId: string;
  etag?: string;
  lastModified?: string;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  consecutiveFailures: number;
}

const RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;

class WorldMonitorDatabase extends Dexie {
  events!: Table<NormalizedEvent, string>;
  source_metadata!: Table<SourceMetadata, string>;

  constructor() {
    super('world-monitor-tactical');

    this.version(1).stores({
      events: 'id, sourceId, timestamp, category, severity',
      source_metadata: 'sourceId',
    });
  }

  async upsertEvents(events: NormalizedEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.events.bulkPut(events);
  }

  async purgeEventsOlderThan(retentionMs = RETENTION_MS): Promise<void> {
    const threshold = Date.now() - retentionMs;

    await this.events.where('timestamp').below(threshold).delete();
  }

  async recordSourceSuccess(
    sourceId: string,
    metadata: { etag?: string; lastModified?: string },
  ): Promise<void> {
    await this.source_metadata.put({
      sourceId,
      etag: metadata.etag,
      lastModified: metadata.lastModified,
      lastSuccessAt: Date.now(),
      consecutiveFailures: 0,
    });
  }

  async recordSourceFailure(sourceId: string): Promise<void> {
    const existing = await this.source_metadata.get(sourceId);

    await this.source_metadata.put({
      sourceId,
      etag: existing?.etag,
      lastModified: existing?.lastModified,
      lastSuccessAt: existing?.lastSuccessAt,
      lastFailureAt: Date.now(),
      consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
    });
  }
}

export const db = new WorldMonitorDatabase();
