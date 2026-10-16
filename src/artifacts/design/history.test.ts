// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's Decision Logs 13 (4) and 23): the
// design's projection of C's per-board history. C diffs by ids, so a cross-board move (a new, derived id at the
// destination) reads as a removal and an addition; the design pairs them through the persisted `moveOrigin` read on both
// the earlier and the shown element, scanning whole boards added or removed too, and shows one move credited to its
// author: through collision-fallback ids, several hops, a retained version's bytes, a moved subtree (its descendants
// grouped under it, a change of their own still counted), a round trip home, and beside unrelated changes. The new-change
// pill counts the same projection through C's optional `countChanges` hook; a deck's count is C's.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import type { HistoryApi } from '../document/editor/history/api';
import { publishFiles } from '../files';
import { deckChanges, openDeckDiff } from '../slides/history';
import { setStyle, setText } from '../slides/model';
import { DeckHistoryController } from '../slides/editor/history/controller';
import { applyV1, applyV2, attributionMap, contentIdsOf, encodeMap, mergeMaps, newDoc, onUpdate, stateV2, transact, type ContentMap, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { CANVAS_PATH } from './canvas';
import { countDesignChanges, designChanges, designStops, type DesignChanges, type ElementMove } from './history';
import { designHistoryApi } from './history-api';
import { isLegacyDesign } from './migrate';
import { designFiles } from './model';
import { moveElementToBoard } from './move';
import { deleteBoard, insertBoard, setBoardFrame } from './writers';
import { boardIR, writeBoards, type BoardSeed } from './fixtures/support';

const T0 = Date.UTC(2026, 9, 16, 9, 0);
const MIN = 60_000;
const SESSION = '00000000-0000-4000-8000-0000000000e1' as AppSessionId;
const AGENT = `session:${SESSION}`;

const A = `<h1 id="title" style="font-size:72px">Phone</h1><p id="e1" style="font-size:32px">Moved text</p><div id="card" style="position:absolute; left:20px; top:300px; width:300px; height:200px; display:flex; flex-direction:column"><p id="note" style="font-size:20px">Card note</p><p id="small" style="font-size:16px">Small print</p></div><p id="keep" style="font-size:20px">Stays</p>`;
const B = `<h1 id="title" style="font-size:72px">Desktop</h1><p id="other" style="font-size:20px">Other</p>`;
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
  const land = (actor: string, edit: (doc: Doc) => void) => {
    const doc = newDoc();
    applyV2(doc, stateV2(host));
    const updates: Uint8Array[] = [];
    const off = onUpdate(doc, (u) => updates.push(u));
    edit(doc);
    off();
    doc.destroy();
    for (const u of updates) {
      applyV1(host, u);
      at += MIN;
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
      return { c: changes, d: designChanges(diff, changes) };
    } finally {
      diff.destroy();
    }
  };
  return { host, land, mark, project, maps, at: () => at };
}

const boardOf = (d: DesignChanges, id: string) => d.boards.find((b) => b.id === id);
const movesOn = (d: DesignChanges, id: string) => (boardOf(d, id)?.elements ?? []).filter((e): e is ElementMove => e.kind === 'moved');
const kinds = (d: DesignChanges, id: string) => (boardOf(d, id)?.elements ?? []).map((e) => [e.kind, e.id]);

describe('the design’s history projection', () => {
  it('shows a cross-board move as one move from where it was, by its author, where C reads a removal and an addition', () => {
    const w = world();
    const v = w.mark();
    let moved = '';
    w.land(AGENT, (doc) => (moved = moveElementToBoard(doc, 'a', 'b', 'e1').ids.get('e1')!));
    const { c, d } = w.project(v);
    expect(c.count).toBe(2);
    expect(d.count).toBe(1);
    expect(movesOn(d, 'b')).toEqual([expect.objectContaining({ kind: 'moved', id: moved, from: { board: 'a', id: 'e1' }, by: AGENT, at: T0 + 2 * MIN, keys: [], descendants: [] })]);
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
    expect(move!.keys.map((k) => k.key).sort()).toEqual(['style:left', 'style:top']); // the move's geometry; not its place in the stack
    // its text, changed after the move: C credits an element added in the window whole, so the projection credits the move's author
    expect(boardOf(d, 'b')!.elements.find((e) => e.id === ids.get('note'))).toMatchObject({ kind: 'changed', keys: [expect.objectContaining({ key: 'text', by: AGENT })] });
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
});

describe('the new-change pill through C’s `countChanges` hook (Decision Log 23)', () => {
  const HUMAN: Actor = { kind: 'human' };
  const AGENT_ACTOR: Actor = { kind: 'session', appSessionId: SESSION };

  function host() {
    const w = world();
    const versions: (ArtifactVersion & { state: Uint8Array })[] = [];
    let viewedAt: number | null = null;
    const version = (actor: Actor, kind: ArtifactVersion['kind']) => {
      const m = w.mark();
      versions.push({ id: versions.length + 1, seq: m.seq, at: w.at(), actor, kind, assetRefs: [], state: m.state } as ArtifactVersion & { state: Uint8Array });
    };
    const api: HistoryApi = {
      versions: async () => versions.map(({ state: _, ...v }) => v),
      lastViewedAt: async () => viewedAt,
      versionState: async (id) => versions.find((v) => v.id === id)!.state,
      attributions: async (from, to) => encodeMap(mergeMaps(w.maps.slice(from, to))),
      saveVersion: async () => ({ versionId: 0 }),
      restore: async () => ({ revision: 0, versionId: 0 }),
      duplicate: async () => ({ artifactId: 'copy' }),
      markViewed: async () => {},
    };
    return { w, version, api, view: (at: number) => (viewedAt = at) };
  }

  const settle = async (controller: DeckHistoryController) => {
    for (let i = 0; i < 20 && controller.getSnapshot().pill?.count == null; i++) await new Promise((r) => setTimeout(r, 0));
    return controller.getSnapshot().pill;
  };

  it('counts a move once with the design’s projection, and as C does without the hook', async () => {
    const h = host();
    h.version(HUMAN, 'manual');
    h.view(h.w.at());
    h.w.land(AGENT, (doc) => moveElementToBoard(doc, 'a', 'b', 'e1'));
    h.version(AGENT_ACTOR, 'auto');
    const handle = { doc: h.w.host, onRestored: () => () => {} };
    const design = new DeckHistoryController(handle, h.api, { countChanges: countDesignChanges });
    const deck = new DeckHistoryController(handle, h.api);
    const stops = [design.attach(), deck.attach()];
    expect((await settle(design))?.count).toBe(1);
    expect((await settle(deck))?.count).toBe(2);
    stops.forEach((stop) => stop());
  });
});

describe('the design’s history api (a retained version read through the design model)', () => {
  it('answers a legacy version’s bytes as its migration would build them, a model version’s as they are, and never changes either', async () => {
    const legacy = newDoc();
    const files = { [CANVAS_PATH]: JSON.stringify({ v: 1, title: 'Old', boards: { p: { x: 0, y: 0, w: 390, h: 844 } }, order: ['p'] }), 'project/boards/p.html': '<section id="p"><p id="hi">Hello</p></section>' };
    transact(legacy, () => publishFiles(legacy, {}, files, false));
    const old = stateV2(legacy);
    const modelDoc = newDoc();
    transact(modelDoc, () => writeBoards(modelDoc, SEEDS));
    const current = stateV2(modelDoc);
    const states = new Map([
      [1, old],
      [2, current],
    ]);
    const api = designHistoryApi({ versionState: async (id: number) => states.get(id)! } as unknown as HistoryApi);
    const projected = newDoc();
    applyV2(projected, await api.versionState(1));
    expect(isLegacyDesign(projected)).toBe(false);
    expect(designFiles(projected)['project/boards/p.html']).toContain('Hello');
    expect(await api.versionState(2)).toBe(current); // the model's own bytes, item identity kept for the diff
    const reread = newDoc();
    applyV2(reread, old);
    expect(isLegacyDesign(reread)).toBe(true); // the retained state is untouched
  });
});
