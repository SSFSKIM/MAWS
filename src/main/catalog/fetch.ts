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
// Under MAWS_E2E=1 without it, every source fails as offline: the network is never reached.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CATALOG_EGRESS, egressGet, type EgressGet } from '@shared/net/egress';
import { SEEDS, seedOf } from './sources';

export const CATALOG_FIXTURES_ENV = 'MAWS_CATALOG_FIXTURES';

const DIRECTORY = 'https://api.anthropic.com/api/directory';
const PLUGIN_DETAILS = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json';
const MAX_PAGES = 50; // far past any walk today (the plugins walk is one page, the servers walk three)

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
/** One page of a source: the first (token null) or the next. */
export type PageGet = (key: string, token: string | null) => Promise<{ body: unknown; exchange: Exchange }>;

/** A source walked whole: its first page, then each page its predecessor names. */
export async function fetchSource(key: string, get: PageGet): Promise<Fetched> {
  const pages: unknown[] = [];
  const exchanges: Exchange[] = [];
  const seen = new Set<string>();
  let token: string | null = null;
  do {
    if (pages.length >= MAX_PAGES) throw new Error(`${key}: more than ${MAX_PAGES} pages`);
    const { body, exchange } = await get(key, token);
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
  return async (key, token) => {
    const url = pageUrl(key, token);
    const started = now();
    const answer = await get(url, { userAgent });
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

/** The pages the catalog reads in this environment: the fixtures, none under the e2e, else the network. */
export function catalogPages(env: Record<string, string | undefined>, userAgent: string): PageGet {
  const fixtures = env[CATALOG_FIXTURES_ENV];
  if (fixtures) return fixturePages(fixtures);
  if (env.MAWS_E2E === '1')
    return async (key) => {
      throw new Error(`${key}: offline (MAWS_E2E=1 never reaches the network)`);
    };
  return networkPages(egressGet(CATALOG_EGRESS), userAgent);
}
