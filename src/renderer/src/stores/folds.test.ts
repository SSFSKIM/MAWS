// What a window last read of the to-human mod's file of fold summaries, and the reads (UX wave U2b; the execution
// document, Interfaces §M, "The reads"; decisions 29 and 32; M7's sequences): a round of reads at 3, 8, 20 and 45
// seconds after each mount of a session's view (with one read at once), each close of a stretch and each end of a
// turn; one read at each return of the window's focus; no round cut short by what a read returned; a successful read
// taken whole, a failed one or `runs: null` changing nothing; answers taken in the order the reads were sent, and
// dropped for a key with no mount left. Each sequence holds the order open with the clock in the test's hand. Every
// summary is invented.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { StoredRun } from '@shared/owner/folds';
import { fakeClient } from '../../../../test/support/fake-client';
import { labelsOf } from '../owner/view/label';
import { mirrorRows, mirrorsView, stretchesOf } from '../owner/view/mirror';
import type { Row, TurnId } from '../transcript/model/rows';
import { createFoldReads, lastStretchClosed, ROUND_AFTER_MS, useStoredFolds, type FoldReads } from './folds';

const APP = 'app-folds' as AppSessionId;
const OTHER = 'app-folds-2' as AppSessionId;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const run = (first: string, last: string, summary: string): StoredRun => ({ first, last, summary });
const S1 = run('toolu_a', 'toolu_b', 'Read the notes');
const S2 = run('toolu_c', 'toolu_c', 'Ran the tests: 14 passed');

// The clock in the test's hand: `to` runs every timer due by then, in order, letting each read's promise settle.
function fakeClock() {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  return {
    after(ms: number, task: () => void) {
      const timer = { at: now + ms, run: task, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    async to(ms: number) {
      for (;;) {
        const due = timers.filter((timer) => timer.live && timer.at <= ms).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        now = due.at;
        due.live = false;
        due.run();
        await settle();
      }
      now = ms;
    },
    armed: () => timers.filter((timer) => timer.live).length,
  };
}

function setup() {
  const fake = fakeClient();
  const clock = fakeClock();
  const focus = new Set<() => void>();
  const reads = createFoldReads({ client: fake.client, after: clock.after, onFocus: (listener) => (focus.add(listener), () => focus.delete(listener)) });
  const held = (key: AppSessionId = APP) => reads.store.getState().runs.get(key);
  const sent = () => fake.invoked('ownerChannel.folds').length;
  const answer = (runs: StoredRun[] | null, nth?: number) => fake.reply('ownerChannel.folds', { runs }, nth);
  const focused = async () => {
    for (const listener of [...focus]) listener();
    await settle();
  };
  return { fake, clock, reads, held, sent, answer, focused, focus };
}

let mounted: FoldReads[] = [];
afterEach(() => {
  for (const reads of mounted) reads.reset();
  mounted = [];
});
const track = <T extends ReturnType<typeof setup>>(s: T): T => {
  mounted.push(s.reads);
  return s;
};

describe('the reads of a session’s fold summaries', () => {
  it('a mount reads at once, then 3, 8, 20 and 45 seconds after; then nothing is armed', async () => {
    const s = track(setup());
    expect(ROUND_AFTER_MS).toEqual([3_000, 8_000, 20_000, 45_000]);
    s.reads.mount(APP);
    expect(s.fake.invoked('ownerChannel.folds')).toEqual([{ appSessionId: APP }]);
    await s.answer([S1]);
    expect(s.held()).toEqual([S1]);
    for (const [i, at] of ROUND_AFTER_MS.entries()) {
      await s.clock.to(at - 1);
      expect(s.sent(), `before ${at}`).toBe(i + 1);
      await s.clock.to(at);
      expect(s.sent(), `at ${at}`).toBe(i + 2);
      await s.answer([S1]);
    }
    expect(s.clock.armed()).toBe(0);
  });

  it('two reads in flight answered out of order: the later read’s answer stands', async () => {
    const s = track(setup());
    const first = s.reads.mount(APP);
    first(); // the tab closes while its read is out
    s.reads.mount(APP);
    expect(s.fake.pending('ownerChannel.folds')).toBe(2);
    await s.answer([S2], 1); // the later read answers first
    await s.answer([S1], 0);
    expect(s.held()).toEqual([S2]);
  });

  it('a read answered after the tab changed session is dropped, by its key', async () => {
    const s = track(setup());
    const { rerender } = renderHook(({ key }) => useStoredFolds(key, true, s.reads), { initialProps: { key: APP } });
    rerender({ key: OTHER });
    await act(() => s.answer([S1], 0)); // APP's read
    expect(s.held(APP)).toBeUndefined();
    await act(() => s.answer([S2], 0)); // OTHER's
    expect(s.held(OTHER)).toEqual([S2]);
  });

  it('a read that fails, and one that answers runs: null, between two that succeed: the window keeps the earlier read whole', async () => {
    const s = track(setup());
    s.reads.mount(APP);
    await s.answer([S1, S2]);
    await s.clock.to(3_000);
    await s.fake.fail('ownerChannel.folds', 'the daemon did not answer', 'timeout');
    expect(s.held()).toEqual([S1, S2]);
    await s.clock.to(8_000);
    await s.answer(null);
    expect(s.held()).toEqual([S1, S2]);
    await s.clock.to(20_000);
    await s.answer([S1, S2, run('toolu_d', 'toolu_e', 'Wrote the changelog')]);
    expect(s.held()).toHaveLength(3);
  });

  it('a successful read that holds fewer runs than the window had is taken whole', async () => {
    const s = track(setup());
    s.reads.mount(APP);
    await s.answer([S1, S2]);
    await s.clock.to(3_000);
    await s.answer([S2]);
    expect(s.held()).toEqual([S2]);
  });

  it('the last mount goes while a read is out and a timer is armed: nothing is written, no timer fires; the next mount starts a round of its own', async () => {
    const s = track(setup());
    const off = s.reads.mount(APP);
    await s.answer([]);
    await s.clock.to(3_000);
    expect(s.fake.pending('ownerChannel.folds')).toBe(1);
    off();
    expect(s.clock.armed()).toBe(0);
    await s.answer([S1]);
    expect(s.held()).toEqual([]);
    await s.clock.to(60_000);
    expect(s.sent()).toBe(2);
    s.reads.mount(APP);
    expect(s.sent()).toBe(3);
    await s.answer([S1]);
    expect(s.held()).toEqual([S1]);
    expect(s.clock.armed()).toBe(4);
  });

  it('reads that fall due while one is out are sent as one read when it answers, and none is dropped', async () => {
    const s = track(setup());
    s.reads.mount(APP);
    s.reads.round(APP); // a close at once: its reads and the mount's fall due together
    await s.clock.to(3_000);
    expect(s.fake.pending('ownerChannel.folds')).toBe(1); // the mount's first read is still out
    await s.answer([]);
    expect(s.fake.pending('ownerChannel.folds')).toBe(1); // the reads that fell due, sent as one
    await s.answer([S1]);
    expect(s.held()).toEqual([S1]);
    expect(s.sent()).toBe(2);
    await s.clock.to(60_000);
    for (let i = 0; i < 8 && s.fake.pending('ownerChannel.folds') > 0; i += 1) await s.answer([S1]);
    expect(s.clock.armed()).toBe(0);
    expect(s.sent()).toBeGreaterThan(2);
  });

  it('a stretch closes and the first read already holds its summary: the round runs to its last read, and a newer summary under the same first row replaces the older', async () => {
    const s = track(setup());
    s.reads.mount(APP);
    await s.answer([]);
    await s.clock.to(60_000);
    while (s.fake.pending('ownerChannel.folds') > 0) await s.answer([]);
    const before = s.sent();
    s.reads.round(APP); // the stretch closed
    await s.clock.to(63_000);
    await s.answer([S1]);
    expect(s.held()).toEqual([S1]);
    await s.clock.to(68_000);
    await s.answer([S1]);
    await s.clock.to(80_000);
    const newer = run('toolu_a', 'toolu_b', 'Read the notes and fixed two links'); // a late result joined the run
    await s.answer([newer]);
    expect(s.held()).toEqual([newer]);
    await s.clock.to(105_000);
    await s.answer([newer]);
    expect(s.sent() - before).toBe(4);
  });

  it('a stretch that grows by a note alone after its summary, or by a late result, reads the newer summary at the round after the next close or end of a turn', async () => {
    const s = track(setup());
    const T = 'turn:t' as TurnId;
    const AT = '2026-11-16T10:00:00.000Z';
    const prompt = { id: 'user:1', turnId: T, at: AT, kind: 'user', messageUuid: 'u1', text: 'Fix it.', steer: false } as unknown as Row;
    const call = { id: 'cell:toolu_a', turnId: T, at: AT, kind: 'cell', toolUseId: 'toolu_a', toolName: 'Bash', status: 'done', background: false } as unknown as Row;
    const note = { id: 'text:n:0', turnId: T, at: AT, kind: 'assistant_text', messageUuid: 'n1', blockIndex: 0, markdown: 'One more thing to check.', live: false, phase: 'commentary', model: null } as unknown as Row;
    const message = { id: 'text:m:0', turnId: T, at: AT, kind: 'assistant_text', messageUuid: 'm1', blockIndex: 0, markdown: '<message>Fixed.</message>', live: false, phase: 'answer', model: null } as unknown as Row;
    const lineOf = (rows: Row[]) => {
      const drawn = mirrorRows(rows, {}, '', labelsOf(rows, { stored: s.held() ?? [], running: false }));
      return drawn.find((row): row is Extract<Row, { kind: 'record_fold' }> => row.kind === 'record_fold')!.label;
    };
    s.reads.mount(APP);
    await s.answer([run('toolu_a', 'toolu_a', 'Fixed the parser')]);
    expect(lineOf([prompt, call, message])).toBe('Fixed the parser');
    s.reads.round(APP); // a note joined the run, then the turn ended
    await s.clock.to(3_000);
    while (s.fake.pending('ownerChannel.folds') > 0) await s.answer([run('toolu_a', 'n1', 'Fixed the parser and checked the edge case')]);
    expect(lineOf([prompt, call, note, message])).toBe('Fixed the parser and checked the edge case');
  });

  it('a window mounted while a summary is outstanding reads it in its mount’s round; a remount during a round runs a round whole', async () => {
    const s = track(setup());
    const off = s.reads.mount(APP);
    await s.answer([]);
    await s.clock.to(3_000);
    await s.answer([S1]); // the summary that was being made when the window looked
    expect(s.held()).toEqual([S1]);
    off();
    const remounted = s.sent();
    s.reads.mount(APP);
    await s.answer([S1]);
    for (const at of ROUND_AFTER_MS) {
      await s.clock.to(3_000 + at);
      await s.answer([S1]);
    }
    expect(s.sent() - remounted).toBe(5); // at once, then 3, 8, 20 and 45 seconds after the remount
    expect(s.clock.armed()).toBe(0);
  });

  it('a summary written after a round’s last read shows at the next return of focus, close, end of a turn or mount', async () => {
    const s = track(setup());
    s.reads.mount(APP);
    await s.answer([]);
    await s.clock.to(45_000);
    while (s.fake.pending('ownerChannel.folds') > 0) await s.answer([]);
    expect(s.clock.armed()).toBe(0);
    expect(s.held()).toEqual([]); // the line reads working record
    await s.focused();
    expect(s.fake.pending('ownerChannel.folds')).toBe(1);
    await s.answer([S1]);
    expect(s.held()).toEqual([S1]);
    expect(s.clock.armed()).toBe(0); // a return of focus is one read, not a round
  });

  it('the return of focus reads each key a view of this window mounts, and no other', async () => {
    const s = track(setup());
    const off = s.reads.mount(APP);
    s.reads.mount(OTHER);
    off();
    await s.answer([], 0);
    await s.answer([], 0);
    const before = s.fake.invoked('ownerChannel.folds').length;
    await s.focused();
    expect(s.fake.invoked('ownerChannel.folds').slice(before)).toEqual([{ appSessionId: OTHER }]);
  });

  it('the mod removed the session’s file: the next successful read answers no runs; a second window and a reopened one read the same', async () => {
    const s = track(setup());
    const off = s.reads.mount(APP);
    await s.answer([S1]);
    await s.clock.to(3_000);
    await s.answer([]);
    expect(s.held()).toEqual([]);
    const second = track(setup());
    second.reads.mount(APP);
    await second.answer([]);
    expect(second.held()).toEqual([]);
    off();
    s.reads.mount(APP);
    await s.answer([]);
    expect(s.held()).toEqual([]);
  });

  it('the person opens and folds the stretch while its summary arrives: the open set is untouched, and the closed line reads the summary', async () => {
    const s = track(setup());
    const T = 'turn:t' as TurnId;
    const AT = '2026-11-16T10:00:00.000Z';
    const rows = [
      { id: 'user:1', turnId: T, at: AT, kind: 'user', messageUuid: 'u1', text: 'Read them.', steer: false },
      { id: 'cell:toolu_a', turnId: T, at: AT, kind: 'cell', toolUseId: 'toolu_a', toolName: 'Read', status: 'done', background: false },
      { id: 'cell:toolu_b', turnId: T, at: AT, kind: 'cell', toolUseId: 'toolu_b', toolName: 'Read', status: 'done', background: false },
      { id: 'text:m:0', turnId: T, at: AT, kind: 'assistant_text', messageUuid: 'm1', blockIndex: 0, markdown: '<message>Read.</message>', live: false, phase: 'answer', model: null },
    ] as unknown as Row[];
    const key = stretchesOf(rows)[0]!.key;
    const openStretches = new Set([key]);
    s.reads.mount(APP);
    await s.answer([S1]);
    expect([...openStretches]).toEqual([key]);
    const opened = mirrorRows(rows, { openStretches }, '', labelsOf(rows, { stored: s.held()!, running: false }));
    expect(opened.filter((row) => row.kind === 'record_fold').map((row) => (row.kind === 'record_fold' ? [row.open, row.label] : null))).toEqual([[true, undefined]]);
    openStretches.delete(key);
    const folded = mirrorRows(rows, { openStretches }, '', labelsOf(rows, { stored: s.held()!, running: false }));
    expect(folded.find((row) => row.kind === 'record_fold')).toMatchObject({ open: false, label: 'Read the notes' });
  });

  it('modDraws turns true while reads are armed: they end, and no mirror is drawn', async () => {
    const s = track(setup());
    const ui = { ownerLane: true, view: 'report' as const, noTurnFold: true, modDraws: false };
    const { rerender } = renderHook(({ enabled }) => useStoredFolds(APP, enabled, s.reads), { initialProps: { enabled: mirrorsView(ui) } });
    await act(() => s.answer([S1]));
    expect(s.clock.armed()).toBe(4);
    const drawn = { ...ui, modDraws: true };
    expect(mirrorsView(drawn)).toBe(false);
    rerender({ enabled: mirrorsView(drawn) });
    expect(s.clock.armed()).toBe(0);
    await act(() => s.clock.to(60_000));
    expect(s.sent()).toBe(1);
  });

  it('a daemon that answers unknown_command stops the key: no read is armed or sent for it again', async () => {
    const s = track(setup());
    const off = s.reads.mount(APP);
    await s.fake.fail('ownerChannel.folds', 'no such command', 'unknown_command');
    expect(s.clock.armed()).toBe(0);
    off();
    s.reads.mount(APP);
    s.reads.round(APP);
    await s.focused();
    expect(s.sent()).toBe(1);
  });

  it('a refusal for the key stops it as unknown_command does', async () => {
    const s = track(setup());
    s.reads.mount(APP);
    await s.fake.fail('ownerChannel.folds', 'Not yet: the owner channel', 'internal', { refusal: 'not-offered' });
    expect(s.clock.armed()).toBe(0);
    s.reads.round(APP);
    expect(s.sent()).toBe(1);
  });

  it('a key with no mount reads nothing at a close, an end of a turn or a return of focus', async () => {
    const s = track(setup());
    s.reads.round(APP);
    await s.focused();
    await s.clock.to(60_000);
    expect(s.sent()).toBe(0);
  });
});

describe('lastStretchClosed: whether a row the person reads stands after the drawn rows’ last record line', () => {
  const T = 'turn:t' as TurnId;
  const AT = '2026-11-16T10:00:00.000Z';
  const r = (kind: Row['kind'], fields: Record<string, unknown> = {}) => ({ id: `${kind}:${Math.random()}`, turnId: T, at: AT, kind, ...fields }) as unknown as Row;
  const line = (open: boolean) => r('record_fold', { stretch: 'toolu_a', open });

  it.each<[string, Row[], boolean]>([
    ['no record line', [r('user'), r('assistant_text')], false],
    ['a closed line last', [r('user'), line(false)], false],
    ['a closed line, then the running turn’s line', [r('user'), line(false), r('divider', { state: 'working' })], false],
    ['a closed line, then a message', [r('user'), line(false), r('assistant_text')], true],
    ['an opened stretch’s line, then a prompt', [r('user'), r('cell'), line(true), r('user')], true],
    ['a closed line, then a message waiting in the queue', [r('user'), line(false), r('user', { pending: 'held' })], false],
    ['an earlier line closed, the last one open-ended', [line(false), r('assistant_text'), line(false)], false],
  ])('%s', (_name, rows, closed) => {
    expect(lastStretchClosed(rows)).toBe(closed);
  });
});
