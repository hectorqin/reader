import { ApiError, errorForStatus, parseErrorBody } from '../api/errors.ts';
import type { HttpRequest, HttpResponse, Transport } from './platform.ts';

/**
 * `fetch`-based transport used by the browser and by the Android shell for
 * everything that does not benefit from a native path.
 *
 * Network failures are normalised into `ApiError('offline')` — see the note in
 * errors.ts. That single conversion is what lets the sync engine stay agnostic
 * about *why* a request failed.
 */
export class FetchTransport implements Transport {
  constructor(private readonly baseUrl: () => string) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    const url = /^https?:/i.test(request.url) ? request.url : `${this.baseUrl()}${request.url}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers: request.headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
        mode: 'cors',
        credentials: 'omit',
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ApiError('aborted', 'request aborted');
      }
      // DNS failure, refused connection, TLS error, CORS preflight rejection.
      // From the reader's point of view all of these mean "server not reachable
      // right now", and the UI must degrade to cached content instead of
      // showing a stack trace.
      throw new ApiError('offline', err instanceof Error ? err.message : 'network error');
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    if (request.binary) {
      if (!response.ok) throw await this.toError(response);
      const buffer = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, headers, bytes: buffer };
    }

    const text = await response.text();
    if (!response.ok) throw this.errorFromText(response.status, text);
    if (!text) return { status: response.status, headers };
    try {
      return { status: response.status, headers, json: JSON.parse(text) };
    } catch {
      // A 200 with a non-JSON body means something in front of the server
      // answered (a captive portal, a stale service worker). Treating it as a
      // transport failure keeps the offline path honest.
      throw new ApiError('offline', 'server returned a non-JSON response', 'BAD_GATEWAY', response.status);
    }
  }

  private async toError(response: Response): Promise<ApiError> {
    const text = await response.text().catch(() => '');
    return this.errorFromText(response.status, text);
  }

  private errorFromText(status: number, text: string): ApiError {
    const { code, message } = parseErrorBody(text);
    return new ApiError(
      errorForStatus(status),
      message || `request failed with status ${status}`,
      code,
      status,
    );
  }
}
