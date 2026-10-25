// The Discover catalog's network fetches (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Fetching"; Decision Log, fourth entry). Every request is a GET through MAWS's one guarded GET, `egressGet`, under the
// `catalog` rule (src/shared/net/egress.ts): no redirect followed, no credentials, a content type and a size cap per
// route. Four kinds of source, each walked whole:
// - `seed:<marketplace name>`: a seed's manifest at its repository's default branch, raw;
// - `directory:plugins`: the directory's public plugins, paged by `next_page` (one page of 5,000 today);
// - `directory:servers`: the directory's servers, paged by `next_cursor` (pages of 500);
// - `plugin-details`: the official marketplace's install counts and contents, as the engine reads them.
// The test seam: when MAWS_CATALOG_FIXTURES names a directory, `<dir>/<source key>.json` (`{key, recordedAt, pages}`, M1's
// recordings) answers in place of the network, its pages walked by the same tokens; a missing file is that source failing.
// Under MAWS_E2E=1 without it, every source fails as offline: the network is never reached, unless MAWS_CATALOG_LIVE=1
// names the opt-in live smoke (e2e/discover-live.spec.ts, M5), whose walk goes out as it does outside the harness.
// The icons (icons.ts) are fetched the same three ways: the rule's two icon routes on the network, the fixture
// directory's `icons/<sha256 of the URL>.<png|svg>` under the seam (a missing file is no icon), none under MAWS_E2E=1
// but for the live smoke.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { admitted, CATALOG_EGRESS, egressGet, ICON_CONTENT_TYPES, type EgressGet } from '@shared/net/egress';
import { SEEDS, seedOf } from './sources';

export const CATALOG_FIXTURES_ENV = 'MAWS_CATALOG_FIXTURES';
export const CATALOG_LIVE_ENV = 'MAWS_CATALOG_LIVE';

/** Whether this environment keeps the catalog off the network: the e2e harness, unless it runs the live smoke. */
const offline = (env: Record<string, string | undefined>) => env.MAWS_E2E === '1' && env[CATALOG_LIVE_ENV] !== '1';

const DIRECTORY = 'https://api.anthropic.com/api/directory';
const PLUGIN_DETAILS = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json';
const MAX_PAGES = 50; // far past any walk today (the plugins walk is one page, the servers walk three)
// One source's walk, every page together (scalpel-4#1, #2): the route caps bound one response, these bound the walk. The
// largest walk measured is the plugins page's 13,149,916 bytes in 1.16 s (2026-10-25); the budget leaves it room to grow
// about fivefold, and the deadline is one slow 120 s request (the rule's per-request timeout) and half again.
export const WALK_BUDGET_BYTES = 64 * 1024 * 1024;
export const WALK_DEADLINE_MS = 180_000;

export const NETWORK_KEYS: readonly string[] = [...SEEDS.map((s) => s.key), 'directory:plugins', 'directory:servers', 'plugin-details'];

export function sourceLabel(key: string): string {
  if (key === 'directory:plugins') return 'Anthropic’s directory: plugins';
  if (key === 'directory:servers') return 'Anthropic’s directory: connectors';
  if (key === 'plugin-details') return 'Install counts (official plugins)';
  return seedOf(key.slice('seed:'.length))?.label ?? key;
}

// The URL of one page of a source: the first (no token) or the one a page's token names.
export function pageUrl(key: string, token: string | null): string {
  const more = (name: string) => (token === null ? '' : `&${name}=${encodeURIComponent(token)}`);
  if (key === 'directory:plugins') return `${DIRECTORY}/plugins?visibility=public&limit=5000${more('page')}`;
  if (key === 'directory:servers') return `${DIRECTORY}/servers?limit=500${more('cursor')}`;
  if (key === 'plugin-details') return PLUGIN_DETAILS;
  const seed = seedOf(key.slice('seed:'.length));
  if (!key.startsWith('seed:') || seed === null) throw new Error(`no catalog source ${key}`);
  return `https://raw.githubusercontent.com/${seed.repository}/HEAD/.claude-plugin/marketplace.json`;
}

// The token a page names for the next one, or null at the end of the walk.
function nextToken(key: string, body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const token = key === 'directory:plugins' ? (body as { next_page?: unknown }).next_page : key === 'directory:servers' ? (body as { next_cursor?: unknown }).next_cursor : null;
  return typeof token === 'string' && token !== '' ? token : null;
}

/** One request of a walk, as measured: what the live summary records for the egress rule's caps. */
export interface Exchange {
  url: string;
  bytes: number;
  contentType: string;
  ms: number;
}
export interface Fetched {
  pages: unknown[]; // each page's JSON body, in walk order
  exchanges: Exchange[];
}
/** What one page may take of its walk: the walk's one signal (its deadline and its cancellation) and the bytes left. */
export interface PageLimits {
  signal: AbortSignal;
  maxBytes: number;
}
/** One page of a source: the first (token null) or the next. */
export type PageGet = (key: string, token: string | null, limits: PageLimits) => Promise<{ body: unknown; exchange: Exchange }>;
export interface WalkOptions {
  maxBytes?: number; // WALK_BUDGET_BYTES
  deadlineMs?: number; // WALK_DEADLINE_MS
  signal?: AbortSignal; // the caller's cancellation (the store's stop)
}

// `promise`, or the signal's end, whichever comes first (a page reader that does not honour the signal still stops the walk).
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** A source walked whole: its first page, then each page its predecessor names, all of them within one byte budget and
 * one deadline, under one cancellation. */
export async function fetchSource(key: string, get: PageGet, options: WalkOptions = {}): Promise<Fetched> {
  const budget = options.maxBytes ?? WALK_BUDGET_BYTES;
  const deadlineMs = options.deadlineMs ?? WALK_DEADLINE_MS;
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const ended = () => new Error(deadline.aborted ? `${key}: the walk passed its ${deadlineMs} ms deadline` : `${key}: the walk was stopped`);
  const pages: unknown[] = [];
  const exchanges: Exchange[] = [];
  const seen = new Set<string>();
  let spent = 0;
  let token: string | null = null;
  do {
    if (pages.length >= MAX_PAGES) throw new Error(`${key}: more than ${MAX_PAGES} pages`);
    if (signal.aborted) throw ended();
    let page: Awaited<ReturnType<PageGet>>;
    try {
      page = await untilAborted(get(key, token, { signal, maxBytes: budget - spent }), signal);
    } catch (error) {
      throw signal.aborted ? ended() : error;
    }
    const { body, exchange } = page;
    spent += exchange.bytes;
    if (spent > budget) throw new Error(`${key}: the walk is over its ${budget} byte budget`);
    pages.push(body);
    exchanges.push(exchange);
    token = nextToken(key, body);
    if (token !== null && seen.has(token)) throw new Error(`${key}: the walk named a page it had already read`);
    if (token !== null) seen.add(token);
  } while (token !== null);
  return { pages, exchanges };
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/** The network's pages, through the catalog egress rule. */
export function networkPages(get: EgressGet, userAgent: string, now: () => number = Date.now): PageGet {
  return async (key, token, { signal, maxBytes }) => {
    const url = pageUrl(key, token);
    const started = now();
    const answer = await get(url, { userAgent, signal, maxBytes });
    if (answer.bytes === null) throw new Error(`${url} answered HTTP ${answer.status}`);
    let body: unknown;
    try {
      body = JSON.parse(decoder.decode(answer.bytes));
    } catch {
      throw new Error(`${url} did not answer JSON`);
    }
    return { body, exchange: { url, bytes: answer.bytes.length, contentType: answer.contentType, ms: now() - started } };
  };
}

/** M1's recordings in place of the network: the first page, then the page after the one whose token was named. */
export function fixturePages(dir: string): PageGet {
  return async (key, token) => {
    const path = join(dir, `${key}.json`);
    const text = await readFile(path, 'utf8'); // a missing file is the source failing
    const recorded = JSON.parse(text) as { pages?: unknown };
    const pages = Array.isArray(recorded.pages) ? recorded.pages : [];
    const at = token === null ? 0 : pages.findIndex((page) => nextToken(key, page) === token) + 1;
    if (at <= 0 && token !== null) throw new Error(`${path} has no page after ${token}`);
    if (at >= pages.length) throw new Error(`${path} has no page ${at + 1}`);
    return { body: pages[at], exchange: { url: pageUrl(key, token), bytes: JSON.stringify(pages[at]).length, contentType: 'fixture', ms: 0 } };
  };
}

/** The pages the catalog reads in this environment: the fixtures, none under the e2e (but the live smoke), else the network. */
export function catalogPages(env: Record<string, string | undefined>, userAgent: string, get: EgressGet = egressGet(CATALOG_EGRESS)): PageGet {
  const fixtures = env[CATALOG_FIXTURES_ENV];
  if (fixtures) return fixturePages(fixtures);
  if (offline(env))
    return async (key) => {
      throw new Error(`${key}: offline (MAWS_E2E=1 never reaches the network)`);
    };
  return networkPages(get, userAgent);
}

// -- icons ---------------------------------------------------------------------------------------------------------

/** One icon's answer: its media type and bytes. */
export interface IconAnswer {
  contentType: string;
  bytes: Uint8Array;
}
/** An icon by its URL: the answer, or null when there is none (a non-2xx answer, a missing fixture); throws on a failure. */
export type IconGet = (url: string) => Promise<IconAnswer | null>;

/** Whether `url` is one of the catalog rule's icon routes (the directory's two Anthropic origins), the only icons fetched. */
export function isIconUrl(url: string): boolean {
  const route = admitted(CATALOG_EGRESS, url);
  return route !== null && route.contentTypes.every((type) => (ICON_CONTENT_TYPES as readonly string[]).includes(type));
}

/** An icon's file in the fixture directory's `icons/`: the sha256 of its URL and its extension. */
export const iconsFixtureName = (url: string): string => `${createHash('sha256').update(url).digest('hex')}${url.endsWith('.svg') ? '.svg' : '.png'}`;

/** The icons this environment reads: the fixtures, none under the e2e (but the live smoke), else the network through the catalog rule. */
export function iconGet(env: Record<string, string | undefined>, userAgent: string, get: EgressGet = egressGet(CATALOG_EGRESS)): IconGet {
  const fixtures = env[CATALOG_FIXTURES_ENV];
  if (fixtures)
    return async (url) => {
      const name = iconsFixtureName(url);
      try {
        return { contentType: name.endsWith('.svg') ? 'image/svg+xml' : 'image/png', bytes: new Uint8Array(await readFile(join(fixtures, 'icons', name))) };
      } catch {
        return null;
      }
    };
  if (offline(env)) return async () => null;
  return async (url) => {
    const answer = await get(url, { userAgent });
    return answer.bytes === null ? null : { contentType: answer.contentType, bytes: answer.bytes };
  };
}
