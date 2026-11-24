import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, EventId, TaskId, ToolUseId } from '@shared/graph/ids';
import { mirrorRows } from '../owner/view/mirror';
import { describe, expect, it } from 'vitest';
import { cellId, rowId, turnId } from '../transcript/model/keys';
import type { Row } from '../transcript/model/rows';
import { api, BASH_RESULT, builder, request, tool, uuid } from '../transcript/model/test-events';
import type { TranscriptSource } from '../transcript/source/types';
import { synthesise } from '../../../../test/support/synth-transcript';
import { turnDerivations } from '../transcript/model/derive';
import { createTranscriptStore, liveBuffer } from './transcript';
import { runOfOneId } from '../transcript/model/groups';

// A source whose snapshot is fixed and whose batches the test pushes.
function pushSource(snapshot: SessionEvent[] = []) {
  let listener: ((events: SessionEvent[]) => void) | null = null;
  const source: TranscriptSource = {
    subscribe(l) {
      listener = l;
      return () => (listener = null);
    },
    snapshot: () => Promise.resolve(snapshot),
  };
  return { source, push: (events: SessionEvent[]) => listener?.(events), get subscribed() { return listener !== null; } };
}

const KEY = 's1';
const kinds = (rows: Row[]) => rows.map((row) => row.kind);

// Two closed turns: the first with two Bash calls (one group) and an answer, the second with one answer.
function twoTurns() {
  const b = builder();
  b.turn('u1');
  b.toolUse('t1', 'Bash', { command: 'ls' }, 'm1', 0);
  b.result('t1', 'a', { structured: BASH_RESULT('a') });
  b.toolUse('t2', 'Bash', { command: 'pwd' }, 'm1', 1);
  b.result('t2', 'b', { structured: BASH_RESULT('b') });
  b.text('m2', 0, 'First answer');
  b.end(['u1']);
  b.turn('u2');
  b.text('m3', 0, 'Second answer\n\nLast line');
  b.end(['u2']);
  return b;
}

describe('transcript store', () => {
  it('hydrates a key from its source and applies live batches after the snapshot', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    const { source, push } = pushSource(b.events.slice(0, 8));
    await store.getState().attach(KEY, source);
    expect(store.getState().entries[KEY].phase).toBe('live');
    push(b.events.slice(6)); // overlaps the snapshot's tail: deduplicated by id
    const rows = store.getState().rows(KEY);
    expect(rows.filter((row) => row.kind === 'user').map((row) => row.id)).toEqual([rowId.user(uuid('u1')), rowId.user(uuid('u2'))]);
    expect(store.getState().lastAssistantLine(KEY)).toBe('Last line');
  });

  it('attaching the same source to its key again while it hydrates keeps the attachment and its buffered batches', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    const fake = pushSource([]);
    const first = store.getState().attach(KEY, fake.source);
    fake.push(b.events); // released before the snapshot resolved (the harness seeks history at load): buffered
    const second = store.getState().attach(KEY, fake.source); // the view mounting over the same source
    await Promise.all([first, second]);
    expect(fake.subscribed).toBe(true);
    expect(store.getState().rows(KEY).filter((row) => row.kind === 'user')).toHaveLength(2);
  });

  it('detach unsubscribes and keeps the state', async () => {
    const store = createTranscriptStore();
    const fake = pushSource(twoTurns().events);
    await store.getState().attach(KEY, fake.source);
    store.getState().detach(KEY);
    expect(fake.subscribed).toBe(false);
    expect(store.getState().rows(KEY).length).toBeGreaterThan(0);
  });

  // UX wave U5a (Decision Log 52): a selector over `attached` (the refusal dialog's) hears the last holder go
  it('the last detach tells the store’s subscribers that the key is no longer attached; an earlier one tells nothing', async () => {
    const store = createTranscriptStore();
    const fake = pushSource(twoTurns().events);
    await store.getState().attach(KEY, fake.source);
    await store.getState().attach(KEY, fake.source); // a second holder of the same source
    const heard: boolean[] = [];
    const off = store.subscribe((state) => heard.push(state.attached(KEY)));
    store.getState().detach(KEY);
    expect(heard).toEqual([]);
    store.getState().detach(KEY);
    expect(heard).toEqual([false]);
    off();
  });

  it('toggles a turn, a group and a cell, and later batches still apply (the lineage is kept)', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    const fake = pushSource(b.events.slice(0, 10)); // the first turn, closed
    await store.getState().attach(KEY, fake.source);
    const first = turnId.ofMessage(uuid('u1'));
    expect(kinds(store.getState().rows(KEY))).not.toContain('group'); // a closed turn is collapsed
    store.getState().toggleTurn(KEY, first);
    const group = store.getState().rows(KEY).find((row) => row.kind === 'group')!;
    expect(group).toBeDefined();
    store.getState().toggleGroup(KEY, group.id);
    store.getState().toggleCell(KEY, cellId.tool(tool('t1')));
    const expanded = store.getState().rows(KEY).find((row) => row.kind === 'group');
    expect(expanded?.kind === 'group' && expanded.expanded).toBe(true);
    expect(expanded?.kind === 'group' && expanded.cells[0].expanded).toBe(true);
    fake.push(b.events.slice(10));
    expect(store.getState().rows(KEY).filter((row) => row.kind === 'user')).toHaveLength(2);
    store.getState().toggleTurn(KEY, first);
    expect(kinds(store.getState().rows(KEY))).not.toContain('group');
  });

  // Whole-branch review: one click re-derived all 500 turns (22 to 24 ms). A toggle names its turn, and only that turn
  // re-derives; every other turn's rows keep their references in the flat list.
  it('a toggle re-derives only the turn it names: turn, group and cell toggles on turn 7 of fifty', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(synthesise({ turns: 50, seed: 1 })).source);
    const state = () => store.getState().entries[KEY].state;
    const seventh = state().order[6];
    const others = (rows: Row[]) => rows.filter((row) => row.turnId !== seventh);
    const step = (act: () => void) => {
      const before = store.getState().rows(KEY);
      const derivations = turnDerivations.count;
      act();
      const after = store.getState().rows(KEY);
      expect(turnDerivations.count - derivations).toBe(1);
      const kept = others(before);
      expect(others(after)).toHaveLength(kept.length);
      others(after).forEach((row, i) => expect(row).toBe(kept[i]));
      return after;
    };
    const rows = step(() => store.getState().toggleTurn(KEY, seventh));
    const group = rows.find((row): row is Extract<Row, { kind: 'group' }> => row.kind === 'group' && row.turnId === seventh)!;
    expect(group).toBeDefined();
    step(() => store.getState().toggleGroup(KEY, group.id));
    step(() => store.getState().toggleCell(KEY, group.cells[0].id));
    step(() => store.getState().toggleTurn(KEY, seventh));
  });

  it('keeps a finishing turn expanded when the reader is not following, and collapses it when following', async () => {
    for (const following of [true, false]) {
      const b = builder();
      b.turn('u1');
      b.toolUse('t1', 'Bash', { command: 'ls' }, 'm1', 0);
      b.result('t1', 'a', { structured: BASH_RESULT('a') });
      const store = createTranscriptStore();
      const fake = pushSource(b.events);
      await store.getState().attach(KEY, fake.source);
      expect(kinds(store.getState().rows(KEY))).toContain('group'); // an open turn is expanded; its active group never unwraps
      store.getState().setFollowing(KEY, following);
      b.text('m2', 0, 'Done');
      b.end(['u1']);
      fake.push(b.events.slice(-2));
      expect(kinds(store.getState().rows(KEY)).includes('cell'), `following: ${following}`).toBe(!following); // the completed single-cell group unwrapped
    }
  });

  it('jumpTo expands the turn and group holding a cell and records the request for the view', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(b.events).source);
    const target = cellId.tool(tool('t2'));
    store.getState().jumpTo(KEY, target);
    const { rows, jump } = store.getState().entries[KEY];
    const group = rows.find((row) => row.kind === 'group');
    expect(group?.kind === 'group' && group.expanded && group.cells.some((cell) => cell.id === target)).toBe(true);
    expect(jump).toMatchObject({ rowId: group!.id, focus: target, align: 'center' });
    store.getState().jumpHandled(KEY, jump!.nonce);
    expect(store.getState().entries[KEY].jump).toBeNull();
  });

  // UX wave U3 (O-12): a message from another session folds with its turn now, so a jump to it opens that turn
  it('jumpTo a message line inside a folded turn opens the turn and lands on the line', async () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
    const message = b.emit('peer.message', { messageUuid: uuid('p1'), from: 'uds:/tmp/socks/9.sock', fromSession: null, fromName: 'docs', fromMode: null, fromPlugin: null, hopChain: [], text: 'the index is stale', midTurn: false, lineage: 'peer', replyable: true });
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'a', { structured: BASH_RESULT('a') });
    b.end([], { origin: 'peer' });
    b.turn('u2');
    b.text('m2', 0, 'Done');
    b.end(['u2']);
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(b.events).source);
    const target = rowId.agentMessage(message.id);
    expect(store.getState().rows(KEY).some((row) => row.id === target)).toBe(false);
    store.getState().jumpTo(KEY, target);
    expect(store.getState().rows(KEY).some((row) => row.id === target)).toBe(true);
    expect(store.getState().entries[KEY].jump).toMatchObject({ rowId: target });
    expect(store.getState().entries[KEY].state.ui.revealed).toBe(target); // UX wave U3 (M5): the jump's target is revealed
  });

  // UX wave U3 (the U3a document, M5; Interfaces F): so is a task's end with no outcome, which folds with its turn
  it('jumpTo a notice inside a folded turn opens the turn, lands on the line and reveals it', async () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'a', { structured: BASH_RESULT('a') });
    b.emit('user.message', { messageUuid: uuid('n1'), content: '<task-notification>…</task-notification>', isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [{ class: 'task', taskId: 'bm1', toolUseId: null, runId: null, outcome: null, summary: 'Monitor "watch logs" event: a line arrived', durationMs: null, outputFile: null, detail: null }] });
    b.end([], { origin: 'engine' });
    b.turn('u2');
    b.end(['u2']);
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(b.events).source);
    const target = rowId.notice(null, uuid('n1'), 0);
    expect(store.getState().rows(KEY).some((row) => row.id === target)).toBe(false);
    store.getState().jumpTo(KEY, target);
    expect(store.getState().rows(KEY).some((row) => row.id === target)).toBe(true);
    expect(store.getState().entries[KEY].jump).toMatchObject({ rowId: target });
    expect(store.getState().entries[KEY].state.ui.revealed).toBe(target);
  });

  // UX wave U3 (the U3a document, M5; Interfaces F): a mod may draw a fold MAWS cannot open, so the target of the tab's
  // last jump asks no site and MAWS draws it; each jump replaces it, and only the turns of the old and the new target
  // derive again
  it('every jump path records its target as the tab’s revealed row, and the next jump replaces it', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(twoTurns().events).source);
    const ui = () => store.getState().entries[KEY].state.ui;
    const [first, second] = [turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))];
    expect(ui().revealed).toBeUndefined();
    const stamps = () => [ui().stamps.get(first) ?? 0, ui().stamps.get(second) ?? 0];

    const cell = cellId.tool(tool('t2'));
    store.getState().jumpTo(KEY, cell); // the cell jump: a cell in a group of the first turn
    expect(ui().revealed).toBe(cell);
    const afterCell = stamps();

    expect(store.getState().jumpToMessage(KEY, { messageUuid: uuid('m3-u0'), blockIndex: 0 })).toBe(true); // the second turn's answer
    expect(ui().revealed).toBe(rowId.text(api('m3'), 0));
    expect(stamps()).toEqual([afterCell[0] + 1, afterCell[1] + 1]); // the old target's turn and the new one's
    const global = ui().global;

    const user = rowId.user(uuid('u2'));
    store.getState().jumpTo(KEY, user);
    expect(ui().revealed).toBe(user);
    expect(stamps()).toEqual([afterCell[0] + 1, afterCell[1] + 2]); // both targets in the second turn: it alone derives again, once
    expect(ui().global).toBe(global);

    store.getState().expandAll(KEY); // any other change of the reader's keeps it
    expect(ui().revealed).toBe(user);
  });

  it('jumpTo with the owning turn named locates the cell in that turn alone, and falls back when the hint misses', async () => {
    for (const hint of [turnId.ofMessage(uuid('u1')), turnId.ofMessage(uuid('u2'))]) {
      const store = createTranscriptStore();
      await store.getState().attach(KEY, pushSource(twoTurns().events).source);
      const target = cellId.tool(tool('t1'));
      store.getState().jumpTo(KEY, target, { turnId: hint });
      const { rows, jump } = store.getState().entries[KEY];
      const group = rows.find((row) => row.kind === 'group');
      expect(group?.kind === 'group' && group.expanded && group.cells.some((cell) => cell.id === target), `hint ${hint}`).toBe(true);
      expect(jump).toMatchObject({ rowId: group!.id, focus: target });
    }
  });

  // UX wave U3 (the U3a document, M5; Interfaces F): it reveals the row too, so the target's turn derives again; nothing
  // opens and no other turn's rows change
  it('jumpTo a visible row records the request and reveals the row, opening nothing', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(b.events).source);
    const before = store.getState().rows(KEY);
    const user = rowId.user(uuid('u2'));
    store.getState().jumpTo(KEY, user, { align: 'start' });
    const after = store.getState().rows(KEY);
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    const second = turnId.ofMessage(uuid('u2'));
    for (const [i, row] of after.entries()) if (row.turnId !== second) expect(row, row.id).toBe(before[i]);
    expect(store.getState().entries[KEY].jump).toMatchObject({ rowId: user, focus: user, align: 'start' });
    expect(store.getState().entries[KEY].state.ui.revealed).toBe(user);
  });

  it('expandAll opens every turn and group', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(twoTurns().events).source);
    store.getState().expandAll(KEY);
    const group = store.getState().rows(KEY).find((row) => row.kind === 'group');
    expect(group?.kind === 'group' && group.expanded).toBe(true);
    expect(group?.kind === 'group' && group.cells.some((cell) => cell.expanded)).toBe(false);
  });

  it('expandAll with cells also opens every cell, standalone or in a group', async () => {
    const b = twoTurns();
    b.turn('u3');
    b.toolUse('t9', 'Bash', { command: 'date' }, 'm9', 0);
    b.result('t9', 'now', { structured: BASH_RESULT('now') });
    b.end(['u3']);
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(b.events).source);
    store.getState().expandAll(KEY, { cells: true });
    const cells = store.getState().rows(KEY).flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
    expect(cells.map((cell) => [cell.id, cell.expanded])).toEqual([
      [cellId.tool(tool('t1')), true],
      [cellId.tool(tool('t2')), true],
      [cellId.tool(tool('t9')), true],
    ]);
  });

  it('exposes the live buffer of a streaming block without re-deriving rows on later deltas', async () => {
    const b = builder();
    b.turn('u1');
    const delta = (text: string) =>
      b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'text', textDelta: text, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    delta('Hel');
    const store = createTranscriptStore();
    const fake = pushSource(b.events);
    await store.getState().attach(KEY, fake.source);
    const rows = store.getState().rows(KEY);
    const text = rows.find((row) => row.kind === 'assistant_text')!;
    expect(text.id).toBe(rowId.text(api('m1'), 0));
    fake.push([delta('lo')]);
    expect(store.getState().rows(KEY)).toBe(rows);
    expect(liveBuffer(store.getState().entries[KEY], text)).toBe('Hello');
    expect(store.getState().lastAssistantLine(KEY)).toBe('Hello');
    expect(store.getState().entries[KEY].working).toBe(true);
  });

  it('a snapshot that fails leaves the key failed and unsubscribed, and a later attach hydrates it', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    let listener: ((events: SessionEvent[]) => void) | null = null;
    const failing: TranscriptSource = {
      subscribe(l) {
        listener = l;
        return () => (listener = null);
      },
      snapshot: () => Promise.reject(new Error('session.events failed')),
    };
    const attached = store.getState().attach(KEY, failing);
    const push = listener as ((events: SessionEvent[]) => void) | null;
    push?.(b.events.slice(0, 2)); // buffered while hydrating
    await attached;
    const failed = store.getState().entries[KEY];
    expect(failed.phase).toBe('failed');
    expect(failed.error).toContain('session.events failed');
    expect(listener).toBeNull(); // nothing buffers forever
    expect(store.getState().rows(KEY).filter((row) => row.kind === 'user')).toHaveLength(0);

    await store.getState().attach(KEY, pushSource(b.events).source);
    expect(store.getState().entries[KEY]).toMatchObject({ phase: 'live', error: null });
    expect(store.getState().rows(KEY).filter((row) => row.kind === 'user')).toHaveLength(2);
  });

  // Whole-branch review: a key started over keeps showing its old rows for the whole snapshot round trip (a tab switch
  // back is not an empty transcript), installs the new history once it has applied, and keeps the old rows if the
  // snapshot fails.
  it('a restarted key keeps its old rows until the fresh snapshot has applied, and keeps them if it fails', async () => {
    const store = createTranscriptStore();
    const first = twoTurns().events;
    await store.getState().attach(KEY, pushSource(first).source);
    store.getState().detach(KEY);
    const old = store.getState().rows(KEY);
    expect(old.length).toBeGreaterThan(0);

    const renamed = first.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }));
    let resolve: (events: SessionEvent[]) => void = () => {};
    let listener: ((events: SessionEvent[]) => void) | null = null;
    const deferred: TranscriptSource = {
      subscribe(l) {
        listener = l;
        return () => (listener = null);
      },
      snapshot: () => new Promise((r) => (resolve = r)),
    };
    const attached = store.getState().attach(KEY, deferred);
    expect(store.getState().rows(KEY)).toBe(old);
    expect(store.getState().entries[KEY].phase).toBe('hydrating');
    const later = builder('2026-09-28T12:00:00.000Z');
    later.turn('u9');
    later.text('m9', 0, 'Arrived while hydrating');
    later.end(['u9']);
    const push = listener as ((events: SessionEvent[]) => void) | null;
    push?.(later.events.map((event) => ({ ...event, id: `late:${event.id}` as EventId }))); // buffered
    expect(store.getState().rows(KEY)).toBe(old);
    resolve(renamed);
    await attached;
    const entry = store.getState().entries[KEY];
    expect(entry.phase).toBe('live');
    expect([...entry.state.seen]).toEqual([...renamed.map((event) => event.id), ...later.events.map((event) => `late:${event.id}`)]);
    expect(entry.state.order).toHaveLength(3);
    expect(store.getState().rows(KEY)).not.toBe(old);
    store.getState().detach(KEY);

    const shown = store.getState().rows(KEY);
    const failing: TranscriptSource = { subscribe: () => () => {}, snapshot: () => Promise.reject(new Error('session.events failed')) };
    await store.getState().attach(KEY, failing);
    expect(store.getState().entries[KEY]).toMatchObject({ phase: 'failed' });
    expect(store.getState().rows(KEY)).toBe(shown);
  });

  // Whole-branch review round 3: C5 remounting a kept session to show an attention item's row asks for the jump during
  // the staged restart; it must land once the fresh state is installed, not be dropped with the old state.
  it('a jump requested during a staged restart lands on the installed state', async () => {
    const store = createTranscriptStore();
    const events = twoTurns().events;
    await store.getState().attach(KEY, pushSource(events).source);
    store.getState().detach(KEY);
    let resolve: (events: SessionEvent[]) => void = () => {};
    const deferred: TranscriptSource = { subscribe: () => () => {}, snapshot: () => new Promise((r) => (resolve = r)) };
    const attached = store.getState().attach(KEY, deferred);
    const target = cellId.tool(tool('t2'));
    store.getState().jumpTo(KEY, target);
    expect(store.getState().entries[KEY].jump).toMatchObject({ focus: target });
    resolve(events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null })));
    await attached;
    const { rows, jump, phase } = store.getState().entries[KEY];
    expect(phase).toBe('live');
    const group = rows.find((row) => row.kind === 'group');
    expect(group?.kind === 'group' && group.expanded && group.cells.some((cell) => cell.id === target)).toBe(true);
    expect(jump).toMatchObject({ rowId: group!.id, focus: target, align: 'center' });
  });

  // L197: the host's agent lookup for a key names an agent no loaded turn launched; set before the key attaches, it
  // applies at the attach, and a key that starts over (a remount's staged restart, a source's reset) keeps it.
  it('applies a key’s agent lookup to its rows, before or after the attach, and keeps it when the key starts over', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('s1', 'SendMessage', { to: 'a912e224', message: 'hi' });
    b.end(['u1']);
    const survey = { taskId: 'a912e224' as TaskId, agentId: 'a912e224' as AgentId, toolUseId: 'ag9' as ToolUseId, name: 'Survey src', glyph: 3, kind: 'agent' as const, subagentType: 'Explore' };
    const lookup = new Map([['a912e224', survey]]);
    const sent = () => {
      store.getState().expandAll(KEY);
      return store.getState().rows(KEY).find((row): row is Extract<Row, { kind: 'agent_message' }> => row.kind === 'agent_message')?.text;
    };
    const store = createTranscriptStore();
    store.getState().setAgents(KEY, lookup);
    await store.getState().attach(KEY, pushSource(b.events).source);
    expect(sent()).toBe('Survey src: hi'); // UX wave U3 (O-12): the message line's words
    store.getState().setAgents(KEY, undefined);
    expect(sent()).toBe('@a912e224: hi');
    store.getState().setAgents(KEY, lookup);
    expect(sent()).toBe('Survey src: hi');
    store.getState().detach(KEY);
    await store.getState().attach(KEY, pushSource(b.events.map((event) => ({ ...event, id: `disk:${event.id}` as EventId, seq: null }))).source); // staged restart
    expect(store.getState().entries[KEY].state.seen.has(`disk:${b.events[0].id}` as EventId)).toBe(true);
    expect(sent()).toBe('Survey src: hi');
  });

  it('drops a duplicate event id in a live batch', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    const fake = pushSource(b.events);
    await store.getState().attach(KEY, fake.source);
    const rows = store.getState().rows(KEY);
    fake.push([{ ...b.events[0], id: b.events[0].id as EventId }]);
    expect(store.getState().rows(KEY)).toBe(rows);
  });

  // X3 consumers read the truth: changed files and a loaded spill are part of the derived rows.
  describe('reader state folded into the rows', () => {
    function edit() {
      const b = builder();
      b.turn('u1');
      b.toolUse('t1', 'Write', { file_path: '/p/a.ts', content: 'x\n' }, 'm1', 0);
      b.result('t1', 'ok', { structured: { type: 'create', filePath: '/p/a.ts', content: 'x\n', structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'] }] } });
      b.text('m2', 0, 'Done.');
      b.end(['u1']);
      return b.events;
    }
    it('keeps a completed turn’s changed files on its folded divider, without a receipt row', async () => {
      const store = createTranscriptStore();
      await store.getState().attach(KEY, pushSource(edit()).source);
      const dividerOf = () => store.getState().rows(KEY).find((row) => row.kind === 'divider');
      const files = [{ path: '/p/a.ts', change: 'create', added: 1, removed: 0, cellId: 'cell:t1' }];
      expect(dividerOf()).toMatchObject({ state: 'completed', expanded: false, files });
      expect(kinds(store.getState().rows(KEY))).not.toContain('receipt');

      store.getState().expandAll(KEY);
      expect(dividerOf()).toMatchObject({ state: 'completed', expanded: true, files });
      expect(kinds(store.getState().rows(KEY))).not.toContain('receipt');
    });

    it('a spill loads into its cell detail, and a failure is kept with the reason', async () => {
      const b = builder();
      b.turn('u1');
      b.toolUse('t1', 'Bash', { command: 'cat big.log' }, 'm1', 0);
      b.result('t1', 'head…', { structured: { ...BASH_RESULT('head…'), persistedOutputSize: 188_416 }, spillPath: '/cfg/tool-results/t1.txt' });
      b.end(['u1']);
      b.turn('u2');
      b.toolUse('t2', 'Bash', { command: 'ls' }, 'm2', 0);
      b.result('t2', 'a', { structured: BASH_RESULT('a') });
      b.end(['u2']);
      const store = createTranscriptStore();
      await store.getState().attach(KEY, pushSource(b.events).source);
      store.getState().expandAll(KEY, { cells: true });
      const spill = () => {
        const row = store.getState().rows(KEY).find((r) => r.kind === 'cell');
        return row?.kind === 'cell' && row.detail.kind === 'shell' ? row.detail.spill : null;
      };
      expect(spill()).toEqual({ path: '/cfg/tool-results/t1.txt', bytes: 188_416, state: 'not_loaded', content: null });
      const before = store.getState().rows(KEY);
      store.getState().setSpill(KEY, '/cfg/tool-results/t1.txt', { state: 'loading' });
      expect(spill()).toMatchObject({ state: 'loading', content: null });
      // Only the spilled cell's row is rebuilt; the other turn's cell keeps its reference.
      expect(store.getState().rows(KEY).filter((row, i) => row !== before[i] && row.kind !== 'time').map((row) => row.id)).toEqual(['cell:t1']);
      store.getState().setSpill(KEY, '/cfg/tool-results/t1.txt', { state: 'loaded', content: 'the whole log' });
      expect(spill()).toMatchObject({ state: 'loaded', content: 'the whole log' });
      store.getState().setSpill(KEY, '/cfg/tool-results/t1.txt', { state: 'failed', content: null, error: 'path outside the engine store' });
      expect(spill()).toMatchObject({ state: 'failed', content: null });
      expect(store.getState().entries[KEY].state.ui.spills.get('/cfg/tool-results/t1.txt')?.error).toBe('path outside the engine store');
    });
  });
});

// P2-C start (2026-10-09): the owner channel's lane and the view (the P2-C document, §7); UX wave U2b (the execution
// document, Interfaces §C): the flag, the open stretches and the jump into a closed record
describe('transcript store: the to-human view', () => {
  function markedTurn() {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Checking. <essential>Mind the migration.</essential>');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m2', 0, 'Unmarked answer.');
    b.end(['u1']);
    return b;
  }
  // A closed turn of work with no message, and a second one still running.
  function plainTurns() {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m1', 0, 'Unmarked answer.');
    b.end(['u1']);
    b.turn('u2');
    b.toolUse('t2', 'Bash', { command: 'pwd' });
    b.result('t2', 'ok', { structured: BASH_RESULT('ok') });
    return b;
  }
  const T1 = turnId.ofMessage(uuid('u1'));
  const marked = rowId.text(api('m1'), 0);
  const ui = (store: ReturnType<typeof createTranscriptStore>) => store.getState().entries[KEY].state.ui;
  const turnLine = (store: ReturnType<typeof createTranscriptStore>) => store.getState().rows(KEY).find((row) => row.kind === 'divider' && row.turnId === T1);
  const delta = (b: ReturnType<typeof builder>, text: string, apiId = 'm3') =>
    b.emit('assistant.block.delta', { apiMessageId: api(apiId), blockIndex: 0, blockType: 'text', textDelta: text, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });

  it('the lane keeps a marked commentary in view, and with a message in the session no turn folds; off, it is P1’s again', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(markedTurn().events).source);
    expect(store.getState().rows(KEY).some((row) => row.id === marked)).toBe(false);
    expect(turnLine(store)).toMatchObject({ expanded: false });
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    expect(store.getState().rows(KEY).find((row) => row.id === marked)).toMatchObject({ forHuman: true });
    expect(ui(store).noTurnFold).toBe(true);
    expect(turnLine(store)).toMatchObject({ expanded: true });
    const before = ui(store);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false }); // unchanged: no new state
    expect(ui(store)).toBe(before);
    store.getState().setToHumanView(KEY, { lane: false, tailMessage: false });
    expect(store.getState().rows(KEY).some((row) => row.id === marked)).toBe(false);
    expect(ui(store).noTurnFold).toBe(false);
    expect(turnLine(store)).toMatchObject({ expanded: false });
  });

  it('the flag’s three terms: the stored events, the store’s streaming block, the rows from outside; never without the lane', async () => {
    const b = plainTurns();
    const { source, push } = pushSource(b.events);
    const store = createTranscriptStore();
    await store.getState().attach(KEY, source);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    expect(ui(store).noTurnFold).toBe(false); // no message yet: the plain transcript with the turn fold
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: true });
    expect(ui(store).noTurnFold).toBe(true);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false }); // not sticky
    expect(ui(store).noTurnFold).toBe(false);
    store.getState().setToHumanView(KEY, { lane: false, tailMessage: true });
    expect(ui(store).noTurnFold).toBe(false);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    let at = b.events.length;
    delta(b, 'Partial <mess');
    push(b.events.slice(at));
    expect(ui(store).noTurnFold).toBe(false); // a partial tag is no mark
    at = b.events.length;
    delta(b, 'age>Both done');
    push(b.events.slice(at));
    expect(ui(store).noTurnFold).toBe(true); // the store's own streaming block, read by its buffer
    at = b.events.length;
    b.end(['u2'], { terminalReason: 'aborted_streaming' });
    push(b.events.slice(at));
    expect(ui(store).noTurnFold).toBe(false); // an interrupt cut it inside its open mark: no message after all
    at = b.events.length;
    b.turn('u3');
    b.text('m4', 0, '<message>Here it is.</message>');
    push(b.events.slice(at));
    expect(ui(store).noTurnFold).toBe(true); // the stored events
  });

  it('the flip derives every turn once, and no token batch after it derives any', async () => {
    const b = builder();
    for (let i = 1; i <= 4; i += 1) {
      b.turn(`u${i}`);
      b.toolUse(`t${i}`, 'Bash', { command: 'ls' });
      b.result(`t${i}`, 'ok', { structured: BASH_RESULT('ok') });
      b.text(`a${i}`, 0, 'Unmarked.');
      b.end([`u${i}`]);
    }
    b.turn('u5');
    delta(b, 'Looking at it. ', 'm5');
    const { source, push } = pushSource(b.events);
    const store = createTranscriptStore();
    await store.getState().attach(KEY, source);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    expect(ui(store).noTurnFold).toBe(false);
    const turns = store.getState().entries[KEY].state.order.length;
    let derivations = turnDerivations.count;
    let at = b.events.length;
    delta(b, '<message>Found it', 'm5'); // the first mark, in the running turn's streaming block
    push(b.events.slice(at));
    expect(ui(store).noTurnFold).toBe(true);
    expect(turnDerivations.count - derivations).toBe(turns);
    for (const piece of [' and', ' fixed', ' it.']) {
      derivations = turnDerivations.count;
      at = b.events.length;
      delta(b, piece, 'm5');
      push(b.events.slice(at));
      expect(turnDerivations.count - derivations).toBe(0);
    }
  });

  it('a lane turned on over a history that holds a message derives every turn once', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(markedTurn().events).source);
    const derivations = turnDerivations.count;
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    expect(ui(store).noTurnFold).toBe(true);
    expect(turnDerivations.count - derivations).toBe(store.getState().entries[KEY].state.order.length);
  });

  it('the view and the open stretches are the reader’s, survive another ui change, and derive no turn', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(markedTurn().events).source);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    const derivations = turnDerivations.count;
    store.getState().setView(KEY, 'transcript');
    store.getState().toggleStretch(KEY, 'toolu_x');
    store.getState().setView(KEY, 'report');
    expect(turnDerivations.count - derivations).toBe(0);
    store.getState().toggleGroup(KEY, rowId.group(cellId.tool(tool('t1'))));
    expect(ui(store)).toMatchObject({ ownerLane: true, view: 'report', openStretches: new Set(['toolu_x']) });
    store.getState().toggleStretch(KEY, 'toolu_x');
    expect(ui(store).openStretches).toEqual(new Set());
  });

  // The whole-branch review's finding 4: an open key names a row, so a stretch can hold two (two opened stretches that
  // since met, or one opened as its run stood and once more by a jump): its `‹ fold to report` folds it in one press.
  it('folding an open stretch takes every open key it holds, and leaves another stretch’s', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(markedTurn().events).source);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    const stretch = rowId.text(api('m1'), 0); // the marked commentary heads the stretch; its call is inside it
    store.getState().toggleStretch(KEY, 't1');
    store.getState().toggleStretch(KEY, 'elsewhere');
    store.getState().jumpTo(KEY, rowId.text(api('m2'), 0)); // already open by its call's key: nothing more opens
    expect(ui(store).openStretches).toEqual(new Set(['t1', 'elsewhere']));
    store.getState().toggleStretch(KEY, stretch); // a second key of the same stretch, as a press on its closed line writes one
    expect(ui(store).openStretches).toEqual(new Set(['t1', 'elsewhere', stretch]));
    store.getState().toggleStretch(KEY, stretch); // its open line carries the first open key it holds, its head's
    expect(ui(store).openStretches).toEqual(new Set(['elsewhere']));
  });

  // The whole-branch review's second look: a thought with no text keeps a row only while it streams or inside a run;
  // opened while it streams alone, the stretch keeps its opening when the run of its one call unwraps without it.
  it('a stretch opened by a thought with no text stays open once the run of its one call unwraps without the thought', async () => {
    const b = builder();
    b.turn('u0');
    b.text('m0', 0, '<message>Ready.</message>');
    b.end(['u0']);
    b.turn('u1');
    b.emit('assistant.block.delta', { apiMessageId: api('m2'), blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: '', inputJsonDelta: null, userMessageUuid: null });
    const { source, push } = pushSource(b.events);
    const store = createTranscriptStore();
    await store.getState().attach(KEY, source);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    const rows = () => store.getState().entries[KEY].rows;
    const thought = rows().find((row) => row.kind === 'thinking')!;
    store.getState().toggleStretch(KEY, thought.id); // the press on its record line writes the thought's id
    const openLine = () => mirrorRows(rows(), ui(store)).filter((row) => row.kind === 'record_fold').at(-1);
    expect(openLine()).toMatchObject({ open: true });
    let at = b.events.length;
    b.thinking('m2', 0, '');
    b.toolUse('t1', 'Bash', { command: 'ls' }, 'm2', 1);
    push(b.events.slice(at));
    expect(rows().some((row) => row.kind === 'group')).toBe(true);
    expect(openLine()).toMatchObject({ open: true });
    at = b.events.length;
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.end(['u1']);
    push(b.events.slice(at));
    expect(rows().some((row) => row.kind === 'thinking' || row.kind === 'group')).toBe(false); // unwrapped, the thought gone
    expect(openLine()).toMatchObject({ open: true });
  });

  it('a jump in the view to a row a closed record holds opens the stretch that holds it, and only there', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(markedTurn().events).source);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    const stretch = rowId.text(api('m1'), 0); // the marked commentary has words outside its mark: it heads the stretch
    store.getState().jumpTo(KEY, rowId.text(api('m2'), 0)); // the unmarked answer: folded in the view
    expect(ui(store).openStretches).toEqual(new Set([stretch]));
    expect(store.getState().entries[KEY].jump).toMatchObject({ rowId: rowId.text(api('m2'), 0) });
    expect(ui(store).revealed).toBe(rowId.text(api('m2'), 0)); // still the tab's revealed row
    store.getState().toggleStretch(KEY, stretch);
    store.getState().jumpTo(KEY, marked); // the head is in sight: nothing opens
    expect(ui(store).openStretches).toEqual(new Set());
    store.getState().jumpTo(KEY, cellId.tool(tool('t1'))); // a call: its stretch opens
    expect(ui(store).openStretches).toEqual(new Set([stretch]));
    store.getState().toggleStretch(KEY, stretch);
    store.getState().setView(KEY, 'transcript');
    store.getState().jumpTo(KEY, cellId.tool(tool('t1'))); // the transcript chosen: nothing is the reader's to open
    expect(ui(store).openStretches).toEqual(new Set());
  });

  it('with no view in force a jump opens the turn as before', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(plainTurns().events).source);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    store.getState().jumpTo(KEY, cellId.tool(tool('t1')));
    expect(ui(store).openStretches).toEqual(new Set());
    expect(ui(store).expandedTurns.has(T1)).toBe(true);
  });

  it('jumps to an assistant text by its message uuid and block index (a mark’s anchor, M6), and says when it has none', async () => {
    const store = createTranscriptStore();
    expect(store.getState().jumpToMessage(KEY, { messageUuid: uuid('m1-u0'), blockIndex: 0 })).toBe(false); // nothing attached
    await store.getState().attach(KEY, pushSource(markedTurn().events).source);
    store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
    expect(store.getState().jumpToMessage(KEY, { messageUuid: uuid('m2-u0'), blockIndex: 0 })).toBe(true); // folded in the record: it opens
    expect(store.getState().entries[KEY].jump).toMatchObject({ rowId: rowId.text(api('m2'), 0) });
    expect(ui(store).openStretches).toEqual(new Set([marked]));
    expect(store.getState().jumpToMessage(KEY, { messageUuid: uuid('m1-u0'), blockIndex: 0 })).toBe(true);
    expect(store.getState().entries[KEY].jump).toMatchObject({ rowId: marked });
    expect(store.getState().jumpToMessage(KEY, { messageUuid: uuid('m1-u0'), blockIndex: 1 })).toBe(false);
    expect(store.getState().jumpToMessage(KEY, { messageUuid: uuid('elsewhere'), blockIndex: 0 })).toBe(false);
  });
});
// P2-C end

// P4-R7z (the P4 spec's Decision Log 92): every source's state reads the to-human plugin's message tool, the one a MAWS
// session messages through, as the desk's sources did under P4-R7x's host-set names, which the store no longer takes.
describe('transcript store: a message tool’s call', () => {
  const PLUGIN = 'mcp__to-human__message';
  function pluginMessageTurn() {
    const b = builder();
    b.turn('u1');
    b.toolUse('m1', PLUGIN, { text: 'Stage 1 is done.' });
    b.result('m1', [{ type: 'text', text: 'sent' }]);
    b.text('a1', 0, 'Done.');
    b.end(['u1']);
    return b;
  }
  const source = (events: SessionEvent[]): TranscriptSource => ({ subscribe: () => () => {}, snapshot: async () => events });

  it('is the message it sends from any source, and from a re-attached key', async () => {
    const { events } = pluginMessageTurn();
    const store = createTranscriptStore();
    const read = (key: string) => {
      store.getState().expandAll(key, { cells: true });
      return store.getState().rows(key).flatMap((row) => (row.kind === 'to_human' ? [`message ${row.toolUseId}`] : row.kind === 'group' ? row.cells.map((cell) => `cell ${cell.toolName}`) : row.kind === 'cell' ? [`cell ${row.toolName}`] : []));
    };
    await store.getState().attach('maws', source(events));
    expect(read('maws')).toEqual(['message m1']);
    store.getState().detach('maws');
    await store.getState().attach('maws', source(events)); // a kept key started over: staged, then installed
    expect(read('maws')).toEqual(['message m1']);
  });
});

// UX wave U1b (Interfaces §B, rule 2; decision 2): the store is told which calls hold a waiting form, and the rows a
// transcript has of those calls today (read from its file; a request a bridge raised, whose row is never withheld) carry
// the mark; nothing else decides it, and every other turn keeps its rows.
describe('transcript store: the calls that hold a waiting form', () => {
  const QUESTIONS = [{ question: 'Which file?', header: 'File', multiSelect: false, options: [{ label: 'a.ts' }, { label: 'b.ts' }] }];
  const ASYNC = 'Your questions are waiting for the human; this call does not wait for them. Their answer will reach you in a later message that quotes each question. Go on with work that does not depend on it.';
  function waitingTurns() {
    const b = builder();
    b.turn('u1');
    b.toolUse('q-async', 'mcp__sminos__AskUserQuestion', { questions: QUESTIONS, async: true });
    b.result('q-async', ASYNC);
    b.text('m1', 0, 'Asked; going on.');
    b.end(['u1']);
    b.turn('u2');
    b.toolUse('q-raised', 'AskUserQuestion', { questions: QUESTIONS }); // a terminal's blocking question: no result yet
    b.toolUse('plan-1', 'ExitPlanMode', { plan: '1. Read the notes.' });
    b.toolUse('ask-1', 'mcp__maws__ask', { title: 'Setup', questions: [{ id: 'q1', question: 'Which colour?', modality: 'choice', options: [{ label: 'Red' }] }] });
    b.turn('u3');
    b.toolUse('t1', 'Bash', { command: 'ls' }, 'm3', 0);
    b.result('t1', 'a', { structured: BASH_RESULT('a') });
    return b;
  }
  const marked = (rows: Row[]) => rows.flatMap((row) => ((row.kind === 'question' || row.kind === 'plan' || row.kind === 'ask') && row.waiting === true ? [`${row.kind}:${row.toolUseId}`] : []));
  const calls = (...ids: string[]) => new Set(ids.map((id) => tool(id)));

  it('marks exactly the rows of those calls, file-read and bridge-raised alike, and leaves the other turns’ rows by reference', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(waitingTurns().events).source);
    store.getState().expandAll(KEY);
    const before = store.getState().rows(KEY);
    expect(marked(before)).toEqual([]);
    store.getState().setWaitingForms(KEY, calls('q-async', 'q-raised', 'plan-1', 'ask-1'));
    const after = store.getState().rows(KEY);
    expect(marked(after)).toEqual(['question:q-async', 'question:q-raised', 'plan:plan-1', 'ask:ask-1']);
    const third = (rows: Row[]) => rows.filter((row) => row.turnId === turnId.ofMessage(uuid('u3')));
    expect(third(after).length).toBeGreaterThan(0);
    third(after).forEach((row, i) => expect(row).toBe(third(before)[i]));
    // a row whose request left the set loses the mark
    const first = (rows: Row[]) => rows.filter((row) => row.turnId === turnId.ofMessage(uuid('u1')));
    const firstBefore = first(after);
    store.getState().setWaitingForms(KEY, calls('q-raised', 'plan-1', 'ask-1'));
    expect(marked(store.getState().rows(KEY))).toEqual(['question:q-raised', 'plan:plan-1', 'ask:ask-1']);
    expect(first(store.getState().rows(KEY))).not.toEqual(firstBefore);
  });

  it('an equal set changes nothing; the row carries no mark of its own (no field at all while nothing waits)', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(waitingTurns().events).source);
    store.getState().setWaitingForms(KEY, calls('q-raised'));
    const entry = store.getState().entries[KEY];
    store.getState().setWaitingForms(KEY, calls('q-raised'));
    expect(store.getState().entries[KEY]).toBe(entry);
    store.getState().setWaitingForms(KEY, new Set());
    const question = store.getState().rows(KEY).find((row) => row.kind === 'question' && row.toolUseId === tool('q-raised'))!;
    expect('waiting' in question).toBe(false);
  });

  it('a waiting plan stays in view when its turn folds; one that waits for nothing folds with its work', async () => {
    const store = createTranscriptStore();
    const b = waitingTurns();
    b.end(['u3']); // u3's start closed u2
    await store.getState().attach(KEY, pushSource(b.events).source);
    const plans = () => store.getState().rows(KEY).filter((row) => row.kind === 'plan');
    expect(plans()).toEqual([]);
    store.getState().setWaitingForms(KEY, calls('plan-1'));
    expect(plans().map((row) => row.toolUseId)).toEqual(['plan-1']);
  });
  // UX wave U1b M3 (§B, rules 1 and 3; proof a): a session MAWS runs streams each request while it waits; its call's row
  // is derived all the same, and no row is made for the request itself
  function pendingTurns() {
    const b = waitingTurns();
    b.emit('question.requested', { requestId: request('r-q'), toolUseId: tool('q-raised'), questions: [{ question: 'Which file?', header: 'File', multiSelect: false, options: [{ label: 'a.ts', description: null, preview: null }] }] });
    b.emit('plan.requested', { requestId: request('r-p'), toolUseId: tool('plan-1'), plan: '1. Read the notes.', input: {} });
    b.toolUse('t2', 'Bash', { command: 'make' }, 'm4', 0);
    b.emit('permission.requested', { requestId: request('r-b'), toolUseId: tool('t2'), toolName: 'Bash', displayName: null, input: { command: 'make' }, description: null, decisionReasonType: null, suggestions: [], blockedPath: null });
    return b;
  }

  it('with each request pending, the question and plan rows are derived and carry the mark while the list names their calls; no request makes a row', async () => {
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(pendingTurns().events).source);
    store.getState().expandAll(KEY);
    const rows = () => store.getState().rows(KEY);
    expect(rows().filter((row) => row.kind === 'request_slot')).toEqual([]);
    expect(rows().filter((row) => row.kind === 'question' || row.kind === 'plan').map((row) => row.toolUseId)).toEqual(['q-async', 'q-raised', 'plan-1']);
    expect(marked(rows())).toEqual([]);
    store.getState().setWaitingForms(KEY, calls('q-raised', 'plan-1'));
    expect(marked(rows())).toEqual(['question:q-raised', 'plan:plan-1']);
    store.getState().setWaitingForms(KEY, calls('q-raised'));
    expect(marked(rows())).toEqual(['question:q-raised']);
  });

  it('a waiting plan of a pending request stays in view in a turn the reader collapsed, and in the to-human view never inside a record; one that waits for nothing folds with its turn', async () => {
    const store = createTranscriptStore();
    const b = pendingTurns();
    b.end(['u3']);
    await store.getState().attach(KEY, pushSource(b.events).source);
    const plan = () => store.getState().rows(KEY).find((row) => row.kind === 'plan');
    expect(plan()).toBeUndefined(); // its turn folded: a plan that waits for nothing goes with the turn's work
    store.getState().setWaitingForms(KEY, calls('plan-1'));
    expect(plan()?.toolUseId).toBe('plan-1');
    // the to-human view (U2b's mirror, UC-3): a plan is never inside a record, waiting or answered
    const mirrored = (rows: readonly Row[]) => mirrorRows(rows, { openStretches: new Set<string>() });
    expect(mirrored(store.getState().rows(KEY)).filter((row) => row.kind === 'plan').map((row) => row.toolUseId)).toEqual([tool('plan-1')]);
    store.getState().expandAll(KEY);
    store.getState().setWaitingForms(KEY, new Set());
    expect(mirrored(store.getState().rows(KEY)).filter((row) => row.kind === 'plan').map((row) => row.toolUseId)).toEqual([tool('plan-1')]);
  });
});

// Board ticket 852: a run of one is toggled by its run's id, which the store resolves to its row; a run whose id is the
// same (a later copy of the same call, as a replay's echo of a seeded history draws one) is resolved as itself first,
// so its own turn is derived again and it opens.
describe('a run’s toggle beside a run of one of the same call', () => {
  it('opens the run itself, not the run of one before it', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('x', 'Bash', { command: 'printf R3' }, 'm1', 0);
    b.result('x', 'R3', { structured: BASH_RESULT('R3') });
    b.end(['u1']);
    b.turn('u2');
    b.toolUse('x', 'Bash', { command: 'printf R3' }, 'm2', 0); // the same call, again, in a turn still open
    b.result('x', 'R3', { structured: BASH_RESULT('R3') });
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(b.events).source);
    const first = store.getState().entries[KEY].state.order[0];
    store.getState().toggleTurn(KEY, first);
    const run = rowId.group(cellId.tool(tool('x')));
    expect(store.getState().rows(KEY).filter((row) => row.kind === 'cell' || row.kind === 'group').map((row) => `${row.kind}:${row.id}`)).toEqual([`cell:${cellId.tool(tool('x'))}`, `group:${run}`]);
    store.getState().toggleGroup(KEY, run);
    const group = store.getState().rows(KEY).find((row) => row.kind === 'group');
    expect(group?.kind === 'group' && group.expanded).toBe(true);
  });

  // The fix wave of 2026-11-24 (finding 2): the run of one's own toggle, by the id its line presses, opens it, in its own
  // turn, and leaves the later run of the same call as it was; the engine's site keeps the run's id.
  it('opens the run of one itself, by the id its line presses, not the later run of the same call', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('x', 'Bash', { command: 'printf R3' }, 'm1', 0);
    b.result('x', 'R3', { structured: BASH_RESULT('R3') });
    b.end(['u1']);
    b.turn('u2');
    b.toolUse('x', 'Bash', { command: 'printf R3' }, 'm2', 0);
    b.result('x', 'R3', { structured: BASH_RESULT('R3') });
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(b.events).source);
    store.getState().toggleTurn(KEY, store.getState().entries[KEY].state.order[0]);
    const lone = () => store.getState().rows(KEY).find((row): row is Extract<Row, { kind: 'cell' }> => row.kind === 'cell')!;
    store.getState().toggleGroup(KEY, runOfOneId(lone()));
    const group = store.getState().rows(KEY).find((row) => row.kind === 'group');
    expect([lone().runExpanded, group?.kind === 'group' && group.expanded]).toEqual([true, false]);
    expect(runOfOneId(lone())).not.toBe(rowId.group(cellId.tool(tool('x')))); // a key of its turn's, not the run's site id
  });
});
