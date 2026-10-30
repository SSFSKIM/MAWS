// The long-transcript window in the renderer (docs/doperpowers/plans/2026-10-30-long-transcript-window.md): a disk-backed
// session's history answered one window at a time, with every older page loaded as the reader reaches the top, ends in
// exactly the rows a whole-history load draws, though rewinds, a compaction, a background agent and main's own notice
// straddle the page edges; the newest window alone already hides the turns a rewind in it abandoned; and a snapshot
// asked while the host still reads the transcript through waits for the window rather than drawing nothing.
import { describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { eventBytes, historyWindowStart, type WindowBudget } from '@shared/graph/history-window';
import type { AppSessionId, EventId, ParentToolUseId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, EventSource, MawsBridge } from '@shared/ipc/schema';
import { bareOf } from '@shared/machine/address';
import { at, TEST_MACHINE } from '../../../../../test/support/machine';
import { createTranscriptStore } from '../../stores/transcript';
import { turnId } from '../model/keys';
import { builder, task, tool, uuid } from '../model/test-events';
import { ipcSourceOver } from './ipc';

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
// `before` (or the newest), cut by the same rule, with its `earlier` cursor; `paged: false` answers the whole history.
function fakeHost(events: SessionEvent[], notice: SessionEvent, paged: boolean) {
  const sizeOf = (i: number) => eventBytes(events[i]!);
  const listeners = new Map<string, Set<(payload: unknown, from: EventSource) => void>>();
  const asked: unknown[] = [];
  const answer = (name: CommandName, input: Record<string, unknown>): CommandResult<CommandName> => {
    if (name === 'session.appEvents') return { ok: true, value: { events: [notice] } } as never;
    if (name !== 'session.events') throw new Error(`unexpected ${name}`);
    asked.push(input);
    if (!paged) return { ok: true, value: { events, lastSeq: 0, complete: true } } as never;
    const end = input.before === undefined ? events.length : events.findIndex((event) => event.id === input.before);
    const start = historyWindowStart(events, end, sizeOf, BUDGET);
    return { ok: true, value: { events: events.slice(start, end), lastSeq: 0, complete: true, ...(start > 0 && { earlier: events[start]!.id }) } } as never;
  };
  const client: MawsBridge = {
    localMachine: TEST_MACHINE,
    invoke: (async (name: CommandName, input: Record<string, unknown>) => answer(name, input)) as MawsBridge['invoke'],
    on: ((name: EventName, listener: (payload: unknown, from: EventSource) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    }) as MawsBridge['on'],
    pathForFile: () => '',
  };
  return { client, asked };
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
