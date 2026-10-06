import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestId } from '@shared/graph/ids';
import { HostBridge } from './bridge';

interface Ask {
  requestId: RequestId;
  what: string;
}
const ask = (id: string): Ask => ({ requestId: id as RequestId, what: id });

afterEach(() => vi.useRealTimers());

describe('the host bridge (E2 Design §7: E1 residue 3 generalised)', () => {
  it('sends the request once and settles with the first answer; a later one is not_pending', async () => {
    const sent: Ask[] = [];
    const bridge = new HostBridge<Ask, string>({ send: (r) => sent.push(r), answerMs: 1000 });
    const outcome = bridge.request(ask('r1'), new AbortController().signal);
    expect(sent).toEqual([ask('r1')]);
    expect(bridge.pending).toBe(1);
    expect(bridge.answer('r1' as RequestId, 'first')).toBe('delivered');
    expect(bridge.answer('r1' as RequestId, 'second')).toBe('not_pending');
    expect(await outcome).toEqual({ kind: 'answered', answer: 'first' });
    expect(bridge.pending).toBe(0);
  });

  it('settles with a timeout after answerMs, and an answer after it is not_pending', async () => {
    vi.useFakeTimers();
    const bridge = new HostBridge<Ask, string>({ send: () => {}, answerMs: 45_000 });
    let settled: unknown = null;
    void bridge.request(ask('r1'), new AbortController().signal).then((value) => (settled = value));
    await vi.advanceTimersByTimeAsync(44_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ kind: 'timeout' });
    expect(bridge.answer('r1' as RequestId, 'late')).toBe('not_pending');
  });

  it('settles a withdrawn request and every request at exit; a request already withdrawn is never sent', async () => {
    const sent: Ask[] = [];
    const bridge = new HostBridge<Ask, string>({ send: (r) => sent.push(r), answerMs: 1000 });
    const controller = new AbortController();
    const withdrawn = bridge.request(ask('r1'), controller.signal);
    const atExit = bridge.request(ask('r2'), new AbortController().signal);
    controller.abort();
    expect(await withdrawn).toEqual({ kind: 'withdrawn' });
    bridge.processExited();
    expect(await atExit).toEqual({ kind: 'ended' });
    expect(bridge.pending).toBe(0);
    const aborted = new AbortController();
    aborted.abort();
    expect(await bridge.request(ask('r3'), aborted.signal)).toEqual({ kind: 'withdrawn' });
    expect(sent.map((r) => r.requestId)).toEqual(['r1', 'r2']);
  });
});
