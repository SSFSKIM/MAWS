// MAWS's egress rules (P4-B2 D19; the P4 spec's §4.10 R-8; lifted from src/engine-host/egress.ts by P4-AGG, the
// Discover spec's Decision Log, fourth entry): every outbound request MAWS makes on its own, beyond the model's, declared
// here as data, behind one guarded GET that the engine host and main both import. Route D's transport
// (engine-host/connectors/direct-http.ts) is the host's other door, scoped to a verified server's own URL; nothing else in
// src/engine-host or src/main/catalog calls `fetch` (egress.test.ts guards both sources). A rule admits:
// - GET only, to exactly the routes it lists (an https origin, a path, the query it may carry); anything else is
//   refused before the network;
// - no cookies or credentials (`credentials: 'omit'`, no header but the user agent a caller names), no referrer, no
//   cache, and no redirect (a 3xx answer is refused, never followed, so a request never leaves the list);
// - per response, a timeout, a size cap read as the body streams, and the content types the route answers with.
// A 2xx answer comes back with its bytes; any other status comes back alone, its body unread, for the caller to name.
//
// - `google-fonts`: a deck's or a design's named Google Fonts face, fetched once into the artifact's assets when its
//   licence is OFL, never at render (engine-host/presentations/google-faces.ts). Under MAWS_E2E=1 the network is never
//   reached: MAWS_GOOGLE_FONTS_FIXTURES names a directory whose `map.json` answers URLs from files, and a URL it does not
//   list fails as offline (as every URL does when no directory is named).
// - `catalog`: Discover's catalog (main/catalog/fetch.ts): the seed marketplaces' manifests, Anthropic's public directory
//   of plugins and of connectors, the public install counts of the official marketplace that the engine itself reads, and
//   the icons the directory names on its own two origins (main/catalog/icons.ts; the Discover spec's Decision Log 7(b):
//   any other icon host, Google's favicon service included, is never asked, and the card draws a monogram). Read for the
//   person and cached for them; nothing is sent anywhere. Its e2e seam is the catalog's own
//   (MAWS_CATALOG_FIXTURES, read by fetch.ts in place of this rule); under MAWS_E2E=1 it never reaches the network.
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

const MiB = 1024 * 1024;
// The page tokens the directory hands back (`next_page`, `next_cursor`), as URLSearchParams writes them.
const TOKEN = '[A-Za-z0-9._~%-]{1,512}';

// Measured by the catalog's live walk on 2026-10-25 (scripts/catalog-summary.mjs; the Discover spec's Surprises &
// Discoveries): every seed manifest served as text/plain (the largest, claude-community's, 1,566,074 bytes), the
// directory and plugin-details as application/json (the plugins page 13,149,916 bytes in one page, the servers 1,348,270,
// 1,268,217 and 22,693 bytes over three pages, plugin-details 538,696 bytes), the whole walk in 1.4 s. Each cap leaves the
// source room to grow about fourfold (a manifest's matches the engine's own 8 MiB bound on marketplace.json) before a
// refresh is refused as `tooLarge`, its last copy kept. The icons, measured on 2026-10-25 (every Anthropic-origin icon
// the live directory named, each fetched once): 756 plugin icons, all image/png, 876 to 111,087 bytes (median 13,906);
// 11 server icons in the directory's own bucket, 4 image/png and 7 image/svg+xml, 447 to 93,026 bytes. Their cap, 512 KiB,
// is about five times the largest.
export const ICON_CONTENT_TYPES = ['image/png', 'image/svg+xml'] as const;
export const CATALOG_EGRESS: EgressRule = {
  name: 'catalog',
  purpose: 'Discover’s catalog: seed marketplace manifests, Anthropic’s public plugin and connector directory, the official marketplace’s public install counts; read for the person, never sent anywhere (P4-AGG)',
  timeoutMs: 120_000, // per request, body included: a background refresh; the 13 MB plugins page over a slow link
  routes: [
    // a seed marketplace's manifest, at its default branch (GitHub serves every raw file as text)
    { origin: 'https://raw.githubusercontent.com', path: /^\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/HEAD\/\.claude-plugin\/marketplace\.json$/, query: null, contentTypes: ['text/plain'], maxBytes: 8 * MiB },
    // the directory's public plugins, in pages of 5,000 (one page today)
    { origin: 'https://api.anthropic.com', path: /^\/api\/directory\/plugins$/, query: new RegExp(`^\\?visibility=public&limit=5000(?:&page=${TOKEN})?$`), contentTypes: ['application/json'], maxBytes: 48 * MiB },
    // the directory's servers (connectors), in pages of 500
    { origin: 'https://api.anthropic.com', path: /^\/api\/directory\/servers$/, query: new RegExp(`^\\?limit=500(?:&cursor=${TOKEN})?$`), contentTypes: ['application/json'], maxBytes: 4 * MiB },
    // the official marketplace's install counts and contents, which the engine reads with no credentials
    { origin: 'https://storage.googleapis.com', path: /^\/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819\/plugin-stats\/plugin-details\.json$/, query: null, contentTypes: ['application/json'], maxBytes: 2 * MiB },
    // a directory plugin's icon (`media.icons[].url`), named by its content's sha256, always the 256-pixel PNG
    { origin: 'https://api.anthropic.com', path: /^\/api\/directory\/plugin-icons\/[0-9a-f]{64}\/256\.png$/, query: null, contentTypes: ['image/png'], maxBytes: 512 * 1024 },
    // a directory server's icon (`icon_url`) in the directory's own media bucket
    { origin: 'https://storage.googleapis.com', path: /^\/media-assets-299d7136-cb52-d546-ee02-34bc1307c35f\/mcp-directory\/icons\/[A-Za-z0-9._-]{1,100}\.(?:png|svg)$/, query: null, contentTypes: ['image/png', 'image/svg+xml'], maxBytes: 512 * 1024 },
  ],
};

/** Every rule MAWS declares. */
export const EGRESS_RULES: readonly EgressRule[] = [GOOGLE_FONTS_EGRESS, CATALOG_EGRESS];

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
/** `maxBytes` lowers the route's cap for one request (a walk's remaining budget, fetch.ts); it never raises it. */
export type EgressGet = (url: string, options?: { userAgent?: string; signal?: AbortSignal; maxBytes?: number }) => Promise<EgressAnswer>;
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
    const max = Math.min(route.maxBytes, options.maxBytes ?? route.maxBytes);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > max) {
      await response.body?.cancel().catch(() => {});
      throw new EgressError('tooLarge', `${url} is ${declared} bytes (over ${max})`);
    }
    try {
      return { status: response.status, contentType, bytes: await bounded(response, max, url) };
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

/** The fetch under the host's google-fonts egress: the e2e's fixtures under MAWS_E2E=1 (never the network), else the network. */
export const egressBase = (env: Record<string, string | undefined>): BaseFetch => (env.MAWS_E2E === '1' ? fixtureFetch(env.MAWS_GOOGLE_FONTS_FIXTURES || null) : networkFetch);
