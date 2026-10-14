// P3-C M2 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D3, D4): the deck's three-way publish. Every row of
// S6's §3 table (spikes/p3-store/findings.txt) through `publishDeck(live, base, sent, force)`, each conflict D3 names,
// `force`, character-level text merges that do and do not overlap, D4's ids (equal across A's two calls), and the
// refusals of files the deck cannot hold.
import { describe, expect, it } from 'vitest';
import { FilesError } from '../files';
import { applyV2, newDoc, onUpdate, stateV2, stateVector, transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { DECK_PATH, slidePath } from './deck';
import { claudeExamples } from './fixtures/s6';
import { deckFiles, deleteElementTree, moveInto, moveSlide, readDeckJson, readFlat, readSlide, reorderFlow, resolveAnchor, setNotes, setStyle, setText, slideOrder, zOrder } from './model';
import { GOOGLE_FONTS_WARNING, publishDeck, type DeckPublishOutcome } from './publish';

const P = (id: string) => slidePath(id);
const DECK = JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-12T18:00:00Z' }, lists: 'css', title: 'Q3', cover: 'plan', order: ['plan', 'kpis', 'map'], sections: { s1: { description: 'Numbers', start: 'plan' } }, faces: {}, designSystems: [], xUnknown: { keep: true } });
const FIRST = { [DECK_PATH]: DECK, [P('plan')]: claudeExamples['skill-plan']!, [P('kpis')]: claudeExamples['layout-kpis']!, [P('map')]: claudeExamples['recipes-label']! };

/** A deck created from files as A's create does it: the kind's publish onto an empty doc with an empty base. */
function created(files: Record<string, string> = FIRST): Doc {
  const doc = newDoc();
  const out = publishDeck(doc, {}, files, false);
  expect(out.conflicts).toEqual([]);
  return doc;
}
/** A publish with the updates it emitted and their bytes. */
function publish(live: Doc, base: Record<string, string>, sent: Record<string, string | null>, force = false): DeckPublishOutcome & { updates: number; bytes: number } {
  let updates = 0;
  let bytes = 0;
  const off = onUpdate(live, (u) => {
    updates++;
    bytes += u.length;
  });
  try {
    return { ...publishDeck(live, base, sent, force), updates, bytes };
  } finally {
    off();
  }
}
const el = (doc: Doc, slide: string, id: string) => readFlat(doc, slide).find((e) => e.id === id);
const idOf = (file: string, re: RegExp) => re.exec(file)![1]!;
const textOf = (doc: Doc, slide: string, id: string) => JSON.stringify(Y.readText(doc, slide, id));

describe('publishDeck: S6’s §3 table', () => {
  it('creates a deck from files onto an empty doc in one update, minting the ids the files left out, keeping unknown index keys', () => {
    const doc = newDoc();
    const out = publish(doc, {}, FIRST);
    expect(out).toMatchObject({ conflicts: [], changed: [DECK_PATH, P('kpis'), P('map'), P('plan')], added: [P('kpis'), P('map'), P('plan')], held: [] });
    expect(out.updates).toBe(1);
    expect(slideOrder(doc)).toEqual(['plan', 'kpis', 'map']);
    const files = deckFiles(doc);
    expect(JSON.parse(files[DECK_PATH]!)).toMatchObject({ xUnknown: { keep: true }, sections: { s1: { start: 'plan' } } });
    for (const path of [P('plan'), P('kpis'), P('map')]) expect(files[path]).not.toMatch(/<(h[1-3]|p|div|img|svg|x-[a-z]+)(?![^>]*\bid=)[\s>]/);
  });

  it('writes nothing for a republish of the files just read, or of files equal to them by meaning', () => {
    const doc = created();
    const files = deckFiles(doc);
    expect(publish(doc, files, files)).toMatchObject({ changed: [], conflicts: [], updates: 0, bytes: 0 });
    const messy = Object.fromEntries(
      Object.entries(files).map(([p, c]) => [
        p,
        p.endsWith('.html')
          ? c.replace(/style="([^"]*)"/g, (_, s: string) => `style="${s.split('; ').reverse().join(';').replace(/#([0-9a-f]{6})/g, (m) => m.toUpperCase())}"`).replace(/\n\s*/g, '\n')
          : JSON.stringify(JSON.parse(c)),
      ]),
    );
    expect(Object.values(messy)).not.toEqual(Object.values(files));
    expect(publish(doc, files, messy)).toMatchObject({ changed: [], conflicts: [], updates: 0, bytes: 0 });
  });

  it('writes one key for one changed property', () => {
    const doc = created();
    const files = deckFiles(doc);
    const plan = files[P('plan')]!;
    const keys = () => readFlat(doc, 'plan', false).flatMap((e) => Object.entries({ ...e, style: undefined, attrs: undefined, ...e.style, ...e.attrs }).map(([k, v]) => `${e.id} ${k}=${String(v)}`));
    const before = new Set(keys());
    const out = publish(doc, files, { [P('plan')]: plan.replace('left:128px; bottom:64px', 'left:160px; bottom:64px') });
    expect(out).toMatchObject({ changed: [P('plan')], updates: 1 });
    expect(keys().filter((k) => !before.has(k))).toEqual([expect.stringMatching(/ left=160px$/)]);
    expect(out.bytes).toBeLessThan(64);
  });

  it('keeps the human’s colour set after the read when the agent republishes the element moved with its stale colour', () => {
    const doc = created();
    const files = deckFiles(doc);
    const footer = idOf(files[P('plan')]!, /<p id="([^"]+)" style="position:absolute; left:128px; bottom:64px/);
    setStyle(doc, 'plan', footer, { color: '#c0392b' }, 'human');
    const out = publish(doc, files, { [P('plan')]: files[P('plan')]!.replace('left:128px; bottom:64px', 'left:200px; bottom:80px') });
    expect(out.conflicts).toEqual([]);
    expect(el(doc, 'plan', footer)!.style).toMatchObject({ left: '200px', bottom: '80px', color: '#c0392b' });
  });

  it('removes an element (its anchor orphaned) and re-adds it with the same id (the anchor live again)', () => {
    const doc = created();
    let files = deckFiles(doc);
    const footer = idOf(files[P('plan')]!, /<p id="([^"]+)" style="position:absolute; left:128px; bottom:64px/);
    const line = files[P('plan')]!.split('\n').find((l) => l.includes(`id="${footer}"`))!;
    publish(doc, files, { [P('plan')]: files[P('plan')]!.replace(line + '\n', '') });
    expect(resolveAnchor(doc, { slideId: 'plan', elementId: footer }).live).toBe(false);
    files = deckFiles(doc);
    publish(doc, files, { [P('plan')]: files[P('plan')]!.replace('  <aside>', `${line}\n  <aside>`) });
    expect(resolveAnchor(doc, { slideId: 'plan', elementId: footer }).live).toBe(true);
  });

  it('merges the agent’s word and bold with the human’s typing in the same box, and an added line break with typing elsewhere', () => {
    const doc = created();
    let files = deckFiles(doc);
    const label = idOf(files[P('kpis')]!, /<p id="([^"]+)"[^>]*>faster ramp<\/p>/);
    setText(doc, 'kpis', label, [{ type: 'p', inline: [{ text: 'faster ramp (YoY)', marks: {} }] }], 'human');
    expect(publish(doc, files, { [P('kpis')]: files[P('kpis')]!.replace('>faster ramp<', '>much <b>faster</b> ramp<') }).conflicts).toEqual([]);
    expect(Y.readText(doc, 'kpis', label)).toEqual([{ type: 'p', inline: [{ text: 'much ', marks: {} }, { text: 'faster', marks: { b: {} } }, { text: ' ramp (YoY)', marks: {} }] }]);

    files = deckFiles(doc);
    setText(doc, 'kpis', label, [{ type: 'p', inline: [{ text: 'much ', marks: {} }, { text: 'faster', marks: { b: {} } }, { text: ' ramp (YoY) now', marks: {} }] }], 'human');
    expect(publish(doc, files, { [P('kpis')]: files[P('kpis')]!.replace('</b> ramp (YoY)<', '</b><br>ramp (YoY)<') }).conflicts).toEqual([]);
    const text = textOf(doc, 'kpis', label);
    expect(text).toContain('"br":true');
    expect(text).toContain('now');
  });

  it('writes one key for a flow re-order of two siblings and one for a pinned element moved from under to over the flow', () => {
    const doc = created();
    let files = deckFiles(doc);
    const kp = files[P('kpis')]!.split('\n');
    const tiles = kp.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('    <div id='));
    const [t1, t2] = [tiles[0]![1], tiles[1]![1]];
    const block1 = kp.slice(t1, t2);
    const block2 = kp.slice(t2, t2 + block1.length);
    const swapped = [...kp.slice(0, t1), ...block2, ...block1, ...kp.slice(t2 + block1.length)].join('\n');
    expect(publish(doc, files, { [P('kpis')]: swapped })).toMatchObject({ changed: [P('kpis')], updates: 1 });
    expect(deckFiles(doc)[P('kpis')]).toBe(swapped);

    files = deckFiles(doc);
    const lines = files[P('map')]!.split('\n');
    expect(lines[1]).toContain('position:absolute');
    const over = [lines[0], ...lines.slice(2, -2), lines[1], ...lines.slice(-2)].join('\n');
    let writes = 0;
    const off = onUpdate(doc, () => writes++);
    const before = readFlat(doc, 'map', false).map((e) => [e.id, e.z, e.order]);
    publish(doc, files, { [P('map')]: over });
    off();
    const after = readFlat(doc, 'map', false).map((e) => [e.id, e.z, e.order]);
    expect(writes).toBe(1);
    expect(after.filter((e, i) => JSON.stringify(e) !== JSON.stringify(before[i]))).toHaveLength(1);
    expect(deckFiles(doc)[P('map')]!.split('\n').at(-3)).toContain('position:absolute');
  });

  it('holds a structurally invalid file (the last good model kept, a read returns it verbatim) and clears the hold on a valid republish', () => {
    const doc = created();
    const files = deckFiles(doc);
    const bad = files[P('map')]!.replace('</section>', '<iframe></iframe></section>');
    const out = publish(doc, files, { [P('map')]: bad });
    expect(out.held).toEqual([{ path: P('map'), reasons: [expect.stringContaining('iframe')] }]);
    expect(out.changed).toEqual([P('map')]);
    expect(deckFiles(doc)[P('map')]).toBe(bad);
    expect(readFlat(doc, 'map', false).length).toBeGreaterThan(0);
    const fixed = publish(doc, deckFiles(doc), { [P('map')]: files[P('map')]! });
    expect(fixed).toMatchObject({ conflicts: [], held: [], changed: [P('map')] });
    expect(Y.slideScalars(doc, 'map').held).toBeUndefined();
    expect(deckFiles(doc)[P('map')]).toBe(files[P('map')]);
  });

  it('refuses a map with one path the deck cannot hold whole, writing nothing', () => {
    const doc = created();
    const files = deckFiles(doc);
    const sv = stateVector(doc);
    expect(() => publish(doc, files, { [P('plan')]: files[P('plan')]!.replace('Changes', 'Changed'), 'project/../x.html': 'x', 'notes.txt': 'y' })).toThrow(FilesError);
    try {
      publishDeck(doc, files, { 'project/../x.html': 'x', 'notes.txt': 'y', [DECK_PATH]: null, [P('other')]: '<section id="not-other"></section>' }, false);
    } catch (e) {
      expect((e as FilesError).problems.map((p) => p.path).sort()).toEqual(['notes.txt', DECK_PATH, P('other'), 'project/../x.html'].sort());
      expect((e as FilesError).problems.find((p) => p.path === P('other'))!.message).toMatch(/"not-other"/);
    }
    expect(() => publishDeck(doc, files, { [DECK_PATH]: '{"order": 3}' }, false)).toThrow(/order is not a list/);
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [P(`n${i}`), `<section id="n${i}"></section>`]));
    expect(() => publishDeck(doc, files, many, false)).toThrow(/over 500/);
    expect(stateVector(doc)).toEqual(sv);
  });

  it('re-orders the deck with one slide key, keeping unknown keys, and removes a slide with its order in one update', () => {
    const doc = created();
    const files = deckFiles(doc);
    const dj = JSON.parse(files[DECK_PATH]!) as { order: string[] };
    dj.order = ['kpis', 'plan', 'map'];
    expect(publish(doc, files, { [DECK_PATH]: JSON.stringify(dj) })).toMatchObject({ changed: [DECK_PATH], updates: 1 });
    expect(slideOrder(doc)).toEqual(['kpis', 'plan', 'map']);
    dj.order = ['kpis', 'plan'];
    const out = publish(doc, deckFiles(doc), { [DECK_PATH]: JSON.stringify(dj), [P('map')]: null });
    expect(out).toMatchObject({ changed: [DECK_PATH, P('map')], updates: 1 });
    expect(Y.hasSlide(doc, 'map')).toBe(false);
    expect(JSON.parse(deckFiles(doc)[DECK_PATH]!).xUnknown).toEqual({ keep: true });
  });
});

describe('publishDeck: refusals name the path, the element and the property, and write nothing', () => {
  function refused(doc: Doc, base: Record<string, string>, sent: Record<string, string | null>) {
    const sv = stateVector(doc);
    const out = publish(doc, base, sent);
    expect(out.changed).toEqual([]);
    expect(out.updates).toBe(0);
    expect(stateVector(doc)).toEqual(sv);
    return out.conflicts;
  }
  const slide = `<section id="s1" style="background:#ffffff; padding:128px">
  <h2 id="title" style="font-family:Georgia, serif; font-size:64px">Title</h2>
  <div id="card1" style="display:flex"><p id="c1">One</p></div>
  <div id="card2" style="display:flex"><p id="c2">Two</p></div>
  <aside>Notes here</aside>
</section>`;
  const deck = () => created({ [DECK_PATH]: JSON.stringify({ v: 4, title: 'T', cover: 's1', order: ['s1', 's2'] }), [P('s1')]: slide, [P('s2')]: '<section id="s2"><p id="x">x</p></section>' });

  it('a property both changed: element title: font-family', () => {
    const doc = deck();
    const files = deckFiles(doc);
    setStyle(doc, 's1', 'title', { 'font-family': 'Lora, serif' }, 'human');
    expect(refused(doc, files, { [P('s1')]: files[P('s1')]!.replace('Georgia, serif', 'Inter, sans-serif') })).toEqual([{ path: P('s1'), detail: 'element title: font-family changed since your read' }]);
  });

  it('an element removed since the read that the agent changed: element card2', () => {
    const doc = deck();
    const files = deckFiles(doc);
    deleteElementTree(doc, 's1', 'card2', 'human');
    expect(refused(doc, files, { [P('s1')]: files[P('s1')]!.replace('>Two<', '>Deux<') })).toEqual([{ path: P('s1'), detail: 'element c2: removed since your read' }]);
    expect(refused(doc, files, { [P('s1')]: files[P('s1')]!.replace('<div id="card2" style="display:flex">', '<div id="card2" style="display:grid">') })).toContainEqual({ path: P('s1'), detail: 'element card2: removed since your read' });
  });

  it('a slide removed since the read, a slide id created since, and a removal of a slide changed since', () => {
    const doc = deck();
    const files = deckFiles(doc);
    publishDeck(doc, deckFiles(doc), { [P('s2')]: null, [P('s3')]: '<section id="s3"><p id="y">theirs</p></section>' }, false);
    expect(refused(doc, files, { [P('s2')]: '<section id="s2"><p id="x">changed</p></section>' })).toEqual([{ path: P('s2'), detail: 'slide: removed since your read' }]);
    expect(refused(doc, files, { [P('s3')]: '<section id="s3"><p id="y">mine</p></section>' })).toEqual([{ path: P('s3'), detail: 'slide: created since your read' }]);
    const now = deckFiles(doc);
    setNotes(doc, 's1', 'Other notes', 'human');
    expect(refused(doc, now, { [P('s1')]: null })).toEqual([{ path: P('s1'), detail: 'slide: changed since your read' }]);
  });

  it('text both changed in overlapping ranges: text of title; notes likewise', () => {
    const doc = deck();
    const files = deckFiles(doc);
    setText(doc, 's1', 'title', [{ type: 'p', inline: [{ text: 'Tidal', marks: {} }] }], 'human');
    setNotes(doc, 's1', 'Notes there', 'human');
    expect(refused(doc, files, { [P('s1')]: files[P('s1')]!.replace('>Title<', '>Total<').replace('Notes here', 'Notes everywhere') })).toEqual([
      { path: P('s1'), detail: 'text of title: changed since your read' },
      { path: P('s1'), detail: 'notes: changed since your read' },
    ]);
  });

  it('merges text and notes whose changed ranges do not overlap', () => {
    const doc = deck();
    const files = deckFiles(doc);
    setText(doc, 's1', 'title', [{ type: 'p', inline: [{ text: 'Title, revised', marks: {} }] }], 'human');
    setNotes(doc, 's1', 'Notes here, and more', 'human');
    const out = publish(doc, files, { [P('s1')]: files[P('s1')]!.replace('>Title<', '>The <i>Title</i><').replace('Notes here', 'My notes here') });
    expect(out.conflicts).toEqual([]);
    expect(Y.readText(doc, 's1', 'title')).toEqual([{ type: 'p', inline: [{ text: 'The ', marks: {} }, { text: 'Title', marks: { i: {} } }, { text: ', revised', marks: {} }] }]);
    expect(Y.readNotes(doc, 's1')).toBe('My notes here, and more');
  });

  it('the order both changed differently: order (a slide’s elements, and the deck’s slides)', () => {
    const doc = deck();
    const files = deckFiles(doc);
    reorderFlow(doc, 's1', 'card2', 'title', 'human'); // the human moves card2 before the title
    const agent = slide.replace('<div id="card1" style="display:flex"><p id="c1">One</p></div>', '\u0000').replace('<div id="card2" style="display:flex"><p id="c2">Two</p></div>', '<div id="card1" style="display:flex"><p id="c1">One</p></div>').replace('\u0000', '<div id="card2" style="display:flex"><p id="c2">Two</p></div>'); // the agent swaps the cards
    expect(agent.indexOf('card2')).toBeLessThan(agent.indexOf('card1'));
    expect(refused(doc, files, { [P('s1')]: agent })).toEqual([{ path: P('s1'), detail: 'order: changed since your read' }]);

    const doc2 = created({ [DECK_PATH]: JSON.stringify({ v: 4, order: ['a', 'b', 'c'] }), [P('a')]: '<section id="a"></section>', [P('b')]: '<section id="b"></section>', [P('c')]: '<section id="c"></section>' });
    const base = deckFiles(doc2);
    moveSlide(doc2, 'c', null, 'human');
    expect(refused(doc2, base, { [DECK_PATH]: JSON.stringify({ v: 4, order: ['b', 'a', 'c'] }) })).toEqual([{ path: DECK_PATH, detail: 'order: changed since your read' }]);
    // the same order as the human's, or a new slide while the human re-ordered, is no conflict
    expect(publish(doc2, base, { [DECK_PATH]: JSON.stringify({ v: 4, order: ['c', 'a', 'b'] }) }).conflicts).toEqual([]);
    expect(publish(doc2, base, { [P('d')]: '<section id="d"></section>' }).conflicts).toEqual([]);
    expect(slideOrder(doc2)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('an index key both changed: deck.json key cover (and a map entry)', () => {
    const doc = created({ [DECK_PATH]: JSON.stringify({ v: 4, cover: 's1', order: ['s1'], faces: { lora: { family: 'Lora', src: 'assets/lora.woff2' } } }), [P('s1')]: '<section id="s1"></section>' });
    const files = deckFiles(doc);
    publishDeck(doc, files, { [DECK_PATH]: JSON.stringify({ v: 4, cover: 'other', order: ['s1'], faces: { lora: { family: 'Lora', src: 'assets/lora2.woff2' } } }) }, false);
    expect(refused(doc, files, { [DECK_PATH]: JSON.stringify({ v: 4, cover: 'mine', order: ['s1'], faces: { lora: { family: 'Lora', src: 'assets/lora3.woff2' } } }) })).toEqual([
      { path: DECK_PATH, detail: 'deck.json key cover: changed since your read' },
      { path: DECK_PATH, detail: 'deck.json key faces.lora: changed since your read' },
    ]);
  });

  it('refuses the whole publish when one file conflicts, landing none of the others', () => {
    const doc = deck();
    const files = deckFiles(doc);
    setStyle(doc, 's1', 'title', { 'font-family': 'Lora, serif' }, 'human');
    const conflicts = refused(doc, files, { [P('s1')]: files[P('s1')]!.replace('Georgia, serif', 'Inter, sans-serif'), [P('s2')]: files[P('s2')]!.replace('>x<', '>y<'), [DECK_PATH]: files[DECK_PATH]!.replace('"T"', '"U"') });
    expect(conflicts).toHaveLength(1);
    expect(Y.readText(doc, 's2', 'x')).toEqual([{ type: 'p', inline: [{ text: 'x', marks: {} }] }]);
  });
});

describe('publishDeck: force, and the keys that are not the agent’s', () => {
  it('applies the agent’s value for exactly the conflicting keys; others’ changes the agent did not touch stay', () => {
    const doc = created({ [P('s1')]: '<section id="s1"><h2 id="title" style="color:#111111; font-size:64px">Title</h2><p id="p">Body</p></section>' });
    const files = deckFiles(doc);
    setStyle(doc, 's1', 'title', { color: '#ff0000', 'font-size': '70px' }, 'human');
    setText(doc, 's1', 'p', [{ type: 'p', inline: [{ text: 'Bode', marks: {} }] }], 'human'); // the same letters as the agent's
    const sent = files[P('s1')]!.replace('color:#111111', 'color:#00ff00').replace('>Body<', '>Bodies<');
    expect(publish(doc, files, { [P('s1')]: sent }).conflicts).toHaveLength(2);
    const out = publish(doc, files, { [P('s1')]: sent }, true);
    expect(out).toMatchObject({ conflicts: [], changed: [P('s1')] });
    expect(el(doc, 's1', 'title')!.style).toEqual({ color: '#00ff00', 'font-size': '70px' }); // the human's size kept: not the agent's change
    expect(Y.readText(doc, 's1', 'p')).toEqual([{ type: 'p', inline: [{ text: 'Bodies', marks: {} }] }]);
  });

  it('leaves a file equal to the base alone even under force, and one equal to live without a write', () => {
    const doc = created({ [P('s1')]: '<section id="s1"><h2 id="title" style="color:#111111">Title</h2></section>' });
    const files = deckFiles(doc);
    setStyle(doc, 's1', 'title', { color: '#ff0000' }, 'human');
    expect(publish(doc, files, files, true)).toMatchObject({ changed: [], updates: 0 });
    expect(publish(doc, files, { [P('s1')]: deckFiles(doc)[P('s1')]! })).toMatchObject({ changed: [], conflicts: [], updates: 0 });
    expect(el(doc, 's1', 'title')!.style.color).toBe('#ff0000');
  });

  it('re-creates under force an element removed since the read, and removes one changed since', () => {
    const doc = created({ [P('s1')]: '<section id="s1"><p id="a">A</p><p id="b">B</p></section>' });
    const files = deckFiles(doc);
    deleteElementTree(doc, 's1', 'a', 'human');
    setStyle(doc, 's1', 'b', { color: '#ff0000' }, 'human');
    const sent = files[P('s1')]!.replace('>A<', '>AA<').replace(/\n\s*<p id="b">B<\/p>/, '');
    expect(publish(doc, files, { [P('s1')]: sent }).conflicts).toEqual([
      { path: P('s1'), detail: 'element a: removed since your read' },
      { path: P('s1'), detail: 'element b: changed since your read' },
    ]);
    publish(doc, files, { [P('s1')]: sent }, true);
    expect(readSlide(doc, 's1').children.map((c) => [c.id, c.text?.[0]?.inline])).toEqual([['a', [{ text: 'AA', marks: {} }]]]);
  });
});

describe('publishDeck: element identity (D4)', () => {
  const base = `<section id="s1"><h2 id="title">Title</h2><div id="box" style="display:flex"><p id="one">One</p><p id="two">Two</p></div></section>`;

  it('gives an element written without an id its base slot’s id, else a minted one never in base or sent', () => {
    const doc = created({ [P('s1')]: base });
    const files = deckFiles(doc);
    const out = publish(doc, files, { [P('s1')]: '<section id="s1"><h2>Title, again</h2><div id="box" style="display:flex"><p>One</p><p id="one">Moved</p><p>New</p></div></section>' });
    expect(out.conflicts).toEqual([]);
    const slide = readSlide(doc, 's1');
    expect(slide.children[0]!.id).toBe('title'); // the slot kept its id: same element
    const kids = slide.children[1]!.children.map((c) => c.id);
    expect(kids[1]).toBe('one');
    expect(kids[0]).toMatch(/^e\d+-[0-9a-z]{4}$/); // the slot's id is used elsewhere in the file: minted
    expect(kids[2]).toMatch(/^e\d+-[0-9a-z]{4}$/);
    expect(new Set([...kids, 'title', 'box', 'two']).size).toBe(6);
    expect(Y.readText(doc, 's1', 'title')[0]!.inline).toEqual([{ text: 'Title, again', marks: {} }]);
  });

  it('mints the same ids in A’s two calls (the live write and the session’s new base) and in a replay', () => {
    const doc = created({ [P('s1')]: base });
    const files = deckFiles(doc);
    const baseState = stateV2(doc);
    setStyle(doc, 's1', 'title', { color: '#ff0000' }, 'human'); // live moved on since the read
    const sent = { [P('s1')]: base.replace('</div>', '<p>Three</p></div><p>Four</p>') };
    publishDeck(doc, files, sent, false);
    const known = newDoc();
    applyV2(known, baseState);
    publishDeck(known, deckFiles(known), sent, true);
    const minted = (d: Doc) => readFlat(d, 's1', false).map((e) => e.id).sort();
    expect(minted(known)).toEqual(minted(doc));
    expect(minted(doc).filter((id) => id.startsWith('e'))).toHaveLength(2);
  });

  it('warns when the agent dropped a read slide’s ids wholesale', () => {
    const doc = created({ [P('s1')]: base });
    const files = deckFiles(doc);
    const out = publish(doc, files, { [P('s1')]: '<section id="s1"><h2>Title</h2><div style="display:flex"><p>One</p><p>Two!</p></div></section>' });
    expect(out.warnings).toContainEqual({ path: P('s1'), slide: 's1', message: '4 elements had no id: re-read to keep their identity' });
    expect(readFlat(doc, 's1', false).map((e) => e.id).sort()).toEqual(['box', 'one', 'title', 'two']);
    expect(Y.readText(doc, 's1', 'two')[0]!.inline).toEqual([{ text: 'Two!', marks: {} }]);
  });
});

describe('publishDeck: what the loader dropped and held, the index, tables', () => {
  it('answers the loader’s warnings with path, slide, element and property, counts its notes, and lists held slides', () => {
    const doc = created({ [P('s1')]: '<section id="s1"><p id="p">a</p></section>' });
    const files = deckFiles(doc);
    const out = publish(doc, files, {
      [P('s1')]: '<section id="s1"><!-- c --><p id="p" style="float:left; color:red" title="t">b</p></section>',
      [P('s2')]: '<section id="s2"><iframe></iframe></section>',
    });
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        { path: P('s1'), slide: 's1', element: 'p', property: 'float', message: expect.any(String) },
        { path: P('s1'), slide: 's1', element: 'p', property: 'title', message: expect.any(String) },
      ]),
    );
    expect(out.notes).toBeGreaterThan(0);
    expect(out.held).toEqual([{ path: P('s2'), reasons: [expect.stringContaining('iframe')] }]);
    expect(out.added).toEqual([P('s2')]);
    expect(slideOrder(doc)).toEqual(['s1', 's2']);
  });

  it('warns once that Google Fonts faces are named, never fetched, and drops order ids with no slide', () => {
    const doc = created({ [P('s1')]: '<section id="s1"></section>' });
    const out = publish(doc, deckFiles(doc), { [DECK_PATH]: JSON.stringify({ v: 4, order: ['s1', 'ghost'], faces: { lora: { family: 'Lora', href: 'https://fonts.googleapis.com/css2?family=Lora' }, inter: { family: 'Inter', href: 'https://fonts.googleapis.com/css2?family=Inter' } } }) });
    expect(out.warnings.filter((w) => w.message === GOOGLE_FONTS_WARNING)).toEqual([{ path: DECK_PATH, property: 'faces', message: GOOGLE_FONTS_WARNING }]);
    expect(out.warnings).toContainEqual({ path: DECK_PATH, property: 'order', message: 'order lists slide ghost, which has no file; dropped' });
    expect(JSON.parse(deckFiles(doc)[DECK_PATH]!).order).toEqual(['s1']);
  });

  it('appends a new slide the sent order leaves out after the last slide, and keeps a slide created since the read in its place', () => {
    const doc = created({ [DECK_PATH]: JSON.stringify({ v: 4, order: ['a', 'b'] }), [P('a')]: '<section id="a"></section>', [P('b')]: '<section id="b"></section>' });
    const files = deckFiles(doc);
    publishDeck(doc, deckFiles(doc), { [DECK_PATH]: JSON.stringify({ v: 4, order: ['a', 'h', 'b'] }), [P('h')]: '<section id="h"></section>' }, false);
    expect(publish(doc, files, { [DECK_PATH]: JSON.stringify({ v: 4, order: ['b', 'a'] }), [P('n')]: '<section id="n"></section>' }).conflicts).toEqual([]);
    expect(slideOrder(doc)).toEqual(['b', 'a', 'h', 'n']);
  });

  it('compares table cells by row and column: a cell edited, a row added, a column removed', () => {
    const table = '<section id="s1"><table id="t"><tr id="r1"><th>A</th><th>B</th><th>C</th></tr><tr id="r2"><td>1</td><td>2</td><td>3</td></tr></table></section>';
    const doc = created({ [P('s1')]: table });
    let files = deckFiles(doc);
    const r2 = () => readSlide(doc, 's1').children[0]!.children[1]!;
    const cellIds = r2().children.map((c) => c.id);
    setText(doc, 's1', cellIds[2]!, [{ type: 'p', inline: [{ text: '33', marks: {} }] }], 'human'); // the human edits C2
    publish(doc, files, { [P('s1')]: files[P('s1')]!.replace('<td>1</td>', '<td>one</td>').replace('</table>', '<tr id="r3"><td>x</td><td>y</td><td>z</td></tr></table>') });
    expect(r2().children.map((c) => c.id)).toEqual(cellIds); // the same cells
    expect(r2().children.map((c) => c.text![0]!.inline[0])).toEqual([{ text: 'one', marks: {} }, { text: '2', marks: {} }, { text: '33', marks: {} }]);
    files = deckFiles(doc);
    publish(doc, files, { [P('s1')]: files[P('s1')]!.replace(/\s*<th>C<\/th>/, '').replace(/\s*<td>33<\/td>/, '').replace(/\s*<td>z<\/td>/, '') });
    expect(deckFiles(doc)[P('s1')]).not.toMatch(/>C<|>33<|>z</);
    expect(r2().children.map((c) => c.id)).toEqual(cellIds.slice(0, 2));
  });

  it('keeps the human’s z-order when the agent republishes the slide without changing its order', () => {
    const doc = created({ [P('s1')]: '<section id="s1"><p id="a" style="position:absolute; left:0px; top:0px">A</p><p id="b" style="position:absolute; left:10px; top:0px">B</p></section>' });
    const files = deckFiles(doc);
    zOrder(doc, 's1', 'a', 'front', 'human');
    expect(publish(doc, files, { [P('s1')]: files[P('s1')]!.replace('>B<', '>Bee<') }).conflicts).toEqual([]);
    expect(readSlide(doc, 's1').children.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

// The M2 task review's probes (fix wave 1), each a regression.
describe('publishDeck: fix wave 1 (the task review’s probes)', () => {
  const S = P('s1');
  function small(html = '<section id="s1"><p id="a">A</p><p id="b">B</p></section>', extra: Record<string, unknown> = {}): Doc {
    return created({ [DECK_PATH]: JSON.stringify({ v: 4, order: ['s1'], ...extra }), [S]: html });
  }

  it('compares each entry of an index map the agent left out: refused when one changed since the read', () => {
    const doc = small(undefined, { dsOverrides: { '--ds-color-bg': '#ffffff' } });
    const base = deckFiles(doc);
    transact(doc, () => Y.setDeckEntry(doc, 'dsOverrides', '--ds-color-bg', '#ff0000'));
    const sent = JSON.parse(base[DECK_PATH]!) as Record<string, unknown>;
    delete sent.dsOverrides;
    expect(publish(doc, base, { [DECK_PATH]: JSON.stringify(sent) }).conflicts).toEqual([{ path: DECK_PATH, detail: 'deck.json key dsOverrides.--ds-color-bg: changed since your read' }]);
    // unchanged since the read: the map goes
    const doc2 = small(undefined, { dsOverrides: { '--ds-color-bg': '#ffffff' } });
    expect(publish(doc2, deckFiles(doc2), { [DECK_PATH]: JSON.stringify(sent) }).conflicts).toEqual([]);
    expect(readDeckJson(doc2).dsOverrides).toBeUndefined();
  });

  it('keeps, even under force, an index map entry someone added since the read when the agent leaves the map out', () => {
    const doc = small(undefined, { dsOverrides: { '--ds-color-bg': '#ffffff' } });
    const base = deckFiles(doc);
    transact(doc, () => Y.setDeckEntry(doc, 'dsOverrides', '--ds-color-text', '#111111'));
    const sent = JSON.parse(base[DECK_PATH]!) as Record<string, unknown>;
    delete sent.dsOverrides;
    publish(doc, base, { [DECK_PATH]: JSON.stringify(sent) }, true);
    expect({ ...readDeckJson(doc).dsOverrides }).toEqual({ '--ds-color-text': '#111111' });
  });

  it('refuses deleting an element whose place changed since the read (sent to the front)', () => {
    const doc = small('<section id="s1"><p id="a" style="position:absolute;left:0px;top:0px">A</p><p id="b">B</p></section>');
    const base = deckFiles(doc);
    zOrder(doc, 's1', 'a', 'front');
    expect(publish(doc, base, { [S]: '<section id="s1"><p id="b">B</p></section>' }).conflicts).toEqual([{ path: S, detail: 'element a: changed since your read' }]);
  });

  it('refuses, and under force places as the agent did, an element both re-parented into one list at different places', () => {
    const html = '<section id="s1"><div id="g"><p id="x">X</p></div><div id="h"><p id="a">A</p><p id="b">B</p></div></section>';
    const sent = '<section id="s1"><div id="g"></div><div id="h"><p id="x">X</p><p id="a">A</p><p id="b">B</p></div></section>';
    const doc = small(html);
    const base = deckFiles(doc);
    moveInto(doc, 's1', 'x', 'h'); // to the end of h
    expect(publish(doc, base, { [S]: sent }).conflicts).toEqual([{ path: S, detail: 'order in h: changed since your read' }]);
    publish(doc, base, { [S]: sent }, true);
    expect(readSlide(doc, 's1').children.find((c) => c.id === 'h')!.children.map((c) => c.id)).toEqual(['x', 'a', 'b']);
    // both at the same place: no conflict
    const same = small(html);
    const read = deckFiles(same);
    moveInto(same, 's1', 'x', 'h');
    expect(publish(same, read, { [S]: sent.replace('<p id="x">X</p><p id="a">A</p><p id="b">B</p>', '<p id="a">A</p><p id="b">B</p><p id="x">X</p>') }).conflicts).toEqual([]);
  });

  it('writes nothing for a slide created since the read that equals the sent one by meaning', () => {
    const doc = small();
    const base = deckFiles(doc);
    const source = '<section id="s2"><p id="x">X</p></section>';
    publishDeck(doc, deckFiles(doc), { [P('s2')]: source }, false);
    expect(publish(doc, base, { [P('s2')]: source })).toMatchObject({ conflicts: [], changed: [], updates: 0 });
    expect(publish(doc, base, { [P('s2')]: '<section id="s2"><p id="x">Y</p></section>' }).conflicts).toEqual([{ path: P('s2'), detail: 'slide: created since your read' }]);
  });

  it('keeps any index key, `__proto__` included at the top and nested, from the loader through the model to the file', () => {
    const doc = newDoc();
    const index = '{"v":4,"order":["s1"],"__proto__":{"keep":true,"__proto__":{"deep":1}},"\\u0001odd":2,"sections":{"__proto__":{"description":"x","start":"s1"}}}';
    publish(doc, {}, { [DECK_PATH]: index, [S]: '<section id="s1"></section>' });
    const file = deckFiles(doc)[DECK_PATH]!;
    const back = JSON.parse(file) as Record<string, unknown>;
    expect(Object.hasOwn(back, '__proto__')).toBe(true);
    expect(JSON.stringify(back['__proto__'])).toBe('{"keep":true,"__proto__":{"deep":1}}');
    expect(back['\u0001odd']).toBe(2);
    expect(Object.hasOwn(back.sections as object, '__proto__')).toBe(true);
    expect(publish(doc, deckFiles(doc), deckFiles(doc)).updates).toBe(0);
    // and changed by a later publish key by key
    const changed = file.replace('"keep": true', '"keep": false');
    expect(changed).not.toBe(file);
    expect(publish(doc, deckFiles(doc), { [DECK_PATH]: changed }).conflicts).toEqual([]);
    expect(JSON.stringify((JSON.parse(deckFiles(doc)[DECK_PATH]!) as Record<string, unknown>)['__proto__'])).toBe('{"keep":false,"__proto__":{"deep":1}}');
  });

  it('merges disjoint marked text and note edits', () => {
    const doc = small('<section id="s1"><p id="a">Alpha beta gamma</p><aside>First second third</aside></section>');
    const base = deckFiles(doc);
    setText(doc, 's1', 'a', [{ type: 'p', inline: [{ text: 'Alpha beta GAMMA', marks: {} }] }]);
    setNotes(doc, 's1', 'First second THIRD');
    const sent = base[S]!.replace('Alpha beta gamma', '<b>ALPHA</b> beta gamma').replace('First second third', 'FIRST second third');
    expect(publish(doc, base, { [S]: sent }).conflicts).toEqual([]);
    expect(deckFiles(doc)[S]).toContain('<b>ALPHA</b> beta GAMMA');
    expect(Y.readNotes(doc, 's1')).toBe('FIRST second THIRD');
  });

  it('mints the same nested id-less parents and children in both calls despite a live addition', () => {
    const doc = small('<section id="s1"><p id="a">A</p></section>');
    const base = deckFiles(doc);
    const known = newDoc();
    applyV2(known, stateV2(doc));
    publishDeck(doc, deckFiles(doc), { [S]: '<section id="s1"><p id="a">A</p><p id="human">H</p></section>' }, false);
    const sent = { [S]: '<section id="s1"><p id="a">A</p><div><p>Nested</p></div></section>' };
    expect(publish(doc, base, sent).conflicts).toEqual([]);
    publishDeck(known, deckFiles(known), sent, true);
    expect(Y.elementIds(doc, 's1').filter((id) => id !== 'human').sort()).toEqual(Y.elementIds(known, 's1').sort());
  });

  it('refuses replacing a held file when live moved since that read', () => {
    const doc = small();
    publishDeck(doc, deckFiles(doc), { [S]: '<section id="s1"><iframe></iframe></section>' }, false);
    const heldBase = deckFiles(doc);
    publishDeck(doc, heldBase, { [S]: '<section id="s1"><p id="a">Owner replacement</p></section>' }, false);
    expect(publish(doc, heldBase, { [S]: '<section id="s1"><p id="a">Agent replacement</p></section>' }).conflicts).toEqual([{ path: S, detail: 'slide: changed since your read' }]);
  });
});
