// E4c (E4c execution document, Design §3; Acceptance "Also pinned": browser-bridge.test.ts): the browser tools' host
// bridge. Its deadline counts only main's own work: a wait on the person or a cover pauses it and the end of that wait
// re-arms it whole; an abort or its own timeout tells main to stop (`browserCancel`); with no app, or once the app goes,
// nothing waits (X13).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestId } from '@shared/graph/ids';
import { BROWSER_ANSWER_MS } from '@shared/maws/browser';
import { BrowserBridge, type BrowserRequest } from './browser-bridge';

const request = (id: string): BrowserRequest => ({ requestId: id as RequestId, toolUseId: null, tool: 'browser_act', args: { tabId: 'b_0123456789ab', action: 'click', target: 'e1' } });
const OK = { ok: true as const, result: { status: 'ok' } };

function bridge(opts: { connected?: () => boolean; answerMs?: number } = {}) {
  const sent: BrowserRequest[] = [];
  const cancelled: RequestId[] = [];
  const gone = new Set<() => void>();
  const subject = new BrowserBridge({
    send: (r) => sent.push(r),
    cancel: (id) => cancelled.push(id),
    connected: opts.connected,
    onClientGone: (hook) => {
      gone.add(hook);
      return () => gone.delete(hook);
    },
    answerMs: opts.answerMs,
  });
  const clientGone = () => [...gone].forEach((hook) => hook());
  return { subject, sent, cancelled, gone, clientGone };
}

afterEach(() => vi.useRealTimers());

describe('the browser bridge (E4c Design §3)', () => {
  it('sends the request once and settles with the first answer; a later answer or wait is not_pending', async () => {
    const { subject, sent, cancelled } = bridge();
    const outcome = subject.request(request('r1'), new AbortController().signal);
    expect(sent).toEqual([request('r1')]);
    expect(subject.pending).toBe(1);
    expect(subject.answer('r1' as RequestId, OK)).toBe('delivered');
    expect(subject.answer('r1' as RequestId, { ok: false, error: 'late' })).toBe('not_pending');
    expect(subject.waiting('r1' as RequestId, 'human')).toBe('not_pending');
    expect(await outcome).toEqual({ kind: 'answered', answer: OK });
    expect(subject.pending).toBe(0);
    expect(cancelled).toEqual([]);
  });

  it('times out after 30 s of main’s own work, tells main to stop, and takes no answer after', async () => {
    vi.useFakeTimers();
    const { subject, cancelled } = bridge();
    let settled: unknown = null;
    void subject.request(request('r1'), new AbortController().signal).then((value) => (settled = value));
    await vi.advanceTimersByTimeAsync(BROWSER_ANSWER_MS - 1);
    expect(settled).toBeNull();
    expect(cancelled).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ kind: 'timeout' });
    expect(cancelled).toEqual(['r1']);
    expect(subject.answer('r1' as RequestId, OK)).toBe('not_pending');
  });

  it('pauses the deadline while main waits on the person or a cover, unbounded, and re-arms it whole when the wait ends', async () => {
    vi.useFakeTimers();
    const { subject, cancelled } = bridge();
    let settled: unknown = null;
    void subject.request(request('r1'), new AbortController().signal).then((value) => (settled = value));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(subject.waiting('r1' as RequestId, 'human')).toBe('delivered');
    await vi.advanceTimersByTimeAsync(10 * 60_000); // the person holds the page for ten minutes
    expect(settled).toBeNull();
    expect(subject.waiting('r1' as RequestId, 'cover')).toBe('delivered'); // a sheet next: still paused
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBeNull();
    expect(subject.waiting('r1' as RequestId, null)).toBe('delivered'); // released: the full 30 s again
    await vi.advanceTimersByTimeAsync(BROWSER_ANSWER_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ kind: 'timeout' });
    expect(cancelled).toEqual(['r1']);
  });

  it('answers a paused request when main answers it', async () => {
    vi.useFakeTimers();
    const { subject } = bridge();
    const outcome = subject.request(request('r1'), new AbortController().signal);
    subject.waiting('r1' as RequestId, 'human');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(subject.answer('r1' as RequestId, OK)).toBe('delivered');
    expect(await outcome).toEqual({ kind: 'answered', answer: OK });
  });

  it('settles a withdrawn request (paused or not) and tells main to stop; one aborted before it was asked is never sent', async () => {
    const { subject, sent, cancelled } = bridge();
    const first = new AbortController();
    const second = new AbortController();
    const running = subject.request(request('r1'), first.signal);
    const paused = subject.request(request('r2'), second.signal);
    subject.waiting('r2' as RequestId, 'human');
    first.abort('withdrawn');
    second.abort('withdrawn');
    expect(await running).toEqual({ kind: 'withdrawn' });
    expect(await paused).toEqual({ kind: 'withdrawn' });
    expect(cancelled).toEqual(['r1', 'r2']);
    const aborted = new AbortController();
    aborted.abort();
    expect(await subject.request(request('r3'), aborted.signal)).toEqual({ kind: 'withdrawn' });
    expect(sent.map((r) => r.requestId)).toEqual(['r1', 'r2']);
    expect(cancelled).toEqual(['r1', 'r2']);
    expect(subject.pending).toBe(0);
  });

  it('settles every request ended at exit, tells main to stop each, and stops following the client', async () => {
    const { subject, cancelled, gone } = bridge();
    const running = subject.request(request('r1'), new AbortController().signal);
    const paused = subject.request(request('r2'), new AbortController().signal);
    subject.waiting('r2' as RequestId, 'cover');
    expect(gone.size).toBe(1);
    subject.processExited();
    expect(await running).toEqual({ kind: 'ended' });
    expect(await paused).toEqual({ kind: 'ended' });
    expect(cancelled).toEqual(['r1', 'r2']);
    expect(gone.size).toBe(0);
  });

  // X13: a detached host with no app answers at once rather than holding the engine's turn on a main that is not there
  it('settles noClient at once and sends nothing with no app connected', async () => {
    let connected = false;
    const { subject, sent } = bridge({ connected: () => connected });
    expect(await subject.request(request('r1'), new AbortController().signal)).toEqual({ kind: 'noClient' });
    expect(sent).toEqual([]);
    expect(subject.pending).toBe(0);
    connected = true;
    void subject.request(request('r2'), new AbortController().signal);
    expect(sent.map((r) => r.requestId)).toEqual(['r2']);
  });

  it('settles every pending request noClient when the app goes, paused ones included; later requests ask again', async () => {
    vi.useFakeTimers();
    const { subject, sent, cancelled, clientGone } = bridge();
    const running = subject.request(request('r1'), new AbortController().signal);
    const paused = subject.request(request('r2'), new AbortController().signal);
    subject.waiting('r2' as RequestId, 'human');
    clientGone();
    expect(await running).toEqual({ kind: 'noClient' });
    expect(await paused).toEqual({ kind: 'noClient' });
    expect(subject.pending).toBe(0);
    expect(cancelled).toEqual([]); // nobody to tell
    await vi.advanceTimersByTimeAsync(BROWSER_ANSWER_MS); // no timer left behind
    expect(cancelled).toEqual([]);
    void subject.request(request('r3'), new AbortController().signal);
    expect(sent.map((r) => r.requestId)).toEqual(['r1', 'r2', 'r3']);
  });
});
