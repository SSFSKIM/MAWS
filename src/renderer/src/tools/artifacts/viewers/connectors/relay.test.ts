// P3-H H4: the relay between a page's port and its ArtifactHost connector surface. What the page posts is the page's:
// it is checked against the portable request schemas before it reaches the surface, and every answer the page reads is
// the surface's own closed outcome (a command that failed reads `failed: routeFailed`).
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorSurface } from '@artifacts/host';
import type { ConnectorCallOutcome } from '@shared/artifacts/connectors';
import { relayPage, type PagePort } from './relay';

const TOOL = { server: 'fixture', tool: 'read_series' };
const RESULT: ConnectorCallOutcome = { ok: true, result: { rows: [1] }, fetchedAt: 7, via: { route: 'engine', sessionId: 's1' } };

function fakeSurface(overrides: Partial<ConnectorSurface> = {}) {
  const surface: ConnectorSurface = {
    declareTools: vi.fn(async (tools) => ({ ok: true as const, declared: [...tools] })),
    callTool: vi.fn(async () => RESULT),
    watchTool: vi.fn(async () => ({ ok: true, watchId: 'w1', intervalMs: 60_000 }) as const),
    unwatchTool: vi.fn(async () => true),
    refreshWatch: vi.fn(async () => true),
    setVisible: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
  return surface;
}

function fakePort() {
  const posted: unknown[] = [];
  const port: PagePort & { send(data: unknown): void } = {
    onmessage: null,
    postMessage: (data) => void posted.push(data),
    close: vi.fn(),
    send(data) {
      this.onmessage?.({ data } as MessageEvent);
    },
  };
  return { port, posted };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the page relay', () => {
  it('declares what the page asks, telling the owner’s header what the page now declares', async () => {
    const surface = fakeSurface();
    const { port, posted } = fakePort();
    const declared = vi.fn();
    relayPage(port, surface, { declared });
    port.send({ id: 1, op: 'declare', tools: [TOOL] });
    await settle();
    expect(surface.declareTools).toHaveBeenCalledWith([TOOL]);
    expect(posted).toEqual([{ id: 1, answer: { ok: true, declared: [TOOL] } }]);
    expect(declared).toHaveBeenCalledWith([TOOL]);
  });

  it('answers invalid: request for a malformed request without reaching the surface, and ignores what is no request', async () => {
    const surface = fakeSurface();
    const { port, posted } = fakePort();
    relayPage(port, surface);
    port.send({ id: 1, op: 'declare', tools: [{ server: 'x' }] });
    port.send({ id: 2, op: 'call', request: { server: 's', tool: 't', args: 'no' } });
    port.send({ id: 3, op: 'watch', request: { server: 's', tool: 't' } }); // no interval
    port.send({ id: 4, op: 'grant', request: TOOL }); // a page has no grant
    port.send({ op: 'call', request: TOOL }); // no id: nothing to answer
    port.send('hello');
    await settle();
    expect(posted).toEqual([1, 2, 3, 4].map((id) => ({ id, answer: { ok: false, state: 'invalid', reason: 'request' } })));
    for (const method of ['declareTools', 'callTool', 'watchTool'] as const) expect(surface[method]).not.toHaveBeenCalled();
  });

  it('relays a call and reports its outcome for the tool', async () => {
    const surface = fakeSurface();
    const { port, posted } = fakePort();
    const outcome = vi.fn();
    relayPage(port, surface, { outcome });
    port.send({ id: 1, op: 'call', request: { ...TOOL, args: { q: 1 } } });
    await settle();
    expect(surface.callTool).toHaveBeenCalledWith({ ...TOOL, args: { q: 1 } });
    expect(posted).toEqual([{ id: 1, answer: RESULT }]);
    expect(outcome).toHaveBeenCalledWith(TOOL, RESULT);
  });

  it('posts a watch’s start before any of its refreshes, then each refresh as it comes', async () => {
    let listener: ((update: ConnectorCallOutcome) => void) | null = null;
    const surface = fakeSurface({
      watchTool: vi.fn(async (_request, heard) => {
        listener = heard;
        heard(RESULT); // a refresh heard before the start's answer
        return { ok: true, watchId: 'w1', intervalMs: 60_000 } as const;
      }),
    });
    const { port, posted } = fakePort();
    const outcome = vi.fn();
    relayPage(port, surface, { outcome });
    port.send({ id: 1, op: 'watch', request: { ...TOOL, intervalMs: 1_000 } });
    await settle();
    expect(posted).toEqual([
      { id: 1, answer: { ok: true, watchId: 'w1', intervalMs: 60_000 } },
      { watchId: 'w1', update: RESULT },
    ]);
    const paused = { ok: false, state: 'paused', reason: 'noRoute' } as const;
    listener!(paused);
    expect(posted.at(-1)).toEqual({ watchId: 'w1', update: paused });
    expect(outcome.mock.calls).toEqual([
      [TOOL, RESULT],
      [TOOL, paused],
    ]);
  });

  it('stops and refreshes only the page’s own watches, and refreshes them all for the owner', async () => {
    const surface = fakeSurface();
    const { port, posted } = fakePort();
    const relay = relayPage(port, surface);
    port.send({ id: 1, op: 'watch', request: { ...TOOL, intervalMs: 60_000 } });
    await settle();
    port.send({ id: 2, op: 'refresh', watchId: 'someone-else' });
    port.send({ id: 3, op: 'refresh', watchId: 'w1' });
    await settle();
    relay.refreshWatches();
    port.send({ id: 4, op: 'unwatch', watchId: 'w1' });
    await settle();
    expect(posted.slice(1)).toEqual([
      { id: 2, answer: false },
      { id: 3, answer: true },
      { id: 4, answer: true },
    ]);
    expect(surface.refreshWatch).toHaveBeenCalledTimes(2);
    expect(surface.unwatchTool).toHaveBeenCalledWith('w1');
    relay.refreshWatches();
    expect(surface.refreshWatch).toHaveBeenCalledTimes(2); // stopped: nothing left to refresh
  });

  it('answers failed: routeFailed when the surface’s command fails, never its words', async () => {
    const surface = fakeSurface({ callTool: vi.fn(async () => Promise.reject(new Error('secret words'))), unwatchTool: vi.fn(async () => Promise.reject(new Error('no'))) });
    const { port, posted } = fakePort();
    relayPage(port, surface);
    port.send({ id: 1, op: 'watch', request: { ...TOOL, intervalMs: 60_000 } });
    await settle();
    port.send({ id: 2, op: 'call', request: TOOL });
    await settle();
    port.send({ id: 3, op: 'unwatch', watchId: 'w1' });
    await settle();
    expect(posted.slice(1)).toEqual([
      { id: 2, answer: { ok: false, state: 'failed', reason: 'routeFailed' } },
      { id: 3, answer: false },
    ]);
  });

  it('closes the surface and the port when disposed, and posts nothing after', async () => {
    let finish: (outcome: ConnectorCallOutcome) => void = () => {};
    const surface = fakeSurface({ callTool: vi.fn(() => new Promise<ConnectorCallOutcome>((resolve) => (finish = resolve))) });
    const { port, posted } = fakePort();
    const relay = relayPage(port, surface);
    port.send({ id: 1, op: 'call', request: TOOL });
    relay.dispose();
    finish(RESULT);
    await settle();
    expect(surface.close).toHaveBeenCalledTimes(1);
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(port.onmessage).toBeNull();
    expect(posted).toEqual([]);
  });
});
