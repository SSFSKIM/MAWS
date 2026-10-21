// The engine host's egress rules (P4-B2 D19; the P4 spec's §4.10 R-8): every outbound request the host makes on its
// own, declared here as data, behind one guarded fetch. Route D's transport (connectors/direct-http.ts) is the other
// door, scoped to a verified server's own URL; nothing else in src/engine-host calls `fetch` (egress.test.ts guards the
// source). A rule admits:
// - GET only, to exactly the routes it lists (an https origin, a path, the query it may carry); anything else is
//   refused before the network;
// - no cookies or credentials (`credentials: 'omit'`, no header but the user agent a caller names), no referrer, no
//   cache, and no redirect (a 3xx answer is refused, never followed, so a request never leaves the list);
// - per response, a timeout, a size cap read as the body streams, and the content types the route answers with.
// A 2xx answer comes back with its bytes; any other status comes back alone, its body unread, for the caller to name.
//
// `google-fonts` is its only rule: a deck's or a design's named Google Fonts face, fetched once into the artifact's
// assets when its licence is OFL, never at render (presentations/google-faces.ts). Under MAWS_E2E=1 the network is
// never reached: MAWS_GOOGLE_FONTS_FIXTURES names a directory whose `map.json` answers URLs from files, and a URL it
// does not list fails as offline (as every URL does when no directory is named).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';

export interface EgressRoute {
  /** The origin, exactly (`https://host`, no port, no credentials). */
  origin: string;
  /** The path, whole. */
  path: RegExp;
  /** The query, whole (`?…`), or null for none. */
  query: RegExp | null;
  /** The media types a 2xx answer may carry (before any `;` parameter). */
  contentTypes: readonly string[];
  maxBytes: number;
}

export interface EgressRule {
  name: string;
  /** Why the host makes these requests, for whoever reads the declaration. */
  purpose: string;
  timeoutMs: number;
  routes: readonly EgressRoute[];
}

export const GOOGLE_FONTS_EGRESS: EgressRule = {
  name: 'google-fonts',
  purpose: 'a Google Fonts face a deck or a design names, fetched once into its assets when its licence is OFL (P4-B2 D19)',
  timeoutMs: 20_000,
  routes: [
    // the family's CSS2 answer, asked for one family with its axis tuple (slides/google-faces.ts's canonical request)
    { origin: 'https://fonts.googleapis.com', path: /^\/css2$/, query: /^\?family=[A-Za-z0-9+_:,.@;-]{1,300}$/, contentTypes: ['text/css'], maxBytes: 64 * 1024 },
    // one face file the answer names
    { origin: 'https://fonts.gstatic.com', path: /^\/s\/[A-Za-z0-9._~/-]{1,300}$/, query: null, contentTypes: ['font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'font/sfnt'], maxBytes: ARTIFACT_MAX_BYTES },
    // the licence: the family's METADATA.pb, and an OFL family's OFL.txt
    { origin: 'https://raw.githubusercontent.com', path: /^\/google\/fonts\/main\/(?:ofl|apache|ufl)\/[a-z0-9]{1,100}\/(?:METADATA\.pb|OFL\.txt)$/, query: null, contentTypes: ['text/plain'], maxBytes: 256 * 1024 },
  ],
};

/** Every rule the host declares. */
export const EGRESS_RULES: readonly EgressRule[] = [GOOGLE_FONTS_EGRESS];

/** Why a request was refused or failed; `notAdmitted` and `tooLarge` are the caller's to name, the rest transient. */
export type EgressFailure = 'notAdmitted' | 'redirect' | 'timeout' | 'network' | 'tooLarge' | 'contentType' | 'aborted';
export class EgressError extends Error {
  constructor(
    readonly failure: EgressFailure,
    message: string,
  ) {
    super(message);
  }
}

/** An answer: a 2xx with its bytes and media type, or any other status alone. */
export type EgressAnswer = { status: number; contentType: string; bytes: Uint8Array } | { status: number; contentType: null; bytes: null };
export type EgressGet = (url: string, options?: { userAgent?: string; signal?: AbortSignal }) => Promise<EgressAnswer>;
/** The fetch underneath, injectable for tests and the e2e. */
export type BaseFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The route of `rule` that admits `url`, or null. */
export function admitted(rule: EgressRule, url: string): EgressRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
  return rule.routes.find((route) => route.origin === parsed.origin && route.path.test(parsed.pathname) && (route.query ? route.query.test(parsed.search) : parsed.search === '')) ?? null;
}

const networkFetch: BaseFetch = (url, init) => globalThis.fetch(url, init);

/** The guarded GET of `rule` over `base` (the network by default). */
export function egressGet(rule: EgressRule, base: BaseFetch = networkFetch): EgressGet {
  return async (url, options = {}) => {
    const route = admitted(rule, url);
    if (!route) throw new EgressError('notAdmitted', `${rule.name} does not admit ${url}`);
    const headers: Record<string, string> = { accept: route.contentTypes.join(', ') + ', */*;q=0.1' };
    if (options.userAgent) headers['user-agent'] = options.userAgent;
    const timeout = AbortSignal.timeout(rule.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await base(url, { method: 'GET', headers, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal });
    } catch (error) {
      throw failed(error, signal, timeout, url);
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {});
      throw new EgressError('redirect', `${url} answered a redirect, which ${rule.name} never follows`);
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => {});
      return { status: response.status, contentType: null, bytes: null };
    }
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!route.contentTypes.includes(contentType)) {
      await response.body?.cancel().catch(() => {});
      throw new EgressError('contentType', `${url} answered ${contentType || 'no content type'}, not ${route.contentTypes.join(' or ')}`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > route.maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new EgressError('tooLarge', `${url} is ${declared} bytes (over ${route.maxBytes})`);
    }
    try {
      return { status: response.status, contentType, bytes: await bounded(response, route.maxBytes, url) };
    } catch (error) {
      throw error instanceof EgressError ? error : failed(error, signal, timeout, url);
    }
  };
}

function failed(error: unknown, signal: AbortSignal, timeout: AbortSignal, url: string): EgressError {
  if (timeout.aborted) return new EgressError('timeout', `${url} did not answer in time`);
  if (signal.aborted) return new EgressError('aborted', `${url}: the request was ended`);
  return new EgressError('network', `${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
}

/** The body's bytes, read until `max`: one byte more refuses it. */
async function bounded(response: Response, max: number, url: string): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new EgressError('tooLarge', `${url} is over ${max} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** One answer of the e2e's map: a file's bytes (none for a status alone), its status (200 by default) and type. */
interface FixtureEntry {
  file?: string;
  status?: number;
  type?: string;
}

/**
 * The fetch the e2e runs on (MAWS_E2E=1): `<dir>/map.json` answers each URL it lists from a file, and any other URL
 * fails as the network does offline. With no directory, every URL fails.
 */
export function fixtureFetch(dir: string | null): BaseFetch {
  const map = dir ? (JSON.parse(readFileSync(join(dir, 'map.json'), 'utf8')) as Record<string, FixtureEntry>) : {};
  return async (url, init) => {
    if (init.signal?.aborted) throw init.signal.reason;
    const entry = Object.hasOwn(map, url) ? map[url]! : null;
    if (!entry) throw new TypeError(`fetch failed: offline (the e2e's map has no ${url})`);
    const body = entry.file ? new Uint8Array(readFileSync(join(dir!, entry.file))) : null;
    return new Response(body, { status: entry.status ?? 200, headers: entry.type ? { 'content-type': entry.type } : {} });
  };
}

/** The fetch under the host's egress: the e2e's fixtures under MAWS_E2E=1 (never the network), else the network. */
export const egressBase = (env: Record<string, string | undefined>): BaseFetch => (env.MAWS_E2E === '1' ? fixtureFetch(env.MAWS_GOOGLE_FONTS_FIXTURES || null) : networkFetch);
