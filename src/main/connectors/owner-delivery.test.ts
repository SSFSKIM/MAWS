// P4-B5: the owner's delivery over route D, main's half (./owner-delivery.ts): the live sessions' reports read first (the
// artifact's own first, bounded), the host's located sources deduplicated by saved identity and given MAWS's own
// connection state (an open HTTP server proved by a credential-less listing, never pushed into OAuth unless it
// refuses), Connect through the provider, and the send handed to route D as it is. Scripted host, route and provider.
import { describe, expect, it, vi } from 'vitest';
import type { DirectDiscoverAnswer, DirectSource } from '@shared/ipc/schema/connectors';
import { createOwnerDelivery, OBSERVE_LIMIT, type OwnerDeliveryDeps } from './owner-delivery';
import type { ConnectorOAuthState } from './oauth-provider';

const ART = '11111111-1111-4111-8111-111111111111';
const source = (patch: Partial<DirectSource> = {}): DirectSource => ({ directory: '/repo', sourceId: '22222222-2222-4222-8222-222222222222', generation: 1, server: 'notion', scope: 'user', transport: 'http', path: '/h/.claude.json', entryPath: ['mcpServers', 'notion'], observedAt: '2026-10-19T00:00:00.000Z', resourceUrl: 'https://mcp.notion.com/mcp', ...patch });
const live = (n: number) => Array.from({ length: n }, (_, i) => ({ appSessionId: `app-${i}`, launchId: `L${i}`, cwd: `/d${i}`, process: i === 1 ? 'exited' : 'ready' }));

function scene(options: { sessions?: ReturnType<typeof live>; links?: string[]; located?: DirectSource[] | null; state?: ConnectorOAuthState; discover?: DirectDiscoverAnswer[] } = {}) {
  const observed: string[] = [];
  const discover = [...(options.discover ?? [])];
  const deps: OwnerDeliveryDeps = {
    call: (async (name: string, input: Record<string, unknown>) => {
      if (name === 'engine.sessions') return { ok: true, value: options.sessions ?? live(3) };
      if (name === 'library.entry') return { ok: true, value: { artifact: null, links: (options.links ?? []).map((appSessionId) => ({ appSessionId })) } };
      if (name === 'connectors.observe') {
        observed.push(input.appSessionId as string);
        return { ok: true, value: { observed: true } };
      }
      throw new Error(name);
    }) as never,
    direct: {
      locate: vi.fn(async () => (options.located === undefined ? [source()] : options.located)),
      send: vi.fn(async () => ({ ok: true as const, result: { content: [] } })),
      discover: vi.fn(async () => discover.shift() ?? { ok: true as const, tools: [] }),
    },
    oauth: {
      state: vi.fn(async () => options.state ?? { state: 'connected' as const, connectionId: 'c', refreshable: true }),
      connect: vi.fn(async () => ({ ok: true as const, connectionId: 'c', reused: false })),
      reconnect: vi.fn(async () => ({ ok: true as const, connectionId: 'c', reused: false })),
    },
    log: () => {},
  };
  return { delivery: createOwnerDelivery(deps), deps, observed };
}
const signal = () => new AbortController().signal;
const find = (delivery: ReturnType<typeof scene>['delivery']) => delivery.find({ tool: 'notion-create-pages', urlHosts: ['mcp.notion.com'], artifactId: ART }, signal());

describe('the owner’s delivery over route D (main)', () => {
  it('reads every live session’s report before locating, the artifact’s own first, at most OBSERVE_LIMIT', async () => {
    const { delivery, observed, deps } = scene({ sessions: live(OBSERVE_LIMIT + 4), links: ['app-5'] });
    await find(delivery);
    expect(observed[0]).toBe('app-5');
    expect(observed).toHaveLength(OBSERVE_LIMIT);
    expect(observed).not.toContain('app-1'); // not ready
    expect(deps.direct.locate).toHaveBeenCalledWith('notion-create-pages', ['mcp.notion.com'], expect.anything());
    expect((await find(delivery))?.live).toBe(OBSERVE_LIMIT + 3); // the ready ones
  });

  it('gives each source MAWS’s own connection, one HTTP source per saved identity, the usable first', async () => {
    const stdio = source({ transport: 'stdio', resourceUrl: undefined, sourceId: '33333333-3333-4333-8333-333333333333', server: 'local' });
    const { delivery } = scene({ located: [source(), source({ directory: '/other' }), stdio] });
    const found = (await find(delivery))?.sources;
    expect(found?.map((entry) => [entry.source.server, entry.source.directory, entry.connection])).toEqual([
      ['notion', '/repo', 'connected'],
      ['local', '/repo', 'local'],
    ]);
  });

  it('with no MAWS sign-in saved, a credential-less listing decides: open, or sign-in on the server’s refusal', async () => {
    const open = scene({ state: { state: 'disconnected' }, discover: [{ ok: true, tools: [] }] });
    expect((await find(open.delivery))?.sources[0]?.connection).toBe('open');
    const refused = scene({ state: { state: 'disconnected' }, discover: [{ ok: false, failure: 'unavailable', reason: 'unauthorized' }] });
    expect((await find(refused.delivery))?.sources[0]?.connection).toBe('signIn');
    expect(refused.deps.oauth!.connect).not.toHaveBeenCalled();
  });

  it('names a saved sign-in that needs replacing, one under way, and a forgotten one', async () => {
    expect((await find(scene({ state: { state: 'needsReconnect', connectionId: 'c' } }).delivery))?.sources[0]?.connection).toBe('reconnect');
    expect((await find(scene({ state: { state: 'connecting', connectionId: 'c' } }).delivery))?.sources[0]?.connection).toBe('busy');
    expect((await find(scene({ state: { state: 'withdrawn' } }).delivery))?.sources[0]?.connection).toBe('signIn');
  });

  it('answers null when the host could not locate', async () => {
    expect(await find(scene({ located: null }).delivery)).toBeNull();
  });

  it('Connect tries the server open first and opens no browser when it answers', async () => {
    const { delivery, deps } = scene({ state: { state: 'disconnected' }, discover: [{ ok: true, tools: [] }] });
    expect(await delivery.connect(source(), signal())).toEqual({ ok: true });
    expect(deps.oauth!.connect).not.toHaveBeenCalled();
  });

  it('Connect runs the provider’s sign-in on a refusal and proves it with a listing; Reconnect for a record that needs it', async () => {
    const refused = scene({ state: { state: 'disconnected' }, discover: [{ ok: false, failure: 'unavailable', reason: 'unauthorized' }, { ok: true, tools: [] }] });
    expect(await refused.delivery.connect(source(), signal())).toEqual({ ok: true });
    expect(refused.deps.oauth!.connect).toHaveBeenCalledTimes(1);
    const stale = scene({ state: { state: 'needsReconnect', connectionId: 'c' } });
    expect(await stale.delivery.connect(source(), signal())).toEqual({ ok: true });
    expect(stale.deps.oauth!.reconnect).toHaveBeenCalledTimes(1);
    const rejected = scene({ state: { state: 'needsConnect' }, discover: [{ ok: false, failure: 'unavailable', reason: 'unauthorized' }] });
    expect(await rejected.delivery.connect(source(), signal())).toEqual({ ok: false, why: 'refused' });
  });

  // P4-B5 review: the record store's read (safeStorage) takes no signal, so it is raced against the caller's
  it('a record read that stalls ends with the caller’s signal: find gives that source unavailable, a cancelled Connect answers cancelled', async () => {
    const { delivery, deps } = scene();
    vi.mocked(deps.oauth!.state).mockImplementation(() => new Promise(() => {}));
    const deadline = new AbortController();
    const finding = delivery.find({ tool: 'notion-create-pages', urlHosts: ['mcp.notion.com'], artifactId: ART }, deadline.signal);
    await vi.waitFor(() => expect(deps.oauth!.state).toHaveBeenCalledTimes(1));
    deadline.abort();
    expect((await finding)?.sources.map((entry) => entry.connection)).toEqual(['unavailable']);
    const cancel = new AbortController();
    const connecting = delivery.connect(source(), cancel.signal);
    await vi.waitFor(() => expect(deps.oauth!.state).toHaveBeenCalledTimes(2));
    cancel.abort();
    expect(await connecting).toEqual({ ok: false, why: 'cancelled' });
    expect(deps.oauth!.connect).not.toHaveBeenCalled();
  });

  it('hands the send to route D unchanged', async () => {
    const { delivery, deps } = scene();
    const request = { artifactId: ART, tool: 'notion-create-pages', arguments: { pages: [] } };
    expect(await delivery.send(source(), request, signal())).toEqual({ ok: true, result: { content: [] } });
    expect(deps.direct.send).toHaveBeenCalledWith(source(), request, expect.anything());
  });
});
