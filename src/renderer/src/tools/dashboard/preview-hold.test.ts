// E3 panel residual (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16 (3); R1b: a displayed
// preview is held): the hold over the snapshots a displayed history preview or suggestion review names. A lease counts
// as held only once it is ready; an acquisition that fails (a hold cap, a ref already gone) is never taken for held: it
// is tried again a bounded number of times, then the preview's hold is explicitly unavailable (and logged). A replacement
// for changed refs leaves the earlier lease in place until it is ready, so nothing protected is let go before the new
// protection holds; a failed replacement keeps it. A held lease the host's restart took is taken again on the same
// refs. Clearing it (the preview gone with its body) lets everything go and acquires nothing more.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotLease } from '@artifacts/dashboard/snapshots';
import { PREVIEW_HOLD_RETRY_MS, PreviewHold } from './preview-hold';

interface Taken {
  refs: string[];
  released: boolean;
  settle(ok: boolean): void;
  lose(): void;
}

function holder() {
  const taken: Taken[] = [];
  const log = vi.fn<(line: string) => void>();
  const hold = (refs: readonly string[]): SnapshotLease => {
    let settle!: (ok: boolean) => void;
    const ready = new Promise<void>((resolve, reject) => (settle = (ok) => (ok ? resolve() : reject(new Error('a hold cap is reached')))));
    let lose!: () => void;
    const invalidated = new Promise<void>((resolve) => (lose = resolve));
    const entry: Taken = { refs: [...refs], released: false, settle, lose };
    taken.push(entry);
    return { ready, invalidated, release: () => void (entry.released = true) };
  };
  const preview = new PreviewHold(hold, log);
  const open = () => taken.filter((entry) => !entry.released).map((entry) => entry.refs);
  return { preview, taken, log, open };
}
const turn = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the hold over a displayed preview’s snapshots (E3 panel residual)', () => {
  it('is held only once its lease is ready, and one set of refs takes one lease', async () => {
    const h = holder();
    h.preview.want(['assets/b.json', 'assets/a.json', 'assets/a.json']);
    expect(h.taken.map((entry) => entry.refs)).toEqual([['assets/a.json', 'assets/b.json']]);
    expect(h.preview.state).toBe('pending');
    h.taken[0]!.settle(true);
    await turn();
    expect(h.preview.state).toBe('held');
    h.preview.want(['assets/a.json', 'assets/b.json']); // the same refs again (a retitle): nothing new
    expect(h.taken).toHaveLength(1);
  });

  it('an acquisition that fails is never held: it is tried again, boundedly, then said unavailable', async () => {
    const h = holder();
    h.preview.want(['assets/a.json']);
    h.taken[0]!.settle(false); // a hold cap
    await turn();
    expect(h.preview.state).toBe('pending');
    h.preview.want(['assets/a.json']); // a document update with the same refs takes the failed lease for nothing
    expect(h.taken).toHaveLength(1);
    for (const [i, wait] of PREVIEW_HOLD_RETRY_MS.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(h.taken).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.taken).toHaveLength(i + 2); // tried again
      h.taken.at(-1)!.settle(false);
      await turn();
    }
    expect(h.preview.state).toBe('unavailable');
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls[0]![0]).toContain('assets/a.json');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.taken).toHaveLength(PREVIEW_HOLD_RETRY_MS.length + 1); // the bound is spent
    h.preview.want(['assets/c.json']); // another preview's refs: asked afresh
    expect(h.taken.at(-1)!.refs).toEqual(['assets/c.json']);
  });

  it('a failed acquisition tried again that succeeds is held', async () => {
    const h = holder();
    h.preview.want(['assets/a.json']);
    h.taken[0]!.settle(false);
    await vi.advanceTimersByTimeAsync(PREVIEW_HOLD_RETRY_MS[0]!);
    h.taken[1]!.settle(true);
    await turn();
    expect(h.preview.state).toBe('held');
    expect(h.open()).toEqual([['assets/a.json']]);
  });

  it('a replacement leaves the earlier lease until it is ready; a failed one keeps it; a superseded one goes', async () => {
    const h = holder();
    h.preview.want(['assets/a.json', 'assets/s.json']);
    h.taken[0]!.settle(true);
    await turn();
    h.preview.want(['assets/b.json', 'assets/s.json']); // the review's rows changed: s is shown throughout
    expect(h.open()).toEqual([['assets/a.json', 'assets/s.json'], ['assets/b.json', 'assets/s.json']]);
    h.preview.want(['assets/c.json', 'assets/s.json']); // changed again before b's lease answered: b's goes, a's stays
    expect(h.open()).toEqual([['assets/a.json', 'assets/s.json'], ['assets/c.json', 'assets/s.json']]);
    for (let i = 0; i <= PREVIEW_HOLD_RETRY_MS.length; i += 1) {
      h.taken.at(-1)!.settle(false);
      await vi.advanceTimersByTimeAsync(PREVIEW_HOLD_RETRY_MS[i] ?? 0);
    }
    expect(h.preview.state).toBe('unavailable');
    expect(h.open()).toEqual([['assets/a.json', 'assets/s.json']]); // the earlier protection kept
    h.taken[1]!.settle(true); // b's late answer belongs to a request superseded long ago
    await turn();
    expect(h.open()).toEqual([['assets/a.json', 'assets/s.json']]);
    h.preview.want(['assets/d.json', 'assets/s.json']);
    expect(h.open()).toEqual([['assets/a.json', 'assets/s.json'], ['assets/d.json', 'assets/s.json']]);
    h.taken.at(-1)!.settle(true);
    await turn();
    expect(h.open()).toEqual([['assets/d.json', 'assets/s.json']]); // ready: only now the earlier one goes
    expect(h.preview.state).toBe('held');
  });

  it('a held lease the host’s restart took is taken again on the same refs; once cleared, nothing is taken again', async () => {
    const h = holder();
    h.preview.want(['assets/a.json']);
    h.taken[0]!.settle(true);
    await turn();
    h.taken[0]!.lose();
    await turn();
    expect(h.taken.map((entry) => entry.refs)).toEqual([['assets/a.json'], ['assets/a.json']]);
    expect(h.taken[0]!.released).toBe(true);
    expect(h.preview.state).toBe('pending');
    h.taken[1]!.settle(true);
    await turn();
    expect(h.preview.state).toBe('held');
    h.preview.clear(); // the preview went with its body
    expect(h.open()).toEqual([]);
    expect(h.preview.state).toBe('none');
    h.taken[1]!.lose();
    await turn();
    expect(h.taken).toHaveLength(2);
  });

  it('clearing cancels a pending retry and lets a pending acquisition go; a disposed one acquires nothing', async () => {
    const h = holder();
    h.preview.want(['assets/a.json']);
    h.taken[0]!.settle(false);
    await turn();
    h.preview.clear();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.taken).toHaveLength(1);
    h.preview.want(['assets/b.json']);
    h.preview.dispose();
    expect(h.open()).toEqual([]);
    h.taken[1]!.settle(true);
    await turn();
    expect(h.open()).toEqual([]);
    h.preview.want(['assets/c.json']);
    expect(h.taken).toHaveLength(2);
  });
});
