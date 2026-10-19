// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's Decision Logs 13 (4) and 23): the
// design's projection of C's per-board history. C diffs by ids, so a cross-board move (a new, derived id at the
// destination) reads as a removal and an addition; the design pairs them through the persisted `moveOrigin` read on both
// the earlier and the shown element, scanning whole boards added or removed too, and shows one move credited to its
// author: through collision-fallback ids, several hops, a retained version's bytes, a moved subtree (its descendants
// grouped under it, a change of their own still counted), a round trip home, and beside unrelated changes. The pill's
// count through C's `countChanges` hook is editor/history.dom.test.tsx's (C's controller is the editor's).
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { deckChanges, elementHistory, openDeckDiff } from '../slides/history';
import { setNotes, setStyle, setText, zOrder } from '../slides/model';
import { applyV1, applyV2, attributionMap, contentIdsOf, mergeMaps, newDoc, onUpdate, stateV2, transact, type ContentMap, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { designChanges, designStops, type DesignChanges, type ElementMove } from './history';
import { moveElementToBoard } from './move';
import { deleteBoard, insertBoard, setBoardFrame } from './writers';
import { boardIR, writeBoards, type BoardSeed } from './fixtures/support';

const T0 = Date.UTC(2026, 9, 16, 9, 0);
const MIN = 60_000;
const SESSION = '00000000-0000-4000-8000-0000000000e1' as AppSessionId;
const AGENT = `session:${SESSION}`;

const A = `<h1 id="title" style="font-size:72px">Phone</h1><p id="e1" style="font-size:32px">Moved text</p><div id="card" style="position:absolute; left:20px; top:300px; width:300px; height:200px; display:flex; flex-direction:column"><p id="note" style="font-size:20px">Card note</p><p id="small" style="font-size:16px">Small print</p></div><p id="keep" style="font-size:20px">Stays</p>`;
const B = `<h1 id="title" style="font-size:72px">Desktop</h1><p id="other" style="font-size:20px">Other</p><div id="badge" style="position:absolute; left:10px; top:10px; width:50px; height:50px"></div>`;
const C = `<p id="far" style="font-size:20px">Far</p>`;
const SEEDS: BoardSeed[] = [
  { id: 'a', at: { x: 0, y: 0, w: 390, h: 844 }, body: A, title: 'Phone' },
  { id: 'b', at: { x: 500, y: 0, w: 1440, h: 1024 }, body: B, title: 'Desktop' },
  { id: 'c', at: { x: 2000, y: 0, w: 1080, h: 1920 }, body: C, title: 'Poster' },
];

/** A design host and its log: one provenance map per landed update, by actor, a minute apart (A's store's shape). */
function world(seeds: BoardSeed[] = SEEDS) {
  const host = newDoc();
  const maps: ContentMap[] = [];
  let at = T0;
  const land = (actor: string, edit: (doc: Doc) => void, { sameMinute = false }: { sameMinute?: boolean } = {}) => {
    const doc = newDoc();
    applyV2(doc, stateV2(host));
    const updates: Uint8Array[] = [];
    const off = onUpdate(doc, (u) => updates.push(u));
    edit(doc);
    off();
    doc.destroy();
    for (const u of updates) {
      applyV1(host, u);
      if (!sameMinute) at += MIN; // the store floors provenance to the minute
      maps.push(attributionMap(contentIdsOf(u), { insertActor: actor, deleteActor: actor, at }));
    }
  };
  land('human', (doc) => transact(doc, () => writeBoards(doc, seeds)));
  const mark = () => ({ seq: maps.length, state: stateV2(host) });
  /** The projection of `from` → `to` (now), the states read back from their bytes as a retained version's are. */
  const project = (from: ReturnType<typeof mark> | null, to = mark()) => {
    const diff = openDeckDiff({ prevState: from?.state ?? null, nextState: to.state, attributions: mergeMaps(maps.slice(from?.seq ?? 0, to.seq)) });
    try {
      const changes = deckChanges(diff);
      return { c: changes, d: designChanges(diff, changes, (earlier, shown) => elementHistory(diff, earlier, shown)) };
    } finally {
      diff.destroy();
    }
  };
  return { host, land, mark, project, maps, at: () => at };
}

const boardOf = (d: DesignChanges, id: string) => d.boards.find((b) => b.id === id);
const movesOn = (d: DesignChanges, id: string) => (boardOf(d, id)?.elements ?? []).filter((e): e is ElementMove => e.kind === 'moved');
const kinds = (d: DesignChanges, id: string) => (boardOf(d, id)?.elements ?? []).map((e) => [e.kind, e.id]);

describe('who a move and the edits since it are credited to (C’s element history, the P3-E spec’s Decision Log 30)', () => {
  it('credits a move into a board made in the window to its mover, not to the board’s creator', () => {
    const w = world();
    const v = w.mark();
    w.land('human', (doc) => insertBoard(doc, { id: 'n', frame: { x: 0, y: 1000, w: 390, h: 844 }, slide: boardIR('n', '<p id="fresh">Fresh</p>') }, 'c'));
    let moved = '';
    w.land(AGENT, (doc) => (moved = moveElementToBoard(doc, 'a', 'n', 'e1').ids.get('e1')!));
    const { d } = w.project(v);
    expect(boardOf(d, 'n')).toMatchObject({ kind: 'added', by: 'human' });
    expect(movesOn(d, 'n')).toEqual([expect.objectContaining({ id: moved, by: AGENT, at: T0 + 3 * MIN, keys: [] })]);
  });

  it('credits an edit made after the move to its author, in a later minute or the same one', () => {
    for (const sameMinute of [false, true]) {
      const w = world();
      const v = w.mark();
      let moved = '';
      w.land(AGENT, (doc) => (moved = moveElementToBoard(doc, 'a', 'b', 'e1').ids.get('e1')!));
      w.land('human', (doc) => setStyle(doc, 'b', moved, { color: '#ff0000' }), { sameMinute });
      const [move] = movesOn(w.project(v).d, 'b');
      expect(move, `same minute: ${sameMinute}`).toMatchObject({ by: AGENT });
      expect(move!.keys.find((k) => k.key === 'style:color'), `same minute: ${sameMinute}`).toMatchObject({ by: 'human' });
    }
  });

  it('keeps every real difference in the moved element’s stacking, a restack since by anyone in any minute included, and counts the move once', () => {
    const restack = (actor: string, sameMinute: boolean) => {
      const w = world();
      const v = w.mark();
      let moved = '';
      w.land(AGENT, (doc) => (moved = moveElementToBoard(doc, 'a', 'b', 'card').ids.get('card')!));
      w.land(actor, (doc) => zOrder(doc, 'b', moved, 'back'), { sameMinute });
      return movesOn(w.project(v).d, 'b')[0]!.keys.filter((k) => k.key === 'z');
    };
    expect(restack('human', false)).toEqual([expect.objectContaining({ key: 'z', by: 'human' })]);
    expect(restack('human', true)).toEqual([expect.objectContaining({ key: 'z', by: 'human' })]);
    expect(restack(AGENT, false)).toEqual([expect.objectContaining({ key: 'z', by: AGENT })]);
    expect(restack(AGENT, true)).toEqual([expect.objectContaining({ key: 'z', by: AGENT })]); // the mover's own restack, same minute: kept, not inferred away
    const w = world();
    const v = w.mark();
    w.land(AGENT, (doc) => moveElementToBoard(doc, 'a', 'b', 'card'));
    const plainMove = w.project(v).d;
    // a plain move: its new place in the destination's stack is a real difference, shown as the mover's; no parent noise
    expect(movesOn(plainMove, 'b')[0]!.keys).toEqual([expect.objectContaining({ key: 'z', by: AGENT })]);
    expect(plainMove.count).toBe(1);
  });
});

describe('the design’s history projection', () => {
  it('shows a cross-board move as one move from where it was, by its author, where C reads a removal and an addition', () => {
    const w = world();
    const v = w.mark();
    let moved = '';
    w.land(AGENT, (doc) => (moved = moveElementToBoard(doc, 'a', 'b', 'e1').ids.get('e1')!));
    const { c, d } = w.project(v);
    expect(c.count).toBe(2);
    expect(d.count).toBe(1);
    expect(movesOn(d, 'b')).toEqual([expect.objectContaining({ kind: 'moved', id: moved, from: { board: 'a', id: 'e1' }, by: AGENT, at: T0 + 2 * MIN, descendants: [] })]);
    expect(movesOn(d, 'b')[0]!.keys.every((k) => k.key === 'order' && k.by === AGENT)).toBe(true); // at most its new place in the flow, the mover's
    expect(kinds(d, 'a')).toEqual([['movedAway', 'e1']]);
    expect(boardOf(d, 'a')!.elements[0]).toMatchObject({ to: { board: 'b', id: moved } });
    expect(designStops(d)).toEqual([{ part: 'element', boardId: 'b', elementId: moved }]);
  });

  it('pairs a collision-fallback id and a move of several hops by the first origin, and a retained version spanning a hop', () => {
    const w = world();
    const v0 = w.mark();
    let first = '';
    w.land(AGENT, (doc) => (first = moveElementToBoard(doc, 'a', 'b', 'e1').ids.get('e1')!));
    const v1 = w.mark();
    // the derived id the next hop would take is already on c: C's minter names the element instead
    const scratch = newDoc();
    applyV2(scratch, stateV2(w.host));
    const squat = moveElementToBoard(scratch, 'b', 'c', first).ids.get(first)!;
    scratch.destroy();
    w.land('human', (doc) => Y.createElement(doc, 'c', squat, { tag: 'p', parent: '', order: 'a5' }, [{ type: 'p', inline: [{ text: 'Squatter', marks: {} }] }]));
    const v2 = w.mark();
    let last = '';
    w.land(AGENT, (doc) => (last = moveElementToBoard(doc, 'b', 'c', first).ids.get(first)!));
    expect(last).not.toBe(squat);

    const whole = w.project(v0).d; // a → b → c: one move from a, beside the squatter's addition
    expect(movesOn(whole, 'c')).toEqual([expect.objectContaining({ id: last, from: { board: 'a', id: 'e1' } })]);
    expect(kinds(whole, 'c')).toEqual(expect.arrayContaining([['added', squat], ['moved', last]]));
    expect(boardOf(whole, 'b')).toBeUndefined(); // in and out within the window: nothing on b
    expect(whole.count).toBe(2);
    expect(movesOn(w.project(v1).d, 'c')).toEqual([expect.objectContaining({ id: last, from: { board: 'b', id: first } })]); // from the version after the first hop
    expect(movesOn(w.project(v2).d, 'c')[0]!.from).toEqual({ board: 'b', id: first });
  });

  it('groups a moved subtree under its root, still counting a descendant’s own change, and keeps unrelated changes', () => {
    const w = world();
    const v = w.mark();
    let ids = new Map<string, string>();
    w.land(AGENT, (doc) => (ids = moveElementToBoard(doc, 'a', 'b', 'card', { at: { left: 40, top: 80 } }).ids));
    w.land('human', (doc) => setText(doc, 'b', ids.get('note')!, [{ type: 'p', inline: [{ text: 'Card note, revised', marks: {} }] }]));
    w.land('human', (doc) => setStyle(doc, 'a', 'keep', { color: '#ff0000' }));
    w.land('human', (doc) => setBoardFrame(doc, 'c', { x: 2100 }));
    const { c, d } = w.project(v);
    const [move] = movesOn(d, 'b');
    expect(move).toMatchObject({ id: ids.get('card'), from: { board: 'a', id: 'card' }, by: AGENT });
    expect(move!.descendants.sort()).toEqual([ids.get('note'), ids.get('small')].sort());
    expect(move!.keys.map((k) => k.key).sort()).toEqual(['style:left', 'style:top', 'z']); // the move's geometry and its new place in the stack
    // its text, changed after the move by someone else: credited to its author (C's leaf), not to the mover
    expect(boardOf(d, 'b')!.elements.find((e) => e.id === ids.get('note'))).toMatchObject({ kind: 'changed', by: 'human', keys: [expect.objectContaining({ key: 'text', by: 'human' })] });
    expect(kinds(d, 'a')).toEqual(expect.arrayContaining([['changed', 'keep'], ['movedAway', 'card']]));
    expect(boardOf(d, 'c')).toMatchObject({ kind: 'changed', keys: [expect.objectContaining({ key: 'x' })] });
    expect(c.count).toBe(1 + 3 + 3 + 1); // keep, three removals, three additions, c's frame
    expect(d.count).toBe(4); // keep, the move, the note's text, c's frame
  });

  it('pairs into a board added and out of a board removed in the window, by scanning their elements', () => {
    const w = world();
    const v = w.mark();
    let into = '';
    let out = '';
    w.land(AGENT, (doc) => {
      insertBoard(doc, { id: 'n', frame: { x: 0, y: 1000, w: 390, h: 844 }, slide: boardIR('n', '<p id="fresh">Fresh</p>') }, 'c');
      into = moveElementToBoard(doc, 'a', 'n', 'e1').ids.get('e1')!;
      out = moveElementToBoard(doc, 'c', 'b', 'far').ids.get('far')!;
      deleteBoard(doc, 'c');
    });
    const { c, d } = w.project(v);
    expect(boardOf(d, 'n')).toMatchObject({ kind: 'added' });
    expect(movesOn(d, 'n')).toEqual([expect.objectContaining({ id: into, from: { board: 'a', id: 'e1' } })]);
    expect(boardOf(d, 'c')).toMatchObject({ kind: 'removed', elements: [expect.objectContaining({ kind: 'movedAway', id: 'far', to: { board: 'b', id: out } })] });
    expect(movesOn(d, 'b')).toEqual([expect.objectContaining({ id: out, from: { board: 'c', id: 'far' } })]);
    expect(c.count).toBe(4); // n, c, a's removal, b's addition
    expect(d.count).toBe(4); // n, c, and the two moves
  });

  it('reads a round trip home by what actually differs, and nothing when nothing does', () => {
    const w = world();
    const v = w.mark();
    let home = '';
    w.land(AGENT, (doc) => {
      const there = moveElementToBoard(doc, 'a', 'b', 'e1').ids.get('e1')!;
      home = moveElementToBoard(doc, 'b', 'a', there).ids.get(there)!;
    });
    const { c, d } = w.project(v);
    expect(c.count).toBe(2);
    expect(boardOf(d, 'a')!.elements).toEqual([expect.objectContaining({ kind: 'changed', id: home, keys: [expect.objectContaining({ key: 'order', by: AGENT })] })]); // it came home last in the flow
    expect(boardOf(d, 'b')).toBeUndefined();
    expect(d.count).toBe(1);

    const still = world();
    const s = still.mark();
    still.land(AGENT, (doc) => {
      const there = moveElementToBoard(doc, 'a', 'b', 'keep').ids.get('keep')!;
      moveElementToBoard(doc, 'b', 'a', there); // keep was last in a's flow: it lands where it was, as it was
    });
    expect(still.project(s).c.count).toBe(2);
    expect(still.project(s).d).toMatchObject({ boards: [], count: 0 });
  });

  it('leaves an element present on both sides alone when an addition elsewhere claims its origin', () => {
    const w = world();
    let moved = '';
    w.land(AGENT, (doc) => (moved = moveElementToBoard(doc, 'a', 'b', 'e1').ids.get('e1')!));
    const v = w.mark();
    // the agent republishes a with e1 back (its stale file), then moves it again: one addition per origin is ambiguous
    w.land(AGENT, (doc) => Y.createElement(doc, 'a', 'e1', { tag: 'p', parent: '', order: 'a0' }, [{ type: 'p', inline: [{ text: 'Back', marks: {} }] }]));
    const { d } = w.project(v);
    expect(kinds(d, 'a')).toEqual([['added', 'e1']]);
    expect(boardOf(d, 'b')).toBeUndefined();
    expect(moved).not.toBe('e1');
  });

  it('stops ↑ ↓ at each run of a board’s (hidden) notes after its own change and its elements, as C’s deck does, one stop per change counted (L240)', () => {
    const w = world(SEEDS.map((s) => (s.id === 'c' ? { ...s, notes: 'notes for the poster' } : s)));
    const v = w.mark();
    w.land('human', (doc) => setBoardFrame(doc, 'c', { x: 2100 }));
    w.land(AGENT, (doc) => setNotes(doc, 'c', 'first, notes for the poster'));
    w.land('human', (doc) => setNotes(doc, 'c', 'first, notes for the poster, last')); // apart from the first: a run of its own
    const framed = w.project(v).d;
    expect(boardOf(framed, 'c')).toMatchObject({ kind: 'changed', keys: [expect.objectContaining({ key: 'x' })], elements: [], notes: 2 });
    expect(framed.count).toBe(3); // the frame, two notes runs
    expect(designStops(framed)).toEqual([
      { part: 'board', boardId: 'c' },
      { part: 'notes', boardId: 'c', run: 0 },
      { part: 'notes', boardId: 'c', run: 1 },
    ]);
    w.land('human', (doc) => setStyle(doc, 'c', 'far', { color: '#ff0000' }));
    const { d } = w.project(v);
    expect(d.count).toBe(4); // and the element
    expect(designStops(d)).toEqual([
      { part: 'board', boardId: 'c' },
      { part: 'element', boardId: 'c', elementId: 'far' },
      { part: 'notes', boardId: 'c', run: 0 },
      { part: 'notes', boardId: 'c', run: 1 },
    ]);
  });
});
