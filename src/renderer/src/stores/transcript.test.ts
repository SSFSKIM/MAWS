import type { SessionEvent } from '@shared/graph/events';
import type { EventId } from '@shared/graph/ids';
import { describe, expect, it } from 'vitest';
import { cellId, rowId, turnId } from '../transcript/model/keys';
import type { Row } from '../transcript/model/rows';
import { api, BASH_RESULT, builder, tool, uuid } from '../transcript/model/test-events';
import type { TranscriptSource } from '../transcript/source/types';
import { synthesise } from '../../../../test/support/synth-transcript';
import { turnDerivations } from '../transcript/model/derive';
import { createTranscriptStore, liveBuffer } from './transcript';

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

  it('jumpTo a visible row only records the request', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    await store.getState().attach(KEY, pushSource(b.events).source);
    const before = store.getState().rows(KEY);
    const user = rowId.user(uuid('u2'));
    store.getState().jumpTo(KEY, user, { align: 'start' });
    expect(store.getState().rows(KEY)).toBe(before);
    expect(store.getState().entries[KEY].jump).toMatchObject({ rowId: user, focus: user, align: 'start' });
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

  it('drops a duplicate event id in a live batch', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    const fake = pushSource(b.events);
    await store.getState().attach(KEY, fake.source);
    const rows = store.getState().rows(KEY);
    fake.push([{ ...b.events[0], id: b.events[0].id as EventId }]);
    expect(store.getState().rows(KEY)).toBe(rows);
  });

  // X3 consumers read the truth: the receipt's undo state and a loaded spill are part of the derived rows.
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
    const receiptOf = (rows: Row[]) => rows.find((row): row is Extract<Row, { kind: 'receipt' }> => row.kind === 'receipt')!;

    it('a receipt reads applied and not undoable until the dry run answers, then follows undo and reapply', async () => {
      const store = createTranscriptStore();
      await store.getState().attach(KEY, pushSource(edit()).source);
      const id = receiptOf(store.getState().rows(KEY)).id;
      expect(receiptOf(store.getState().rows(KEY))).toMatchObject({ state: 'applied', canUndo: false, canReapply: false });

      const before = store.getState().rows(KEY);
      const uiVersion = store.getState().entries[KEY].state.ui.version;
      store.getState().setReceipt(KEY, id, { check: { ok: true, reason: null }, reapply: true });
      expect(receiptOf(store.getState().rows(KEY))).toMatchObject({ state: 'applied', canUndo: true, canReapply: false });
      // Laid over the derived rows: no re-derivation (the ui version stays), every other turn row keeps its reference
      // (time separators are rebuilt with the flat list, as on any change).
      expect(store.getState().entries[KEY].state.ui.version).toBe(uiVersion);
      expect(store.getState().rows(KEY).filter((row, i) => row !== before[i] && row.kind !== 'time').map((row) => row.kind)).toEqual(['receipt']);
      store.getState().setReceipt(KEY, id, { state: 'undoing' });
      expect(receiptOf(store.getState().rows(KEY))).toMatchObject({ state: 'undoing', canUndo: false, canReapply: false });
      store.getState().setReceipt(KEY, id, { state: 'undone' });
      expect(receiptOf(store.getState().rows(KEY))).toMatchObject({ state: 'undone', canUndo: false, canReapply: true });

      store.getState().setReceipt(KEY, id, { state: 'applied', check: { ok: false, reason: 'no checkpoint' }, reapply: false });
      expect(receiptOf(store.getState().rows(KEY))).toMatchObject({ state: 'applied', canUndo: false, canReapply: false });
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
