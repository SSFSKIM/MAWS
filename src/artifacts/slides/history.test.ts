// P3-C M8 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11; parent §4.7): the per-slide diff of two deck
// states over v14's DiffRenderer with provenance as the host keeps it (one map per update, an actor and a minute each):
// which slides were added, removed, re-ordered or changed, which elements and which of their keys, the notes' runs, the
// deck's own keys, each with its author and time; "N changes" and the order ↑ ↓ visits them in; Show editors of a live
// element.
import { describe, expect, it } from 'vitest';
import { applyV1, applyV2, attributionMap, contentIdsOf, mergeMaps, newDoc, onUpdate, stateV2, transact, type ContentMap, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { changeStops, deckChanges, elementEditors, openDeckDiff, type DeckChanges } from './history';
import { deleteElementTree, importSlide, moveSlide, setNotes, setStyle, setText, slideOrder, writeDeckKeys } from './model';
import { loadSlide } from './parse';
import { removeSlide, setDeckOverride } from './writers';
import { insertElements } from './writers-elements';

const T0 = Date.UTC(2026, 9, 12, 9, 0);
const MIN = 60_000;

function slideIR(id: string, body = `<h1 id="title" style="font-size:72px">Title ${id}</h1><p id="body" style="font-size:32px">Body of ${id}</p>`) {
  const l = loadSlide(`<section id="${id}" style="background:#ffffff">${body}<aside>Notes of ${id}</aside></section>`);
  if (!l.ok) throw new Error(`fixture ${id}`);
  return l.slide;
}

/** The host's doc and its log: one provenance map per landed update, per actor, a minute apart (A's store's shape). */
function world(ids: string[]) {
  const host = newDoc();
  const maps: ContentMap[] = [];
  let at = T0;
  const replicas = new Map<string, Doc>();
  const land = (actor: string, edit: (doc: Doc) => void) => {
    const doc = replicas.get(actor) ?? newDoc();
    replicas.set(actor, doc);
    applyV2(doc, stateV2(host));
    const updates: Uint8Array[] = [];
    const off = onUpdate(doc, (u) => updates.push(u));
    edit(doc);
    off();
    for (const u of updates) {
      applyV1(host, u);
      at += MIN;
      maps.push(attributionMap(contentIdsOf(u), { insertActor: actor, deleteActor: actor, at }));
    }
  };
  land('import', (doc) =>
    transact(doc, () => {
      writeDeckKeys(doc, { v: 4, title: 'Deck', cover: ids[0], order: ids });
      ids.forEach((id, i) => importSlide(doc, slideIR(id), `a${i}`));
    }),
  );
  const mark = () => ({ seq: maps.length, state: stateV2(host) });
  const diff = (from: { seq: number; state: Uint8Array } | null, to: { seq: number; state: Uint8Array } = mark()) =>
    openDeckDiff({ prevState: from?.state ?? null, nextState: to.state, attributions: mergeMaps(maps.slice(from?.seq ?? 0, to.seq)) });
  const provenance = () => mergeMaps(maps);
  /** The diff with the provenance of every row from `fromSeq` on: a store's hour or day row straddling the version. */
  const wideDiff = (from: { seq: number; state: Uint8Array }, fromSeq: number) => openDeckDiff({ prevState: from.state, nextState: stateV2(host), attributions: mergeMaps(maps.slice(fromSeq)) });
  return { host, land, mark, diff, provenance, wideDiff };
}

const changesOf = (w: ReturnType<typeof world>, from: ReturnType<ReturnType<typeof world>['mark']> | null): DeckChanges => {
  const d = w.diff(from);
  try {
    return deckChanges(d);
  } finally {
    d.destroy();
  }
};

describe('the per-slide diff (D11)', () => {
  it('names the element and the key a restyle changed, by its author with a time, and nothing else', () => {
    const w = world(['a', 'b']);
    const v = w.mark();
    w.land('human', (doc) => setStyle(doc, 'b', 'title', { color: '#ff0000' }));
    const changes = changesOf(w, v);
    expect(changes.slides.map((s) => [s.id, s.kind])).toEqual([['b', 'changed']]);
    const [title] = changes.slides[0]!.elements;
    expect(title).toMatchObject({ id: 'title', kind: 'changed', by: 'human', at: T0 + 2 * MIN });
    expect(title!.keys).toEqual([{ key: 'style:color', kind: 'set', by: 'human', at: T0 + 2 * MIN }]);
    expect(changes.count).toBe(1);
    expect(changes.deck).toBeNull();
  });

  it('reads an added element as one change (its own keys are not counted again) and a deleted one as removed by its deleter', () => {
    const w = world(['a']);
    const v = w.mark();
    w.land('session:x', (doc) => {
      const extra = slideIR('tmp', '<p id="note" style="position:absolute; left:100px; top:100px; font-size:24px">Draft</p>');
      expect(insertElements(doc, 'a', extra.children)).toEqual(['note']);
    });
    w.land('human', (doc) => deleteElementTree(doc, 'a', 'body'));
    const changes = changesOf(w, v);
    const els = changes.slides[0]!.elements;
    // the shown slide's elements in reading order, then the removed ones
    expect(els.map((e) => [e.id, e.kind, e.by])).toEqual([
      ['note', 'added', 'session:x'],
      ['body', 'removed', 'human'],
    ]);
    expect(els.find((e) => e.id === 'note')!.keys).toEqual([]);
    expect(changes.count).toBe(2);
  });

  it('names a text edit inside an element as its `text`', () => {
    const w = world(['a']);
    const v = w.mark();
    w.land('session:x', (doc) => setText(doc, 'a', 'body', [{ type: 'p', inline: [{ text: 'Body of a, rewritten', marks: {} }] }]));
    const [body] = changesOf(w, v).slides[0]!.elements;
    expect(body).toMatchObject({ id: 'body', kind: 'changed', by: 'session:x' });
    expect(body!.keys.map((k) => k.key)).toEqual(['text']);
  });

  it('merges touching notes runs into one change and keeps apart runs apart, inserts and deletions with their text', () => {
    const w = world(['a']);
    const v = w.mark();
    w.land('human', (doc) => setNotes(doc, 'a', 'Notes at a'));
    w.land('session:x', (doc) => setNotes(doc, 'a', 'Notes at a, and more'));
    const slide = changesOf(w, v).slides[0]!;
    expect(slide.notes.length).toBe(2);
    expect(slide.notes[0]!.parts.map((p) => [p.kind, p.text, p.by])).toEqual([
      ['del', 'of', 'human'],
      ['ins', 'at', 'human'],
    ]);
    expect(slide.notesPieces!.map((p) => [p.kind, p.text, p.run])).toEqual([
      ['same', 'Notes ', null],
      ['del', 'of', 0],
      ['ins', 'at', 0],
      ['same', ' a', null],
      ['ins', ', and more', 1],
    ]);
    expect(slide.notes[1]!.parts.map((p) => [p.kind, p.text, p.by])).toEqual([['ins', ', and more', 'session:x']]);
    expect(slide.elements).toEqual([]);
    expect(changesOf(w, v).count).toBe(2);
  });

  it('reads slides added, removed and re-ordered, each as one change, removed slides at their earlier place', () => {
    const w = world(['a', 'b', 'c', 'd']);
    const v = w.mark();
    w.land('human', (doc) => removeSlide(doc, 'b'));
    w.land('session:x', (doc) => {
      transact(doc, () => importSlide(doc, slideIR('e'), 'a9'));
    });
    w.land('human', (doc) => moveSlide(doc, 'd', null));
    const changes = changesOf(w, v);
    expect(changes.slides.map((s) => [s.id, s.kind, s.by])).toEqual([
      ['d', 'changed', 'human'],
      ['a', null, null],
      ['b', 'removed', 'human'],
      ['e', 'added', 'session:x'],
    ].filter(([, kind]) => kind !== null));
    expect(changes.slides.find((s) => s.id === 'd')!.keys.map((k) => k.key)).toEqual(['order']);
    expect(changes.count).toBe(3);
  });

  it('counts the deck’s own keys (title, overrides) as one change of the deck', () => {
    const w = world(['a']);
    const v = w.mark();
    w.land('human', (doc) => setDeckOverride(doc, '--ds-color-accent', '#336699'));
    w.land('session:x', (doc) => Y.setDeckKey(doc, 'title', 'Renamed'));
    const changes = changesOf(w, v);
    expect(changes.deck?.keys.map((k) => [k.key, k.by])).toEqual([
      ['dsOverrides', 'human'],
      ['title', 'session:x'],
    ]);
    expect(changes.count).toBe(1);
    expect(changes.slides).toEqual([]);
  });

  it('compares the oldest version with nothing: every slide reads as added, one change each, and the deck’s settings as new', () => {
    const w = world(['a', 'b']);
    const changes = changesOf(w, null);
    expect(changes.slides.map((s) => [s.id, s.kind])).toEqual([
      ['a', 'added'],
      ['b', 'added'],
    ]);
    expect(changes.deck?.keys.map((k) => k.key)).toContain('title');
    expect(changes.count).toBe(3);
  });

  it('orders ↑ ↓ by the shown deck: the deck first, then each slide’s own change, its elements in reading order, its notes', () => {
    const w = world(['a', 'b']);
    const v = w.mark();
    w.land('human', (doc) => {
      setStyle(doc, 'b', 'body', { color: '#00ff00' });
      setStyle(doc, 'b', 'title', { color: '#0000ff' });
      setNotes(doc, 'b', 'Notes of b!');
      Y.setDeckKey(doc, 'title', 'New');
      setStyle(doc, 'a', '', { background: '#000000' });
    });
    const stops = changeStops(changesOf(w, v));
    expect(stops).toEqual([
      { part: 'deck', slideId: null },
      { part: 'slide', slideId: 'a' },
      { part: 'element', slideId: 'b', elementId: 'title' },
      { part: 'element', slideId: 'b', elementId: 'body' },
      { part: 'notes', slideId: 'b', run: 0 },
    ]);
    expect(changesOf(w, v).count).toBe(stops.length);
  });

  it('leaves the docs it reads untouched and frees them on destroy', () => {
    const w = world(['a']);
    const v = w.mark();
    w.land('human', (doc) => setStyle(doc, 'a', 'title', { color: '#123456' }));
    const d = w.diff(v);
    const before = stateV2(d.nextDoc);
    deckChanges(d);
    expect(stateV2(d.nextDoc)).toEqual(before);
    expect(slideOrder(d.prevDoc)).toEqual(['a']);
    d.destroy();
  });
});

describe('S7a’s pitfall 10: the heavy deck’s per-element count reading 0 after month one', () => {
  // Reproduced on S7a's heavy deck soak (three months, its preview inputs exported per month): the version the soak
  // previews holds 100 slides at month two and 94 at month three; today's deck keeps 1 of their ids at month two and
  // none at month three (the heavy profile deletes about 1.4 slides a day down to 80 and adds new ones under new ids),
  // so nearly every change is a whole slide added or removed, whose elements are not changes of their own. The one
  // kept slide at month two (and 3 of 15 at month one) is a slide a restore brought back: a revert re-inserts what it
  // brings back as new items, so its node is new under its old id and S7a's walk, skipping every element of a slide
  // whose node carries an attribution, counted none of its changes. The walk here decides added and removed by the id's
  // presence in each state and compares a node new under a kept id with the earlier one.
  it('reads a slide a restore re-created under its id as changed, its changed element named, not as a new slide', () => {
    const w = world(['a', 'b']);
    const v = w.mark();
    w.land('human:restore', (doc) =>
      transact(doc, () => {
        Y.deleteSlide(doc, 'a');
        importSlide(doc, slideIR('a', '<h1 id="title" style="font-size:72px">Title a, restored</h1><p id="body" style="font-size:32px">Body of a</p>'), 'a0');
      }),
    );
    const changes = changesOf(w, v);
    expect(changes.slides.map((s) => [s.id, s.kind, s.by])).toEqual([['a', 'changed', 'human:restore']]);
    expect(changes.slides[0]!.elements.map((e) => [e.id, e.kind, e.keys.map((k) => k.key)])).toEqual([['title', 'changed', ['text']]]);
    expect(changes.count).toBe(1);
  });

  it('counts no elements when every slide of the version was replaced (the heavy deck at month three), each slide one change', () => {
    const w = world(['a', 'b']);
    const v = w.mark();
    w.land('human', (doc) =>
      transact(doc, () => {
        Y.deleteSlide(doc, 'a');
        Y.deleteSlide(doc, 'b');
        importSlide(doc, slideIR('c'), 'a0');
      }),
    );
    const changes = changesOf(w, v);
    expect(changes.slides.map((s) => [s.id, s.kind])).toEqual([
      ['a', 'removed'],
      ['b', 'removed'],
      ['c', 'added'],
    ]);
    expect(changes.slides.flatMap((s) => s.elements)).toEqual([]);
    expect(changes.count).toBe(3);
  });

  it('leaks nothing from a provenance row straddling the version (the store’s hour and day rows reach back to the import)', () => {
    const w = world(['a', 'b']);
    w.land('human', (doc) => setNotes(doc, 'a', 'Notes of a, early'));
    const v = w.mark();
    w.land('session:x', (doc) => setStyle(doc, 'b', 'title', { color: '#ff0000' }));
    w.land('human', (doc) => setNotes(doc, 'b', 'Notes of b, late'));
    const d = w.wideDiff(v, 0); // every row, the import's and the edit before the version included
    try {
      const changes = deckChanges(d);
      expect(changes.slides.map((s) => [s.id, s.kind])).toEqual([['b', 'changed']]);
      const b = changes.slides[0]!;
      expect(b.elements.map((e) => [e.id, e.kind, e.by])).toEqual([['title', 'changed', 'session:x']]);
      expect(b.notes.map((r) => r.parts.map((p) => [p.kind, p.text, p.by]))).toEqual([[['ins', ', late', 'human']]]);
      expect(changes.count).toBe(2);
    } finally {
      d.destroy();
    }
  });
});

describe('Show editors of a live element (D11)', () => {
  it('lists who set the element’s keys and typed its text, the latest time each, from provenance', () => {
    const w = world(['a']);
    w.land('human', (doc) => setStyle(doc, 'a', 'title', { color: '#ff0000' }));
    w.land('session:x', (doc) => setText(doc, 'a', 'title', [{ type: 'p', inline: [{ text: 'Title a, edited', marks: {} }] }]));
    w.land('human', (doc) => setStyle(doc, 'a', 'title', { 'font-size': '80px' }));
    const editors = elementEditors(w.host, 'a', 'title', w.provenance());
    expect(editors.map((e) => [e.who, e.at])).toEqual([
      ['human', T0 + 4 * MIN],
      ['session:x', T0 + 3 * MIN],
      ['import', T0 + MIN],
    ]);
    expect(editors[1]!.kinds).toContain('text');
    expect(elementEditors(w.host, 'a', 'nope', w.provenance())).toEqual([]);
  });
});
