import type { SessionEvent } from '@shared/graph/events';
import type { EventId } from '@shared/graph/ids';
import { describe, expect, it } from 'vitest';
import { cellId, rowId, turnId } from '../transcript/model/keys';
import type { Row } from '../transcript/model/rows';
import { api, BASH_RESULT, builder, tool, uuid } from '../transcript/model/test-events';
import type { TranscriptSource } from '../transcript/source/types';
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

  it('drops a duplicate event id in a live batch', async () => {
    const b = twoTurns();
    const store = createTranscriptStore();
    const fake = pushSource(b.events);
    await store.getState().attach(KEY, fake.source);
    const rows = store.getState().rows(KEY);
    fake.push([{ ...b.events[0], id: b.events[0].id as EventId }]);
    expect(store.getState().rows(KEY)).toBe(rows);
  });
});
