// The long-transcript window in the renderer (docs/doperpowers/plans/2026-10-30-long-transcript-window.md): a disk-backed
// session's history answered one window at a time, with every older page loaded as the reader reaches the top, ends in
// exactly the rows a whole-history load draws, though rewinds, a compaction, a background agent and main's own notice
// straddle the page edges; the newest window alone already hides the turns a rewind in it abandoned; and a snapshot
// asked while the host still reads the transcript through waits for the window rather than drawing nothing. A jump to a
// message older than the window (an attention item's mark, residue 2) walks back only to the page holding it, takes the
// pages in with one rebuild and lands on it; one in none of the history ends at once, visibly; the reader can give up.
import { describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { cronHistoryOf, eventBytes, FOLLOW_RELEASED, historyWindowStart, soughtIn, type WindowBudget } from '@shared/graph/history-window';
import type { AppSessionId, EventId, MessageUuid, ParentToolUseId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, EventSource, MawsBridge } from '@shared/ipc/schema';
import { bareOf } from '@shared/machine/address';
import { at, TEST_MACHINE } from '../../../../../test/support/machine';
import { openAnchor } from '../../attention/anchor';
import { createTranscriptStore, useTranscriptStore } from '../../stores/transcript';
import { turnId } from '../model/keys';
import { builder, task, tool, uuid } from '../model/test-events';
import { ipcSourceOver } from './ipc';
import { withHistoryGap, withoutOlderThanWindow } from './older';
import { HISTORY_GAP, isHistoryGap } from '../model/gap'; // P5 O7 M2

const APP = at('app-long' as AppSessionId);
const MAIN_APP = bareOf(APP);
const BUDGET: WindowBudget = { soft: 7_000, hard: 64 * 1024 }; // about three turns a page: the newest takes in turn 10, inside the rewound branch

// Twelve turns as the disk backfill delivers them (`seq: null`): a background agent started in turn 3 whose child
// works there and whose notification lands in turn 6; a compaction before turn 8; turns 9 and 10 abandoned by a rewind
// to turn 9's prompt, after which turns 11 and 12 continue. Main's own notice (an app event no transcript carries)
// sits at turn 4's time.
function history(): { events: SessionEvent[]; notice: SessionEvent } {
  const b = builder();
  const child = { parentToolUseId: 'agent1' as ParentToolUseId };
  let notice: SessionEvent | null = null;
  for (let n = 1; n <= 12; n++) {
    if (n === 8) b.emit('boundary.compaction', { trigger: 'auto', preTokens: 1000, postTokens: 200, logicalParentUuid: uuid('a7'), historical: true });
    if (n === 11) b.emit('boundary.rewind', { targetMessageUuid: uuid('u9'), precedingAssistantUuid: uuid('m8-u0'), prefillText: null });
    b.turn(`u${n}`, `prompt ${n} ${'p'.repeat(300)}`);
    if (n === 3) {
      b.toolUse('agent1', 'Agent', { description: 'Survey', prompt: 'look around' });
      b.emit('subagent.started', { taskId: task('task1'), toolUseId: tool('agent1'), description: 'Survey', subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: null });
      b.emit('tool.use', { toolUseId: tool('c1'), toolName: 'Read', input: { file_path: '/a' }, apiMessageId: null, messageUuid: null } as never, child);
      b.emit('tool.result', { toolUseId: tool('c1'), content: 'x', isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: null }, child);
      b.result('agent1', 'Started in the background.');
    }
    if (n === 4) notice = { ...b.emit('notice.posted', { level: 'warning', key: 'relay:direct_fallback', text: 'Direct route.' }), id: `${MAIN_APP}:c10:relay-fallback:1` as EventId };
    if (n === 6) b.emit('task.notification', { taskId: task('task1'), toolUseId: tool('agent1'), status: 'completed', summary: 'Surveyed.', outputFile: null, reason: null });
    b.text(`m${n}`, 0, `Answer ${n} ${'a'.repeat(300)}`);
    b.end([`u${n}`]);
  }
  const all = b.events.map((event) => ({ ...event, seq: null }) as SessionEvent);
  const app = { ...notice!, seq: null } as SessionEvent;
  return { events: all.filter((event) => event.id !== app.id), notice: app };
}

// A fake main that answers `session.events` as the engine host answers a disk-backed session: the window before
// `before` (or the newest), cut by the same rule, with its `earlier` cursor, and where it stands to a message `seek`
// names (`sought`, unless `seekless`: a host from before jumps into history); `paged: false` answers the whole history.
// `gate`, when set, holds each paged answer until the test releases it.
function fakeHost(events: SessionEvent[], notice: SessionEvent, paged: boolean, options: { seekless?: boolean; gate?: () => Promise<void>; failing?: () => boolean } = {}) {
  const sizeOf = (i: number) => eventBytes(events[i]!);
  const listeners = new Map<string, Set<(payload: unknown, from: EventSource) => void>>();
  const asked: unknown[] = [];
  const answer = (name: CommandName, input: Record<string, unknown>): CommandResult<CommandName> => {
    if (name === 'session.appEvents') return { ok: true, value: { events: [notice] } } as never;
    if (name !== 'session.events') throw new Error(`unexpected ${name}`);
    asked.push(input);
    if (options.failing?.()) return { ok: false, error: { code: 'internal', message: 'the host is gone' } } as never;
    if (!paged) return { ok: true, value: { events, lastSeq: 0, complete: true } } as never;
    const end = input.before === undefined ? events.length : events.findIndex((event) => event.id === input.before);
    const start = historyWindowStart(events, end, sizeOf, BUDGET);
    const sought = input.seek !== undefined && !options.seekless ? soughtIn(events, input.seek as MessageUuid, start, end) : null;
    const crons = input.before === undefined ? cronHistoryOf(events, start) : [];
    return { ok: true, value: { events: events.slice(start, end), lastSeq: 0, complete: true, ...(start > 0 && { earlier: events[start]!.id }), ...(sought && { sought }), ...(crons.length > 0 && { cronHistory: crons }) } } as never;
  };
  const client: MawsBridge = {
    localMachine: TEST_MACHINE,
    invoke: (async (name: CommandName, input: Record<string, unknown>) => {
      if (options.gate && name === 'session.events' && input.before !== undefined) await options.gate();
      return answer(name, input);
    }) as MawsBridge['invoke'],
    on: ((name: EventName, listener: (payload: unknown, from: EventSource) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    }) as MawsBridge['on'],
    pathForFile: () => '',
  };
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    for (const listener of listeners.get(name) ?? []) listener(payload, { machine: TEST_MACHINE });
  };
  return { client, asked, emit };
}

describe('a disk-backed session paged in from its newest window', () => {
  it('draws the rows a whole-history load draws once every older page is in', async () => {
    const { events, notice } = history();

    const whole = createTranscriptStore();
    await whole.getState().attach(APP, ipcSourceOver(fakeHost(events, notice, false).client, APP));

    const paged = createTranscriptStore();
    const host = fakeHost(events, notice, true);
    const source = ipcSourceOver(host.client, APP);
    await paged.getState().attach(APP, source);
    const pages = source.older!;

    // The newest window alone: a rewind in it brought its target along, so the turns it abandoned are already hidden.
    const first = paged.getState().entries[APP]!;
    expect(first.state.turns.has(turnId.ofMessage(uuid('u9')))).toBe(true);
    expect(first.state.hidden?.turns).toEqual([turnId.ofMessage(uuid('u9')), turnId.ofMessage(uuid('u10'))]);
    expect(first.state.order).not.toContain(turnId.ofMessage(uuid('u1')));
    expect(pages.state.getState().more).toBe(true);

    let loaded = 0;
    while (pages.state.getState().more) {
      const revision = pages.state.getState().revision;
      pages.loadOlder();
      await vi.waitFor(() => {
        expect(pages.state.getState().revision).toBe(revision + 1);
        expect(paged.getState().entries[APP]!.phase).toBe('live');
      });
      loaded += 1;
    }
    expect(loaded).toBeGreaterThan(3); // the agent, the compaction and the notice each fell on another page than their neighbours
    expect(host.asked.filter((input) => (input as { before?: unknown }).before !== undefined)).toHaveLength(loaded);

    const all = paged.getState().entries[APP]!;
    const reference = whole.getState().entries[APP]!;
    expect([...all.state.seen]).toEqual([...reference.state.seen]);
    expect(all.rows).toEqual(reference.rows);
    expect(all.state.order).toEqual(reference.state.order);
  });

  it('waits out a transcript the host is still reading, then draws its newest window', async () => {
    const { events, notice } = history();
    const window = events.slice(historyWindowStart(events, events.length, (i) => eventBytes(events[i]!), BUDGET));
    const listeners = new Map<string, Set<(payload: unknown, from: EventSource) => void>>();
    let reading = true;
    const client: MawsBridge = {
      localMachine: TEST_MACHINE,
      invoke: (async (...[name]: [CommandName, unknown]) => {
        if (name === 'session.appEvents') return { ok: true, value: { events: [notice] } };
        if (reading) return { ok: true, value: { events: [], lastSeq: 0, complete: false } };
        return { ok: true, value: { events: window, lastSeq: 0, complete: true, earlier: window[0]!.id } };
      }) as MawsBridge['invoke'],
      on: ((name: EventName, listener: (payload: unknown, from: EventSource) => void) => {
        const set = listeners.get(name) ?? new Set();
        set.add(listener);
        listeners.set(name, set);
        return () => set.delete(listener);
      }) as MawsBridge['on'],
      pathForFile: () => '',
    };
    const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
      for (const listener of listeners.get(name) ?? []) listener(payload, { machine: TEST_MACHINE });
    };
    const store = createTranscriptStore();
    const source = ipcSourceOver(client, APP);
    const hydrated = store.getState().attach(APP, source);
    await vi.waitFor(() => expect(listeners.get('fs.followState')?.size ?? 0).toBeGreaterThan(0));
    expect(store.getState().entries[APP]!.phase).toBe('hydrating'); // not an empty transcript
    // The host finishes: its window as a batch, then the follow's state.
    reading = false;
    emit('session.eventBatch', { appSessionId: APP, events: window });
    emit('fs.followState', { appSessionId: APP, agentId: null, state: 'following', chainLength: 1, leafUuid: null, gap: null, skippedLines: 0, message: null });
    await hydrated;
    const entry = store.getState().entries[APP]!;
    expect(entry.phase).toBe('live');
    expect([...entry.state.seen]).toEqual(window.map((event) => event.id)); // the batch and the answer are one window, once
    expect(source.older!.state.getState().more).toBe(true);
  });
});

describe('batches held while a snapshot was on its way', () => {
  // `d…` disk-form, `l…` another form (live, or the app's own); the snapshot holds `s…`.
  const event = (id: string) => ({ id }) as SessionEvent;
  const diskForm = (e: SessionEvent) => !e.id.startsWith('l');
  const held = (...batches: string[][]) => batches.map((batch) => batch.map(event));
  const ids = (batches: SessionEvent[][]) => batches.map((batch) => batch.map((e) => e.id));
  const snapshot = ['s1', 's2', 's3'].map(event);

  it('drops a disk-form event the snapshot lacks before the last held event it holds, and nothing else', () => {
    expect(ids(withoutOlderThanWindow(held(['d0', 'l0', 's1'], ['d1', 's2', 'd2', 'l1'], ['d3']), snapshot, diskForm))).toEqual([['l0', 's1'], ['s2', 'd2', 'l1'], ['d3']]);
  });

  it('keeps every batch whole when none holds a disk-form event the snapshot holds (nothing shows how far it reaches)', () => {
    expect(ids(withoutOlderThanWindow(held(['d0', 'l0'], ['d1']), snapshot, diskForm))).toEqual([['d0', 'l0'], ['d1']]);
    expect(withoutOlderThanWindow([], snapshot, diskForm)).toEqual([]);
    // The app's own event the snapshot read from main after the host's answer (a side thread's summary, batched after
    // the next turn) shows nothing of the window's reach: the turn before it stays.
    const withAppEvent = [...snapshot, event('l2')];
    expect(ids(withoutOlderThanWindow(held(['d4', 'l2']), withAppEvent, diskForm))).toEqual([['d4', 'l2']]);
  });
});

describe('a jump to a message older than the window', () => {
  const textOf = (n: number) => ({ messageUuid: uuid(`m${n}-u0`), blockIndex: 0 }); // turn n's answer
  const seeks = (asked: unknown[]) => asked.filter((input) => (input as { seek?: unknown }).seek !== undefined);
  const landedOn = (store: ReturnType<typeof createTranscriptStore>, n: number) => {
    const entry = store.getState().entries[APP]!;
    const row = entry.rows.find((candidate) => candidate.id === entry.jump?.rowId);
    return row?.kind === 'assistant_text' && row.messageUuid === textOf(n).messageUuid;
  };

  it('opens on one window, then walks back only to the page holding the message, takes the pages in with one rebuild and lands on it', async () => {
    const { events, notice } = history();
    const store = createTranscriptStore();
    const host = fakeHost(events, notice, true);
    const source = ipcSourceOver(host.client, APP);
    await store.getState().attach(APP, source);
    expect(host.asked).toEqual([{ appSessionId: APP, afterSeq: null, limit: null }]); // the open: the newest window, nothing more
    const opened = store.getState().entries[APP]!;
    expect(opened.state.order).not.toContain(turnId.ofMessage(uuid('u2')));
    const revision = source.older!.state.getState().revision;

    expect(await store.getState().reachMessage(APP, textOf(2))).toBe('landed');
    expect(landedOn(store, 2)).toBe(true);
    expect(store.getState().entries[APP]!.reach).toBeUndefined();
    // Several pages walked, each asked with the message, the last the one holding it; one rebuild took them all in.
    const walked = seeks(host.asked);
    expect(walked.length).toBeGreaterThan(1);
    expect(walked.every((input) => (input as { seek: unknown }).seek === textOf(2).messageUuid)).toBe(true);
    expect(source.older!.state.getState().revision).toBe(revision + 1);
    // The walk stopped at that page: turn 1 is older still and was not asked for
    expect(store.getState().entries[APP]!.state.order).toContain(turnId.ofMessage(uuid('u2')));
    expect(store.getState().entries[APP]!.state.order).not.toContain(turnId.ofMessage(uuid('u1')));
    expect(source.older!.state.getState().more).toBe(true);
  });

  it('ends at once, saying so, when the message is in none of the history: one page asked, nothing taken in', async () => {
    const { events, notice } = history();
    const store = createTranscriptStore();
    const host = fakeHost(events, notice, true);
    const source = ipcSourceOver(host.client, APP);
    await store.getState().attach(APP, source);
    const rows = store.getState().entries[APP]!.rows;
    const anchor = { messageUuid: 'gone' as MessageUuid, blockIndex: 0 };
    expect(await store.getState().reachMessage(APP, anchor)).toBe('missing');
    expect(store.getState().entries[APP]!.reach).toEqual({ anchor, phase: 'missing' });
    expect(seeks(host.asked)).toHaveLength(1);
    expect(store.getState().entries[APP]!.rows).toBe(rows);
    store.getState().stopReach(APP); // dismissed
    expect(store.getState().entries[APP]!.reach).toBeUndefined();
  });

  it('says it is loading while the pages are on their way, and the reader can give up: nothing walked is taken in', async () => {
    const { events, notice } = history();
    const store = createTranscriptStore();
    let release: () => void = () => {};
    const host = fakeHost(events, notice, true, { gate: () => new Promise<void>((resolve) => (release = resolve)) });
    const source = ipcSourceOver(host.client, APP);
    await store.getState().attach(APP, source);
    const revision = source.older!.state.getState().revision;
    const reaching = store.getState().reachMessage(APP, textOf(2));
    expect(store.getState().entries[APP]!.reach).toMatchObject({ phase: 'loading', progress: null });
    await vi.waitFor(() => expect(seeks(host.asked)).toHaveLength(0)); // the first page waits at the gate
    release();
    await vi.waitFor(() => expect(store.getState().entries[APP]!.reach).toMatchObject({ phase: 'loading', progress: expect.any(Number) }));
    store.getState().stopReach(APP);
    release();
    expect(await reaching).toBe('stopped');
    expect(store.getState().entries[APP]!.reach).toBeUndefined();
    expect(source.older!.state.getState().revision).toBe(revision);
    expect(store.getState().entries[APP]!.jump).toBeNull();
    // the reader's own pages ask again from where they were
    source.older!.loadOlder();
    await vi.waitFor(() => expect(source.older!.state.getState().loadingOlder).toBe(true));
    release();
    await vi.waitFor(() => expect(source.older!.state.getState().revision).toBe(revision + 1));
  });

  it('lands on a message the reader\u2019s own page in flight brings, which the seek waited for', async () => {
    const { events, notice } = history();
    const store = createTranscriptStore();
    let release: () => void = () => {};
    const host = fakeHost(events, notice, true, { gate: () => new Promise<void>((resolve) => (release = resolve)) });
    const source = ipcSourceOver(host.client, APP);
    await store.getState().attach(APP, source);
    const sizeOf = (i: number) => eventBytes(events[i]!);
    const newest = historyWindowStart(events, events.length, sizeOf, BUDGET);
    const older = events.slice(historyWindowStart(events, newest, sizeOf, BUDGET), newest);
    const text = older.find((event) => event.kind === 'assistant.block.complete' && event.agentId === null && event.block.type === 'text');
    if (text?.kind !== 'assistant.block.complete') throw new Error('the page before the window holds no text');
    source.older!.loadOlder(); // the reader reached the top: the page before the window is on its way
    const reaching = store.getState().reachMessage(APP, { messageUuid: text.messageUuid!, blockIndex: text.blockIndex });
    release();
    await vi.waitFor(() => expect(source.older!.state.getState().loadingOlder).toBe(false));
    release();
    expect(await reaching).toBe('landed');
    expect(store.getState().entries[APP]!.reach).toBeUndefined();
  });

  it('lands through an engine host that does not know `seek`: each page says whether it holds the message', async () => {
    const { events, notice } = history();
    const store = createTranscriptStore();
    const host = fakeHost(events, notice, true, { seekless: true });
    await store.getState().attach(APP, ipcSourceOver(host.client, APP));
    expect(await store.getState().reachMessage(APP, textOf(3))).toBe('landed');
    expect(landedOn(store, 3)).toBe(true);
  });

  it('an attention item’s mark several pages back opens on it (openAnchor, the owner channel’s jump)', async () => {
    const { events, notice } = history();
    const host = fakeHost(events, notice, true);
    const source = ipcSourceOver(host.client, APP);
    const attached = useTranscriptStore.getState().attach(APP, source);
    openAnchor(APP, textOf(2), () => {}); // the tab opens; its history arrives after
    await attached;
    await vi.waitFor(() => {
      const entry = useTranscriptStore.getState().entries[APP]!;
      const row = entry.rows.find((candidate) => candidate.id === entry.jump?.rowId);
      expect(row).toMatchObject({ kind: 'assistant_text', messageUuid: textOf(2).messageUuid });
    });
    expect(useTranscriptStore.getState().entries[APP]!.state.ui.view).toBe('report');
    useTranscriptStore.getState().drop(APP);
  });
});

// The Scheduled section's carry (`cronHistory`): what the newest window's answer said of its older history's cron calls
// goes onto the key with the history it answered, so a fresh read that fails keeps the carry of the history it keeps.
describe('the cron calls a newest window carries', () => {
  function withCron(): { events: SessionEvent[]; notice: SessionEvent } {
    const { events, notice } = history();
    const b = builder('2026-09-28T09:00:00.000Z');
    b.toolUse('cron1', 'CronCreate', { cron: '0 3 * * *', prompt: 'nightly' });
    b.result('cron1', 'Scheduled recurring job abcd1234 (Every day at 3:00 AM). Session-only (not written to disk, dies when Claude exits). Auto-expires after 7 days.');
    const at = events.findIndex((event) => event.kind === 'turn.ended'); // inside turn 1, many pages back
    const call = b.events.map((event) => ({ ...event, seq: null, at: events[at]!.at }) as SessionEvent);
    return { events: [...events.slice(0, at), ...call, ...events.slice(at)], notice };
  }

  it('lands on the key with the open, and stays through a fresh read that failed', async () => {
    const { events, notice } = withCron();
    let failing = false;
    const host = fakeHost(events, notice, true, { failing: () => failing });
    const store = createTranscriptStore();
    await store.getState().attach(APP, ipcSourceOver(host.client, APP));
    const carried = store.getState().entries[APP]!.cronHistory!;
    expect(carried.filter((event) => event.kind === 'tool.use').map((event) => (event as { toolName: string }).toolName)).toEqual(['CronCreate']);
    // the follow released while the source stayed mounted, then the session's record changed: a fresh read, which fails
    failing = true;
    host.emit('fs.followState', { appSessionId: APP, agentId: null, state: 'stopped', chainLength: 0, leafUuid: null, gap: null, skippedLines: 0, message: FOLLOW_RELEASED });
    host.emit('session.changed', { record: { appId: APP, holder: { kind: 'terminal', pid: 7 } }, cause: 'live', revision: 1 } as never);
    await vi.waitFor(() => expect(store.getState().entries[APP]!.phase).toBe('failed'));
    expect(store.getState().entries[APP]!.cronHistory).toBe(carried);
  });
});

// P5 O7 M2 (P5 Decision Log 77): an older page whose range is partly gone starts with the gap bar's event, under the bare
// app id as the app's own events are, the same for the same page; a whole page is left as it is.
describe('withHistoryGap', () => {
  it('puts the gap at the start of a page partly gone, once per page, and leaves a whole page alone', () => {
    const b = builder();
    b.turn('u1');
    const page = { events: b.events, complete: false, historyUnavailable: true as const };
    const gapped = withHistoryGap(page, 'app-1');
    expect(gapped.events.slice(1)).toEqual(b.events);
    expect(isHistoryGap(gapped.events[0]!)).toBe(true);
    expect(gapped.events[0]).toMatchObject({ seq: null, at: b.events[0]!.at, text: HISTORY_GAP });
    expect(gapped.events[0]!.id.startsWith('app-1:')).toBe(true);
    expect(withHistoryGap(page, 'app-1').events[0]!.id).toBe(gapped.events[0]!.id);
    const whole = { events: b.events, complete: true };
    expect(withHistoryGap(whole, 'app-1')).toBe(whole);
  });
});
