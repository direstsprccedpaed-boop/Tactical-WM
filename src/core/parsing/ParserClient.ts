import type { NormalizedEvent } from '@/core/domain/NormalizedEvent';

type ParseKind = 'usgs-geojson' | 'rss-atom';

interface ParseSuccess {
  requestId: string;
  ok: true;
  events: NormalizedEvent[];
}

interface ParseFailure {
  requestId: string;
  ok: false;
  error: string;
}

type ParseResponse = ParseSuccess | ParseFailure;

export class ParserClient {
  private readonly worker = new Worker(
    new URL('../../workers/parser.worker.ts', import.meta.url),
    { type: 'module' },
  );

  private readonly pending = new Map<
    string,
    {
      resolve: (events: NormalizedEvent[]) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor() {
    this.worker.onmessage = (message: MessageEvent<ParseResponse>) => {
      const response = message.data;
      const operation = this.pending.get(response.requestId);

      if (!operation) {
        return;
      }

      this.pending.delete(response.requestId);

      if (response.ok) {
        operation.resolve(response.events);
      } else {
        operation.reject(new Error(response.error));
      }
    };

    this.worker.onerror = (event) => {
      const error = new Error(event.message);

      for (const operation of this.pending.values()) {
        operation.reject(error);
      }

      this.pending.clear();
    };
  }

  parse(
    kind: ParseKind,
    sourceId: string,
    payload: string,
  ): Promise<NormalizedEvent[]> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });

      this.worker.postMessage({
        requestId,
        kind,
        sourceId,
        payload,
        receivedAt: Date.now(),
      });
    });
  }
}

export const parserClient = new ParserClient();
