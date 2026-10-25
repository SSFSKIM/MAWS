// P4-AGG M2: the catalog's fetches (the Discover spec, Design "Fetching"): every URL the catalog asks for is one the
// `catalog` egress rule admits; a paged source is walked by its own tokens, offline from M1's recordings as on the
// network; a missing recording is that source failing; under MAWS_E2E=1 the network is never reached.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { admitted, CATALOG_EGRESS, egressGet, type BaseFetch } from '@shared/net/egress';
import { catalogPages, fetchSource, fixturePages, NETWORK_KEYS, networkPages, pageUrl, WALK_BUDGET_BYTES, type PageGet } from './fetch';

const FIXTURES = resolve(__dirname, '../../../e2e/fixtures/catalog');

describe('the catalog’s requests', () => {
  it('asks only for what the catalog rule admits: fifteen sources, and each paged one’s next pages', () => {
    expect(NETWORK_KEYS).toHaveLength(15);
    for (const key of NETWORK_KEYS) expect(admitted(CATALOG_EGRESS, pageUrl(key, null)), key).not.toBeNull();
    expect(admitted(CATALOG_EGRESS, pageUrl('directory:plugins', 'eyJwIjoyfQ=='))).not.toBeNull();
    expect(admitted(CATALOG_EGRESS, pageUrl('directory:servers', 'c/2+3'))).not.toBeNull(); // escaped as URLSearchParams would
    expect(pageUrl('seed:carta-plugins', null)).toBe('https://raw.githubusercontent.com/carta/plugins/HEAD/.claude-plugin/marketplace.json');
    expect(() => pageUrl('seed:somebody-else', null)).toThrow('no catalog source');
  });

  it('walks a paged source by its tokens through the guarded GET, with the user agent and no other header', async () => {
    const asked: { url: string; init: RequestInit }[] = [];
    const base: BaseFetch = async (url, init) => {
      asked.push({ url, init });
      const body = url.includes('cursor=') ? { servers: [{ id: 'b' }], next_cursor: null } : { servers: [{ id: 'a' }], next_cursor: 'p/2' };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    };
    const fetched = await fetchSource('directory:servers', networkPages(egressGet(CATALOG_EGRESS, base), 'MAWS/1.2.3'));
    expect(asked.map((a) => a.url)).toEqual(['https://api.anthropic.com/api/directory/servers?limit=500', 'https://api.anthropic.com/api/directory/servers?limit=500&cursor=p%2F2']);
    expect(asked[0]!.init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual' });
    expect((asked[0]!.init.headers as Record<string, string>)['user-agent']).toBe('MAWS/1.2.3');
    expect(fetched.pages).toEqual([{ servers: [{ id: 'a' }], next_cursor: 'p/2' }, { servers: [{ id: 'b' }], next_cursor: null }]);
    expect(fetched.exchanges.map((e) => [e.contentType, e.bytes > 0])).toEqual([['application/json', true], ['application/json', true]]);
  });

  it('fails a source whose answer is not 2xx or not JSON, or whose walk names a page twice', async () => {
    const answering = (respond: (url: string) => Response) => networkPages(egressGet(CATALOG_EGRESS, async (url) => respond(url)), 'MAWS');
    await expect(fetchSource('plugin-details', answering(() => new Response('gone', { status: 404 })))).rejects.toThrow('answered HTTP 404');
    await expect(fetchSource('plugin-details', answering(() => new Response('<html>', { headers: { 'content-type': 'application/json' } })))).rejects.toThrow('did not answer JSON');
    const looping = answering(() => new Response(JSON.stringify({ data: [], next_page: 'same' }), { headers: { 'content-type': 'application/json' } }));
    await expect(fetchSource('directory:plugins', looping)).rejects.toThrow('already read');
  });

  it('reads M1’s recordings in place of the network, the servers’ two pages walked by their cursor', async () => {
    const servers = await fetchSource('directory:servers', fixturePages(FIXTURES));
    expect(servers.pages).toHaveLength(2);
    expect(servers.exchanges.map((e) => e.url)).toEqual(['https://api.anthropic.com/api/directory/servers?limit=500', 'https://api.anthropic.com/api/directory/servers?limit=500&cursor=fixture-page-2']);
    expect((await fetchSource('seed:claude-for-legal', fixturePages(FIXTURES))).pages).toHaveLength(1);
    const empty = mkdtempSync(join(tmpdir(), 'maws-agg-fixtures-'));
    try {
      await expect(fetchSource('directory:plugins', fixturePages(empty))).rejects.toThrow(); // a missing file is the source failing
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('never reaches the network under MAWS_E2E=1 without fixtures; with them, never either', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(fetchSource('plugin-details', catalogPages({ MAWS_E2E: '1' }, 'MAWS'))).rejects.toThrow('offline');
      expect((await fetchSource('plugin-details', catalogPages({ MAWS_E2E: '1', MAWS_CATALOG_FIXTURES: FIXTURES }, 'MAWS'))).pages).toHaveLength(1);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  // P4-AGG M5: the live smoke (e2e/discover-live.spec.ts) runs the app under MAWS_E2E=1 against the real sources, so it
  // names MAWS_CATALOG_LIVE=1, and the walk then goes out through the same guarded GET as outside the harness.
  it('reaches the network under MAWS_E2E=1 only when MAWS_CATALOG_LIVE=1 names the live smoke, through the catalog rule', async () => {
    const asked: string[] = [];
    const base: BaseFetch = async (url) => {
      asked.push(url);
      return new Response('{"plugins":{}}', { headers: { 'content-type': 'application/json' } });
    };
    const get = egressGet(CATALOG_EGRESS, base);
    await expect(fetchSource('plugin-details', catalogPages({ MAWS_E2E: '1', MAWS_CATALOG_LIVE: '0' }, 'MAWS', get))).rejects.toThrow('offline');
    expect(asked).toEqual([]);
    expect((await fetchSource('plugin-details', catalogPages({ MAWS_E2E: '1', MAWS_CATALOG_LIVE: '1' }, 'MAWS', get))).pages).toEqual([{ plugins: {} }]);
    expect(asked).toEqual([pageUrl('plugin-details', null)]);
  });
});

// The branch review panel's findings on the walk (panel-discover.json: scalpel-4#1, #2).
describe('one walk’s limits', () => {
  const MiB = 1024 * 1024;
  // a source whose pages never end, each answering `bytes` and naming the next
  const endless = (bytes: number, wait: (signal: AbortSignal) => Promise<void> = async () => {}) => {
    const asked: { maxBytes: number; signal: AbortSignal }[] = [];
    let n = 0;
    const get: PageGet = async (key, _token, limits) => {
      const given = limits ?? { signal: new AbortController().signal, maxBytes: Number.NaN }; // a walk that gives none
      asked.push(given);
      await wait(given.signal);
      n += 1;
      return { body: { data: [], next_page: `p${n}` }, exchange: { url: pageUrl(key, null), bytes, contentType: 'application/json', ms: 0 } };
    };
    return { get, asked };
  };

  it('stops a walk past one cumulative byte budget, and asks each page for no more than what is left (scalpel-4#1)', async () => {
    const { get, asked } = endless(40 * MiB);
    await expect(fetchSource('directory:plugins', get)).rejects.toThrow(`over its ${WALK_BUDGET_BYTES} byte budget`);
    expect(asked.length).toBeLessThanOrEqual(Math.ceil(WALK_BUDGET_BYTES / (40 * MiB)) + 1);
    expect(asked.map((a) => a.maxBytes)).toEqual(asked.map((_, i) => WALK_BUDGET_BYTES - i * 40 * MiB));
    // the guarded GET refuses a body past what the walk has left, though the route's own cap is larger
    const base = async () => new Response(new Uint8Array(2048), { headers: { 'content-type': 'application/json' } });
    await expect(egressGet(CATALOG_EGRESS, base)(pageUrl('directory:plugins', null), { maxBytes: 1024 })).rejects.toThrow(/over 1024/);
  });

  it('gives a whole walk one deadline and one cancellation, every page under the same signal (scalpel-4#2)', async () => {
    const slow = (signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 30);
        signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
      });
    const { get, asked } = endless(1, slow);
    const started = Date.now();
    await expect(fetchSource('directory:plugins', get, { deadlineMs: 100 })).rejects.toThrow('passed its 100 ms deadline');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(new Set(asked.map((a) => a.signal)).size).toBe(1); // one signal across the pages, not one per request
    const stop = new AbortController();
    const walking = fetchSource('directory:plugins', endless(1, slow).get, { signal: stop.signal });
    setTimeout(() => stop.abort(), 50);
    await expect(walking).rejects.toThrow('the walk was stopped');
  });
});
