// P3-HD M3a: the one fetch main's OAuth requests use (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md Decision
// Log 13). Every discovery, registration, token, refresh and revocation request passes the SDK's lower-level helpers
// this function as their `fetchFn`, so the policy holds below the SDK:
//
// - Only HTTPS endpoints, plus plain HTTP on the literal 127.0.0.1 (the scratch fixture servers); never `localhost`,
//   another loopback spelling or a URL carrying userinfo.
// - Redirects are never followed by the platform fetch (`redirect: 'manual'`). The SDK's `fetchWithinOrigin` follows a
//   same-origin redirect itself through this function again; a cross-origin one comes back as the response.
// - A network failure becomes `OAuthTransportError('network')`, not a TypeError: the SDK reads a TypeError as a CORS
//   refusal and retries without headers or treats the endpoint as absent (`fetchWithCorsRetry`), masking an outage.
// - The owner's signal and a per-request deadline abort the request, the body read included; the body is read whole
//   within a byte bound before the SDK sees it.
//
// Errors carry fixed words only: no URL, host or platform message.
export type OAuthFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
type BaseFetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const OAUTH_REQUEST_TIMEOUT_MS = 15_000;
export const OAUTH_RESPONSE_LIMIT_BYTES = 1_048_576;

export type OAuthTransportFailure = 'insecure' | 'network' | 'tooLarge' | 'cancelled' | 'timeout';
export class OAuthTransportError extends Error {
  constructor(readonly code: OAuthTransportFailure) {
    super(`OAuth request ${code}`);
    this.name = 'OAuthTransportError';
  }
}

// P3-F L271: the plain-HTTP exception is matched on the address as written, since WHATWG parsing turns other spellings
// of the loopback (2130706433, 127.1, 0x7f.0.0.1, a trailing dot, percent-escapes) into 127.0.0.1. A URL object keeps no
// spelling, so its canonical href is what is checked; each one MAWS passes is built from a string checked here.
const LITERAL_LOOPBACK = /^http:\/\/127\.0\.0\.1(?::\d*)?(?:[/?#]|$)/i;

export function isPermittedOAuthUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && url.hostname === '127.0.0.1' && LITERAL_LOOPBACK.test(typeof value === 'string' ? value : value.href);
}

const NULL_BODY = new Set([204, 205, 304]);

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => {});
    throw new OAuthTransportError('tooLarge');
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('aborted');
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => {});
        throw new OAuthTransportError('tooLarge');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function boundedOAuthFetch(base: BaseFetch, signal: AbortSignal, opts: { timeoutMs?: number; limitBytes?: number } = {}): OAuthFetch {
  const timeoutMs = opts.timeoutMs ?? OAUTH_REQUEST_TIMEOUT_MS;
  const limit = opts.limitBytes ?? OAUTH_RESPONSE_LIMIT_BYTES;
  return async (url, init) => {
    if (!isPermittedOAuthUrl(url)) throw new OAuthTransportError('insecure');
    if (signal.aborted) throw new OAuthTransportError('cancelled');
    const request = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; request.abort(); }, timeoutMs);
    const onAbort = () => request.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const failure = (error: unknown): OAuthTransportError => {
      if (error instanceof OAuthTransportError) return error;
      if (timedOut) return new OAuthTransportError('timeout');
      if (signal.aborted) return new OAuthTransportError('cancelled');
      return new OAuthTransportError('network');
    };
    try {
      let response: Response;
      try {
        response = await base(url, { ...init, redirect: 'manual', signal: request.signal });
      } catch (error) {
        throw failure(error);
      }
      if (response.status < 200 || response.status > 599) {
        await response.body?.cancel().catch(() => {});
        throw new OAuthTransportError('network'); // an opaque or impossible answer
      }
      let body: Uint8Array;
      try {
        body = await readBounded(response, limit, request.signal);
      } catch (error) {
        throw failure(error);
      }
      return new Response(NULL_BODY.has(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  };
}
