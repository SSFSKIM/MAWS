// P5 O7 M3's remote terminal over a link in memory (test/lane-b/fake-link.ts): the stream's reopen rules the end-to-end
// suite (test/lane-b/remote.test.ts) can't time — the backoff of an attach whose stream keeps closing `behind` with
// nothing said, and the geometry sent again on each stream.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import { REMOTE_ACT_PENDING_MS, REMOTE_ATTACH_PENDING_MS } from '@shared/machine/remote-pending';
import { FakeLink, type FakeAct, type FakeStream } from '../../../test/lane-b/fake-link';
import { REMOTE_LANE_B_TIMING } from './remote';
import { createRemotePty } from './remote-pty';

const INFO = { ptyId: 'pty-1', appSessionId: 'app-1', label: 'zsh', pid: 7, cwd: '/w', shell: '/bin/zsh', cols: 80, rows: 24, spawnedAt: '2026-11-01T00:00:00.000Z', alive: true, paused: false, exit: null, offset: 0 };
const RETRY: readonly [number, number] = [50, 400];

function lab(pendingMs = 60_000) {
  const link = new FakeLink();
  link.peers = ['rl2.executor.machine', 'rl2.streams'];
  link.onAct = (act) => act.settle({ state: 'done', result: act.request.action === 'pty.spawn' ? { ptyId: 'pty-1', pid: 7 } : { info: INFO, ringStart: 0, nextOffset: 0 } });
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const pty = createRemotePty({
    remote: () => link,
    emit: (_machine, name, payload) => void emitted.push({ name, payload }),
    bounded: (handle) => handle.outcome,
    pendingMs,
    timing: { streamRetryMs: RETRY, inputHeldMax: 4 << 20 },
    now: Date.now,
    log: () => {},
  });
  const cmd = (name: CommandName, fields: Record<string, unknown>) => pty.dispatch(link, name, fields);
  const last = (): FakeStream => link.streams.at(-1)!;
  return { link, pty, emitted, cmd, last };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('remote terminal streams (P5 O7 M3)', () => {
  it('an attach whose stream keeps closing behind with nothing said opens again on the doubling backoff', async () => {
    const l = lab();
    const answer = l.cmd('pty.attach', { ptyId: 'pty-1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(l.link.streams).toHaveLength(1);
    // Each open answers its ring (empty past the attach's start) and closes behind at once: no progress.
    const gaps: number[] = [];
    for (let round = 0; round < 4; round++) {
      const opened = l.link.streams.length;
      l.last().sink.opened({ pty: { info: INFO, ringStart: 0, nextOffset: 5 }, credit: 1 << 20 });
      l.last().sink.closed('behind');
      expect(l.link.streams, `round ${round}: no reopen before the backoff`).toHaveLength(opened);
      let waited = 0;
      while (l.link.streams.length === opened) {
        await vi.advanceTimersByTimeAsync(10);
        waited += 10;
      }
      gaps.push(waited);
    }
    expect(gaps).toEqual([50, 100, 200, 400]);
    // The ring's bytes, at last: the attach answers with them.
    l.last().sink.opened({ pty: { info: INFO, ringStart: 0, nextOffset: 5 }, credit: 1 << 20 });
    l.last().sink.data(0, new TextEncoder().encode('hello'));
    expect(await answer).toMatchObject({ ok: true, value: { replayFrom: 0, nextOffset: 5 } });
  });

  it('answers a whole attach within twice the act’s bound: REMOTE_ATTACH_PENDING_MS at lane B’s default', async () => {
    expect([REMOTE_LANE_B_TIMING.sendPendingMs, 2 * REMOTE_LANE_B_TIMING.sendPendingMs]).toEqual([REMOTE_ACT_PENDING_MS, REMOTE_ATTACH_PENDING_MS]);
    const l = lab(1000);
    const acts: FakeAct[] = [];
    l.link.onAct = (act) => void acts.push(act); // a non-owner at the sheet: the act settles at the end of its bound
    let answered: unknown = null;
    void l.cmd('pty.attach', { ptyId: 'pty-1' }).then((result) => (answered = result));
    await vi.advanceTimersByTimeAsync(999);
    acts[0]!.settle({ state: 'done', result: { info: INFO, ringStart: 0, nextOffset: 5 } });
    await vi.advanceTimersByTimeAsync(999); // the ring's bytes never come
    expect(answered).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(answered).toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('sends the latest geometry again on every stream, so a resize lost with its channel is not lost', async () => {
    const l = lab();
    await l.cmd('pty.spawn', { appSessionId: 'app-1', cols: 80, rows: 24 });
    l.last().sink.opened({ pty: { info: INFO, ringStart: 0, nextOffset: 0 }, credit: 1 << 20 });
    expect(await l.cmd('pty.resize', { ptyId: 'pty-1', cols: 100, rows: 30 })).toEqual({ ok: true, value: undefined });
    expect(l.last().controls).toEqual([{ resize: { cols: 100, rows: 30 } }]);
    // The channel drops before the endpoint took the control: the next stream carries the size again.
    l.last().sink.closed('carrier');
    expect(l.link.streams).toHaveLength(2);
    l.last().sink.opened({ pty: { info: INFO, ringStart: 0, nextOffset: 0 }, credit: 1 << 20 });
    expect(l.last().controls).toEqual([{ resize: { cols: 100, rows: 30 } }]);
    // One asked while no stream is open goes on the next, as the latest only.
    l.last().sink.closed('carrier');
    await l.cmd('pty.resize', { ptyId: 'pty-1', cols: 90, rows: 20 });
    await l.cmd('pty.resize', { ptyId: 'pty-1', cols: 120, rows: 40 });
    expect(l.last().controls).toEqual([]);
    l.last().sink.opened({ pty: { info: INFO, ringStart: 0, nextOffset: 0 }, credit: 1 << 20 });
    expect(l.last().controls).toEqual([{ resize: { cols: 120, rows: 40 } }]);
  });

  it('names on each stream the end of the input already sent (`inputSent`), beside its first unrefunded offset', async () => {
    const l = lab();
    await l.cmd('pty.spawn', { appSessionId: 'app-1', cols: 80, rows: 24 });
    expect(l.last().request.pty).toMatchObject({ inputFrom: 0, inputSent: 0 });
    l.last().sink.opened({ pty: { info: INFO, ringStart: 0, nextOffset: 0 }, credit: 1 << 20 });
    await l.cmd('pty.write', { ptyId: 'pty-1', data: 'ls\r' });
    l.last().sink.credit(3); // taken
    await l.cmd('pty.write', { ptyId: 'pty-1', data: 'echo hi\r' }); // sent, its refund lost with the channel
    l.last().sink.closed('carrier');
    expect(l.last().request.pty).toMatchObject({ inputFrom: 3, inputSent: 11 });
    // Input while no stream is open is held, never sent: it doesn't count as sent until a stream takes it.
    await l.cmd('pty.write', { ptyId: 'pty-1', data: 'pwd\r' });
    l.last().sink.closed('carrier');
    expect(l.last().request.pty).toMatchObject({ inputFrom: 3, inputSent: 11 });
    l.last().sink.opened({ pty: { info: INFO, ringStart: 0, nextOffset: 0 }, credit: 1 << 20 });
    expect(Buffer.concat(l.last().sent).toString()).toBe('echo hi\rpwd\r');
    l.last().sink.closed('carrier');
    expect(l.last().request.pty).toMatchObject({ inputFrom: 3, inputSent: 15 });
  });
});
