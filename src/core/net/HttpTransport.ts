import { CapacitorHttp } from '@capacitor/core';

export interface HttpRequestOptions {
  url: string;
  transport: 'web' | 'native';
  etag?: string;
  lastModified?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  notModified: boolean;
  bodyText: string;
  etag?: string;
  lastModified?: string;
}

class HttpTransport {
  async get(options: HttpRequestOptions): Promise<HttpResponse> {
    return options.transport === 'native'
      ? this.getNative(options)
      : this.getWeb(options);
  }

  private async getWeb(options: HttpRequestOptions): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...options.headers };

    if (options.etag) {
      headers['If-None-Match'] = options.etag;
    }

    if (options.lastModified) {
      headers['If-Modified-Since'] = options.lastModified;
    }

    const timeoutController = new AbortController();
    const timeoutId = options.timeoutMs
      ? setTimeout(() => timeoutController.abort(), options.timeoutMs)
      : undefined;

    const signal = options.signal
      ? mergeSignals(options.signal, timeoutController.signal)
      : timeoutController.signal;

    try {
      const response = await fetch(options.url, { headers, signal });

      if (response.status === 304) {
        return {
          ok: true,
          status: 304,
          notModified: true,
          bodyText: '',
        };
      }

      const bodyText = await response.text();

      return {
        ok: response.ok,
        status: response.status,
        notModified: false,
        bodyText,
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async getNative(options: HttpRequestOptions): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...options.headers };

    if (options.etag) {
      headers['If-None-Match'] = options.etag;
    }

    if (options.lastModified) {
      headers['If-Modified-Since'] = options.lastModified;
    }

    const response = await CapacitorHttp.request({
      method: 'GET',
      url: options.url,
      headers,
      connectTimeout: options.timeoutMs,
      readTimeout: options.timeoutMs,
    });

    if (response.status === 304) {
      return {
        ok: true,
        status: 304,
        notModified: true,
        bodyText: '',
      };
    }

    const bodyText = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data);

    const responseHeaders = normalizeHeaders(response.headers);

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      notModified: false,
      bodyText,
      etag: responseHeaders.etag,
      lastModified: responseHeaders['last-modified'],
    };
  }
}

function normalizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key.toLowerCase()] = value;
  }

  return normalized;
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();

  const abort = () => controller.abort();

  if (a.aborted || b.aborted) {
    controller.abort();
  } else {
    a.addEventListener('abort', abort, { once: true });
    b.addEventListener('abort', abort, { once: true });
  }

  return controller.signal;
}

export const httpTransport = new HttpTransport();
