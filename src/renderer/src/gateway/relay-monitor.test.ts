import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { status } from '../../../../test/support/builders';
import { createNoticesStore } from '../stores/notices';
import { createSessionsStore } from '../stores/sessions';
import { hasLiveGatewaySession, RELAY_BANNER_ID, RELAY_POLL_MS, startRelayMonitor } from './relay-monitor';
import { createGatewayStore } from './store';

const URL = 'http://127.0.0.1:8641';
const health = (ok: boolean, at: number): RelayHealth => ({ url: URL, ok, status: ok ? 200 : null, latencyMs: ok ? 2 : null, checkedAt: new Date(at).toISOString(), error: ok ? null : 'connect ECONNREFUSED 127.0.0.1:8641' });
const gatewayStatus = (id: string, process: EngineSessionStatus['process'] = 'ready'): EngineSessionStatus => ({ ...status(id, { process }), gateway: { ...status(id).gateway, mode: 'gateway' } });
const directStatus = (id: string): EngineSessionStatus => ({ ...status(id), gateway: { ...status(id).gateway, mode: 'direct' } });

function harness(answers: boolean[] = []) {
  const queue = [...answers];
  const invoke = vi.fn<(name: string, input: unknown) => Promise<unknown>>(async () => ({ ok: true, value: health(queue.length > 0 ? queue.shift()! : true, Date.now()) }));
  const client = { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as MawsBridge;
  const gateway = createGatewayStore(client);
  const sessions = createSessionsStore();
  const notices = createNoticesStore();
  const banner = vi.spyOn(notices.getState(), 'banner');
  const run = vi.fn();
  const live = (id: string, s: EngineSessionStatus = gatewayStatus(id)) => sessions.getState().applyStatus({ appSessionId: id as AppSessionId, status: s });
  const stop = startRelayMonitor({ gateway, sessions, notices, runAction: run });
  const banners = () => notices.getState().notices.filter((n) => n.kind === 'banner');
  const toasts = () => notices.getState().notices.filter((n) => n.kind === 'toast');
  return { invoke, gateway, sessions, notices, banner, run, live, stop, banners, toasts, answer: (...more: boolean[]) => queue.push(...more) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-09-29T08:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('relay monitor posts one banner per outage', () => {
  it('while a gateway session is live, polls with force every 30 s; down, down, up posts one banner and dismisses it once', async () => {
    const h = harness([true, false, false, false, true]);
    h.live('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith('engine.relayHealth', { force: true });
    expect(h.banners()).toEqual([]);

    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS); // down
    expect(h.banners()).toEqual([expect.objectContaining({ id: RELAY_BANNER_ID, level: 'warning', dismissible: true })]);
    expect(h.banners()[0]!.text).toBe(
      "ClaudeUsage's relay stopped answering just now · 1 live session keeps its process; its next request fails until it is back · new sessions will offer Direct",
    );
    // M5: while it stays down the same banner says for how long, and how many live sessions it is about, in place
    h.live('b');
    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS); // still down
    expect(h.banners()).toHaveLength(1);
    expect(h.banners()[0]!.text).toBe(
      "ClaudeUsage's relay stopped answering 30 s ago · 2 live sessions keep their process; their next request fails until it is back · new sessions will offer Direct",
    );
    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS);
    expect(h.banners()[0]!.text).toMatch(/^ClaudeUsage's relay stopped answering 1 min ago · /);

    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS); // back
    expect(h.invoke).toHaveBeenCalledTimes(5);
    expect(h.banners()).toEqual([]);
    expect(h.toasts()).toEqual([expect.objectContaining({ text: 'Relay is back', level: 'info' })]);
    expect(h.gateway.getState().relay).toMatchObject({ ok: true });
    h.stop();
  });

  it('never calls the command without a live gateway session: none, a Direct one, an exited gateway one', async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(5 * RELAY_POLL_MS);
    h.live('d', directStatus('d'));
    h.live('x', gatewayStatus('x', 'exited'));
    await vi.advanceTimersByTimeAsync(5 * RELAY_POLL_MS);
    expect(h.invoke).not.toHaveBeenCalled();
    h.stop();
  });

  it('stops polling when the last live gateway session ends, clearing its banner; starts again with the next', async () => {
    const h = harness([false]);
    h.live('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.banners()).toHaveLength(1); // no reading had come back ok yet: the launch's own check was the last answer
    h.live('a', gatewayStatus('a', 'exited'));
    expect(h.banners()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5 * RELAY_POLL_MS);
    expect(h.invoke).toHaveBeenCalledOnce();
    expect(h.toasts()).toEqual([]);
    h.live('b', gatewayStatus('b', 'starting'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.invoke).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('never re-posts a dismissed banner for the same outage; the next outage posts again', async () => {
    const h = harness([true, false, false, true, false]);
    h.live('a');
    h.live('b');
    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS);
    expect(h.banners()[0]!.text).toContain('2 live sessions keep their process; their next request fails');
    h.notices.getState().dismiss(RELAY_BANNER_ID);
    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS); // still down: neither posted again nor refreshed back into view
    expect(h.banners()).toEqual([]);
    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS); // back
    expect(h.toasts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS); // down again
    expect(h.banners()).toHaveLength(1);
    expect(h.banner).toHaveBeenCalledTimes(2); // the first outage's post and the second's
    h.stop();
  });

  it("the banner's Open ClaudeUsage runs the hand-off action and Retry checks at once, feeding the same outage", async () => {
    const h = harness([true, false]);
    h.live('a');
    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS);
    const [open, retry] = h.banners()[0]!.actions;
    expect([open!.label, retry!.label]).toEqual(['Open ClaudeUsage', 'Retry']);
    open!.run();
    expect(h.run).toHaveBeenCalledExactlyOnceWith('gateway.openClaudeUsage');
    h.answer(true);
    retry!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.invoke).toHaveBeenLastCalledWith('engine.relayHealth', { force: true });
    expect(h.banners()).toEqual([]);
    expect(h.toasts()).toHaveLength(1);
    h.stop();
  });

  it('logs a failed check and keeps polling', async () => {
    const h = harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.invoke.mockResolvedValueOnce({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is restarting' } } as never);
    h.live('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith('[gateway] relay check failed', expect.any(Error));
    await vi.advanceTimersByTimeAsync(RELAY_POLL_MS);
    expect(h.invoke).toHaveBeenCalledTimes(2);
    expect(h.banners()).toEqual([]);
    h.stop();
    warn.mockRestore();
  });

  it('stop ends polling', async () => {
    const h = harness();
    h.live('a');
    await vi.advanceTimersByTimeAsync(0);
    h.stop();
    await vi.advanceTimersByTimeAsync(5 * RELAY_POLL_MS);
    expect(h.invoke).toHaveBeenCalledOnce();
  });
});

describe('hasLiveGatewaySession', () => {
  it('holds for a gateway status while starting, initializing or ready, and for nothing else', () => {
    const sessions = createSessionsStore();
    const put = (s: EngineSessionStatus) => sessions.getState().applyStatus({ appSessionId: s.appSessionId, status: s });
    expect(hasLiveGatewaySession(sessions.getState())).toBe(false);
    for (const process of ['exiting', 'exited'] as const) put(gatewayStatus(`g-${process}`, process));
    put(directStatus('d'));
    expect(hasLiveGatewaySession(sessions.getState())).toBe(false);
    for (const process of ['starting', 'initializing', 'ready'] as const) {
      const one = createSessionsStore();
      one.getState().applyStatus({ appSessionId: 'g' as AppSessionId, status: gatewayStatus('g', process) });
      expect(hasLiveGatewaySession(one.getState()), process).toBe(true);
    }
  });
});
