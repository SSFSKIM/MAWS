// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer", "Inspector", "Insert"): the
// editor's element gestures on the model, one transaction each and never a value the loader would refuse: a restyle
// checked against the dialect, group and ungroup with offsets kept, elements inserted and pasted through the loader
// with ids re-minted on collision, the clipboard's dialect HTML, a table's rows and columns.
import { describe, expect, it } from 'vitest';
import { newDoc, onUpdate, transact, type Doc } from '../yjs';
import { childLists, importSlide, readFlat, readSlide, ROOT, slideFile, writeDeckKeys } from './model';
import { loadSlide, SHAPE_KINDS } from './parse';
import { copyElements, detachWithin, duplicateWithin, groupElements, insertElements, newElement, pasteElements, restyle, setStyles, tableColumn, tableRow, ungroup } from './writers-elements';

function deckWith(section: string): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    const l = loadSlide(section);
    if (!l.ok) throw new Error(`fixture: ${l.held.reasons.join('; ')}`);
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}
const reload = (doc: Doc) => {
  const l = loadSlide(slideFile(doc, 's'), { fileId: 's' });
  if (!l.ok) throw new Error(`does not load: ${l.held.reasons.join('; ')}`);
  return l;
};
function updatesOf(doc: Doc, edit: () => void): number {
  let n = 0;
  const off = onUpdate(doc, () => n++);
  edit();
  off();
  return n;
}
const styleOf = (doc: Doc, id: string) => readFlat(doc, 's', false).find((e) => e.id === id)!.style;
const parentOf = (doc: Doc, id: string) => readFlat(doc, 's', false).find((e) => e.id === id)!.parent;

const PINNED = `<section id="s" style="background:#ffffff; padding:128px">
<p id="t" style="font-size:40px">Title</p>
<div id="a" style="position:absolute; left:100px; top:200px; width:300px; height:100px; background:#ff0000"></div>
<x-shape id="b" kind="ellipse" style="position:absolute; left:500px; top:260px; width:200px; height:200px; background:#00ff00"></x-shape>
<div id="c" style="position:absolute; right:128px; bottom:128px; width:100px; height:100px; background:#0000ff"></div>
</section>`;

describe('a restyle', () => {
  it('writes values the dialect takes, normalized, in one transaction', () => {
    const doc = deckWith(PINNED);
    expect(updatesOf(doc, () => expect(restyle(doc, 's', 'a', { background: 'RGB(0, 0, 255)', 'border-radius': '12px', opacity: '0.5' }, 'ed')).toEqual([]))).toBe(1);
    expect(styleOf(doc, 'a')).toMatchObject({ background: '#0000ff', 'border-radius': '12px', opacity: '0.5' });
    expect(restyle(doc, 's', 't', { 'font-family': 'var(--ds-font-display, Georgia, serif)' }, 'ed')).toEqual([]);
    expect(reload(doc).diagnostics).toEqual([]);
  });

  it('refuses a value outside its grammar, a property the element does not take, or past a limit, writing nothing', () => {
    const doc = deckWith(PINNED);
    const before = slideFile(doc, 's');
    expect(updatesOf(doc, () => expect(restyle(doc, 's', 'a', { opacity: '2', background: '#00ff00' }, 'ed')).toHaveLength(1))).toBe(0);
    expect(restyle(doc, 's', 't', { 'object-fit': 'cover' }, 'ed')[0]).toMatch(/object-fit/);
    expect(restyle(doc, 's', 'a', { border: '20px solid #000000' }, 'ed')[0]).toMatch(/16px/);
    expect(restyle(doc, 's', 'a', { color: 'var(--other)' }, 'ed')).toHaveLength(1);
    expect(slideFile(doc, 's')).toBe(before);
  });

  it('removes with null; the section by its own id', () => {
    const doc = deckWith(PINNED);
    expect(restyle(doc, 's', 'a', { opacity: null }, 'ed')).toEqual([]);
    expect(restyle(doc, 's', ROOT, { background: '#fbfbf8' }, 'ed')).toEqual([]);
    expect(readSlide(doc, 's').style.background).toBe('#fbfbf8');
  });

  it('setStyles writes a gesture frame for several elements in one transaction', () => {
    const doc = deckWith(PINNED);
    expect(updatesOf(doc, () => setStyles(doc, 's', { a: { left: '110px' }, b: { left: '510px', top: '270px' } }, 'ed'))).toBe(1);
    expect(styleOf(doc, 'b')).toMatchObject({ left: '510px', top: '270px' });
  });
});

describe('group and ungroup', () => {
  it('groups pinned siblings into a pinned data-group div at their bounds, offsets kept, one transaction', () => {
    const doc = deckWith(PINNED);
    const boxes = new Map([
      ['a', { x: 100, y: 200, w: 300, h: 100 }],
      ['b', { x: 500, y: 260, w: 200, h: 200 }],
    ]);
    let group = '';
    expect(updatesOf(doc, () => (group = groupElements(doc, 's', ['b', 'a'], boxes, 'ed')))).toBe(1);
    expect(styleOf(doc, group)).toMatchObject({ position: 'absolute', left: '100px', top: '200px', width: '600px', height: '260px' });
    expect(readFlat(doc, 's', false).find((e) => e.id === group)!.attrs['data-group']).toBe('');
    expect([parentOf(doc, 'a'), parentOf(doc, 'b')]).toEqual([group, group]);
    expect(styleOf(doc, 'a')).toMatchObject({ left: '0px', top: '0px' });
    expect(styleOf(doc, 'b')).toMatchObject({ left: '400px', top: '60px' });
    // the members keep their paint order inside the group, the group takes the topmost member's place among c
    const lists = childLists(readFlat(doc, 's', false));
    expect(lists.get(group)!.map((e) => e.id)).toEqual(['a', 'b']);
    expect(lists.get(ROOT)!.map((e) => e.id)).toEqual(['t', group, 'c']);
    expect(reload(doc).diagnostics).toEqual([]);
  });

  it('a right/bottom pinned member is placed by its measured box', () => {
    const doc = deckWith(PINNED);
    const group = groupElements(
      doc,
      's',
      ['a', 'c'],
      new Map([
        ['a', { x: 100, y: 200, w: 300, h: 100 }],
        ['c', { x: 1692, y: 852, w: 100, h: 100 }],
      ]),
      'ed',
    );
    expect(styleOf(doc, 'c')).toEqual(expect.objectContaining({ left: '1592px', top: '652px' }));
    expect(styleOf(doc, 'c').right).toBeUndefined();
    expect(styleOf(doc, group)).toMatchObject({ width: '1692px', height: '752px' });
  });

  it('ungroups back to the parent with the group’s offset added, in the group’s place', () => {
    const doc = deckWith(PINNED);
    const group = groupElements(
      doc,
      's',
      ['a', 'b'],
      new Map([
        ['a', { x: 100, y: 200, w: 300, h: 100 }],
        ['b', { x: 500, y: 260, w: 200, h: 200 }],
      ]),
      'ed',
    );
    setStyles(doc, 's', { [group]: { left: '150px' } }, 'ed'); // the group moved
    expect(updatesOf(doc, () => expect(ungroup(doc, 's', group, 'ed')).toEqual(['a', 'b']))).toBe(1);
    expect(styleOf(doc, 'a')).toMatchObject({ left: '150px', top: '200px' });
    expect(styleOf(doc, 'b')).toMatchObject({ left: '550px', top: '260px' });
    expect(childLists(readFlat(doc, 's', false)).get(ROOT)!.map((e) => e.id)).toEqual(['t', 'a', 'b', 'c']);
    expect(readFlat(doc, 's', false).some((e) => e.id === group)).toBe(false);
  });

  it('refuses flow elements, a single element and members of different parents', () => {
    const doc = deckWith(PINNED);
    const box = { x: 0, y: 0, w: 1, h: 1 };
    expect(() => groupElements(doc, 's', ['a'], new Map([['a', box]]), 'ed')).toThrow(/two/);
    expect(() =>
      groupElements(
        doc,
        's',
        ['a', 't'],
        new Map([
          ['a', box],
          ['t', box],
        ]),
        'ed',
      ),
    ).toThrow(/pinned/);
  });
});

describe('insert and paste', () => {
  it('inserts a new element of each kind at the front, through the loader', () => {
    const doc = deckWith(PINNED);
    for (const kind of ['text', 'heading', 'bullets', 'numbers', 'shape:ellipse', 'icon:Star', 'image:assets/p.png', 'table:2x3', 'line', 'connector'] as const) {
      const el = newElement(kind, { x: 960, y: 540 });
      const [id] = insertElements(doc, 's', [el], {}, 'ed');
      expect(childLists(readFlat(doc, 's', false)).get(ROOT)!.at(-1)!.id).toBe(id);
    }
    const loaded = reload(doc);
    expect(loaded.diagnostics).toEqual([]);
    const tags = loaded.slide.children.map((c) => c.tag);
    expect(tags).toEqual(expect.arrayContaining(['p', 'h2', 'ul', 'ol', 'x-shape', 'x-icon', 'img', 'table', 'x-connector']));
    const table = loaded.slide.children.find((c) => c.tag === 'table')!;
    expect(table.children).toHaveLength(2);
    expect(table.children[0]!.children).toHaveLength(3);
  });

  // W1 (tech debt, 2026-10-19): the accent appears once on a slide, so it is never a default; the owner picks it
  it('a new shape of every kind takes the raised surface with a border edge, never the accent', () => {
    for (const kind of SHAPE_KINDS) {
      const el = newElement(`shape:${kind}`, { x: 960, y: 540 });
      expect(el.style.background, kind).toBe('var(--ds-color-bg-raised, #ffffff)');
      expect(el.style.border, kind).toBe('2px solid var(--ds-color-border, #e3e2df)');
      expect(JSON.stringify(el.style), kind).not.toContain('--ds-color-accent');
    }
  });

  it('copies the selection as a slide file and pastes it into another deck with every id kept', () => {
    const from = deckWith(PINNED);
    const html = copyElements(from, 's', ['b', 'a']);
    expect(html).toMatch(/^<section id="clipboard"/);
    expect(loadSlide(html).ok).toBe(true);
    const to = deckWith(`<section id="s" style="background:#ffffff"><p id="x" style="font-size:40px">Other</p></section>`);
    const pasted = pasteElements(to, 's', html, { offset: 24 }, 'ed');
    expect(pasted).toEqual({ ok: true, ids: ['a', 'b'] });
    expect(styleOf(to, 'a')).toMatchObject({ left: '100px', top: '200px' }); // no collision: where it was
  });

  it('a paste into the slide it came from re-mints colliding ids and offsets the copies', () => {
    const doc = deckWith(PINNED);
    const html = copyElements(doc, 's', ['a']);
    const pasted = pasteElements(doc, 's', html, { offset: 24 }, 'ed');
    if (!pasted.ok) throw new Error(pasted.reason);
    const [id] = pasted.ids;
    expect(id).not.toBe('a');
    expect(styleOf(doc, id!)).toMatchObject({ left: '124px', top: '224px', background: '#ff0000' });
    expect(reload(doc).diagnostics).toEqual([]);
  });

  it('pastes flow elements after the selected flow element, and refuses what does not load', () => {
    const doc = deckWith(PINNED);
    const html = copyElements(doc, 's', ['t']);
    const pasted = pasteElements(doc, 's', html, { after: 't' }, 'ed');
    expect(pasted.ok).toBe(true);
    expect(childLists(readFlat(doc, 's', false)).get(ROOT)!.filter((e) => e.tag === 'p')).toHaveLength(2);
    expect(pasteElements(doc, 's', '<section id="clipboard"><blink>x</blink></section>', {}, 'ed')).toMatchObject({ ok: false });
  });

  it('refuses past 24 pinned children of one host', () => {
    const doc = deckWith(`<section id="s" style="background:#ffffff">${Array.from({ length: 24 }, (_, i) => `<div id="d${i}" style="position:absolute; left:${i}px; top:0px; width:10px; height:10px; background:#000000"></div>`).join('')}</section>`);
    expect(() => insertElements(doc, 's', [newElement('shape:rect', { x: 0, y: 0 })], {}, 'ed')).toThrow(/24/);
  });
});

describe('duplicate and detach within the limits', () => {
  it('duplicates beside the original, refusing past 24 pinned children', () => {
    const doc = deckWith(PINNED);
    const copies = duplicateWithin(doc, 's', ['a'], 24, 'ed');
    expect(styleOf(doc, copies.get('a')!)).toMatchObject({ left: '124px', top: '224px' });
    const full = deckWith(`<section id="s" style="background:#ffffff">${Array.from({ length: 24 }, (_, i) => `<div id="d${i}" style="position:absolute; left:${i}px; top:0px; width:10px; height:10px; background:#000000"></div>`).join('')}</section>`);
    expect(() => duplicateWithin(full, 's', ['d0'], 24, 'ed')).toThrow(/24/);
  });

  it('detaches a flow child to pinned at its measured box', () => {
    const doc = deckWith(PINNED);
    detachWithin(doc, 's', 't', { left: 128, top: 128, width: 600 }, 'ed');
    expect(styleOf(doc, 't')).toMatchObject({ position: 'absolute', left: '128px', top: '128px', width: '600px' });
    expect(reload(doc).diagnostics).toEqual([]);
  });
});

describe('table rows and columns', () => {
  const TABLE = `<section id="s" style="background:#ffffff"><table id="tb" style="font-size:28px"><tr id="r1"><th>A</th><th>B</th></tr><tr id="r2"><td>1</td><td>2</td></tr></table></section>`;

  it('adds and removes rows and columns, each one transaction', () => {
    const doc = deckWith(TABLE);
    expect(updatesOf(doc, () => tableRow(doc, 's', 'tb', { add: 'r2' }, 'ed'))).toBe(1);
    expect(updatesOf(doc, () => tableColumn(doc, 's', 'tb', { add: 0 }, 'ed'))).toBe(1);
    let table = reload(doc).slide.children[0]!;
    expect(table.children).toHaveLength(3);
    expect(table.children.map((r) => r.children.map((c) => c.tag))).toEqual([
      ['th', 'th', 'th'],
      ['td', 'td', 'td'],
      ['td', 'td', 'td'],
    ]);
    expect(table.children[0]!.children.map((c) => c.text?.[0]?.inline.map((r) => ('text' in r ? r.text : '')).join('') ?? '')).toEqual(['A', '', 'B']);
    tableColumn(doc, 's', 'tb', { remove: 0 }, 'ed');
    tableRow(doc, 's', 'tb', { remove: 'r1' }, 'ed');
    table = reload(doc).slide.children[0]!;
    expect(table.children.map((r) => r.children.length)).toEqual([2, 2]);
    expect(() => tableRow(doc, 's', 'tb', { remove: 'r2' }, 'ed')).not.toThrow();
    expect(() => tableRow(doc, 's', 'tb', { remove: table.children[1]!.id }, 'ed')).toThrow(/last row/);
  });
});

// ---------------------------------------------------------------- fix wave 1 (the M5 task review's reproductions)

describe('fix wave 1: refusals write nothing, and nothing written is held', () => {
  const pin = (i: number) => `<div id="d${i}" style="position:absolute; left:${100 + i * 20}px; top:200px; width:10px; height:10px; background:#ff0000"></div>`;
  const two = new Map([
    ['d0', { x: 100, y: 200, w: 10, h: 10 }],
    ['d1', { x: 120, y: 200, w: 10, h: 10 }],
  ]);
  const section = (body: string) => deckWith(`<section id="s" style="background:#ffffff">${body}</section>`);
  /** The refusal leaves the slide's file and the replica untouched. */
  function refuses(doc: Doc, write: () => unknown, reason: RegExp) {
    const before = slideFile(doc, 's');
    let n = 0;
    const off = onUpdate(doc, () => n++);
    expect(write).toThrow(reason);
    off();
    expect(n).toBe(0);
    expect(slideFile(doc, 's')).toBe(before);
  }

  it('a group refused for a member in % writes nothing', () => {
    const doc = section(`${pin(0)}<x-connector id="percent" x1="10%" y1="20%" x2="50%" y2="80%"></x-connector>`);
    refuses(doc, () => groupElements(doc, 's', ['d0', 'percent'], new Map([...two, ['percent', { x: 192, y: 216, w: 768, h: 648 }]]), 'ed'), /cannot move between hosts/);
  });

  it('an ungroup refused past the destination’s 24 pinned children writes nothing', () => {
    const doc = section(Array.from({ length: 24 }, (_, i) => pin(i)).join(''));
    const g = groupElements(doc, 's', ['d0', 'd1'], two, 'ed');
    insertElements(doc, 's', [newElement('shape:rect', { x: 900, y: 500 })], {}, 'ed');
    refuses(doc, () => ungroup(doc, 's', g, 'ed'), /25 pinned children/);
  });

  it('a group that would put an x-embed below the section is refused', () => {
    const doc = section(`${pin(0)}<x-embed id="embed" style="position:absolute; left:400px; top:300px; width:200px; height:200px"><p>Live</p></x-embed>`);
    refuses(doc, () => groupElements(doc, 's', ['d0', 'embed'], new Map([...two, ['embed', { x: 400, y: 300, w: 200, h: 200 }]]), 'ed'), /x-embed/);
  });

  it('a group past 200 elements is refused', () => {
    const doc = section(pin(0) + pin(1) + Array.from({ length: 198 }, (_, i) => `<p id="p${i}">x</p>`).join(''));
    refuses(doc, () => groupElements(doc, 's', ['d0', 'd1'], two, 'ed'), /201 elements/);
  });

  it('an insert or a duplicate past the slide’s 20,000 characters is refused', () => {
    const doc = section(`<p id="p">${'a'.repeat(19999)}</p>`);
    refuses(doc, () => insertElements(doc, 's', [newElement('text', { x: 900, y: 500 })], {}, 'ed'), /characters of text/);
    const d2 = section(`<p id="p">${'b'.repeat(10001)}</p>`);
    refuses(d2, () => duplicateWithin(d2, 's', ['p'], 24, 'ed'), /characters of text/);
  });

  it('ungrouping a turned group keeps each child where it is drawn: the rotation folds into the child', () => {
    const doc = section(pin(0) + pin(1));
    const g = groupElements(doc, 's', ['d0', 'd1'], two, 'ed');
    setStyles(doc, 's', { [g]: { transform: 'rotate(90deg)' } }, 'ed');
    // the group is 30 × 10 at (100, 200), centre (115, 205); d0's centre (105, 205) turns to (115, 195)
    ungroup(doc, 's', g, 'ed');
    expect(styleOf(doc, 'd0')).toMatchObject({ left: '110px', top: '190px', transform: 'rotate(90deg)' });
    expect(styleOf(doc, 'd1')).toMatchObject({ left: '110px', top: '210px', transform: 'rotate(90deg)' });
    expect(reload(doc).diagnostics).toEqual([]);
  });

  it('an ungroup whose children’s pose the dialect cannot write (scale past 2) is refused', () => {
    const doc = section(pin(0) + pin(1));
    setStyles(doc, 's', { d0: { transform: 'scale(2)' } }, 'ed');
    const g = groupElements(doc, 's', ['d0', 'd1'], two, 'ed');
    setStyles(doc, 's', { [g]: { transform: 'scale(1.5)' } }, 'ed');
    refuses(doc, () => ungroup(doc, 's', g, 'ed'), /scale/);
  });
});

// ---------------------------------------------------------------- fix wave 2 (the M5 re-review's reproductions)

describe('fix wave 2: re-parenting keeps sizes, translations and routes', () => {
  const section = (body: string) => deckWith(`<section id="s" style="background:#ffffff">${body}</section>`);
  const attrsOf = (doc: Doc, id: string) => readFlat(doc, 's', false).find((e) => e.id === id)!.attrs;
  function refuses(doc: Doc, write: () => unknown, reason: RegExp) {
    const before = slideFile(doc, 's');
    let n = 0;
    const off = onUpdate(doc, () => n++);
    expect(write).toThrow(reason);
    off();
    expect(n).toBe(0);
    expect(slideFile(doc, 's')).toBe(before);
  }

  it('a member sized in % of the slide keeps its size inside the group, and a child in % of the group outside it', () => {
    const doc = section(`<div id="a" style="position:absolute; left:100px; top:100px; width:50%; height:100px; background:#ff0000"></div><div id="b" style="position:absolute; left:1100px; top:100px; width:100px; height:100px; background:#0000ff"></div>`);
    const g = groupElements(
      doc,
      's',
      ['a', 'b'],
      new Map([
        ['a', { x: 100, y: 100, w: 960, h: 100 }],
        ['b', { x: 1100, y: 100, w: 100, h: 100 }],
      ]),
      'ed',
    );
    expect(styleOf(doc, 'a').width).toBe('960px');
    setStyles(doc, 's', { a: { width: '50%' } }, 'ed'); // half the group's 1100 px
    ungroup(
      doc,
      's',
      g,
      'ed',
      new Map([
        ['a', { x: 0, y: 0, w: 550, h: 100 }],
        ['b', { x: 1000, y: 0, w: 100, h: 100 }],
      ]),
    );
    expect(styleOf(doc, 'a')).toMatchObject({ left: '100px', width: '550px' });
  });

  it('ungrouping a group moved by a translate keeps its children where they are drawn', () => {
    const doc = section(`<div id="g" data-group="" style="position:absolute; left:100px; top:100px; width:300px; height:100px; transform:translate(100px, 50px)"><div id="a" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background:#ff0000"></div><div id="b" style="position:absolute; left:200px; top:0px; width:100px; height:100px; background:#0000ff"></div></div>`);
    ungroup(doc, 's', 'g', 'ed');
    expect(styleOf(doc, 'a')).toMatchObject({ left: '200px', top: '150px' });
    expect(styleOf(doc, 'a').transform).toBeUndefined();
  });

  it('a group whose transform cannot be read is not ungrouped, nothing written', () => {
    const doc = section(`<div id="g" data-group="" style="position:absolute; left:100px; top:100px; width:300px; height:100px; transform:translate(var(--ds-shift, 10px), 0px)"><div id="a" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background:#ff0000"></div><div id="b" style="position:absolute; left:200px; top:0px; width:100px; height:100px; background:#0000ff"></div></div>`);
    refuses(doc, () => ungroup(doc, 's', 'g', 'ed'), /cannot be read/);
  });

  it('a routed connector in a turned group keeps its drawn route: hv turned a quarter is vh; a route with no equal is refused', () => {
    const doc = section(`<div id="g" data-group="" style="position:absolute; left:300px; top:300px; width:200px; height:200px; transform:rotate(90deg)"><x-connector id="line" x1="0" y1="0" x2="100" y2="100" route="hv"></x-connector><div id="d" style="position:absolute; left:150px; top:150px; width:50px; height:50px; background:#000000"></div></div>`);
    ungroup(doc, 's', 'g', 'ed');
    expect(attrsOf(doc, 'line')).toMatchObject({ x1: '500', y1: '300', x2: '400', y2: '400', route: 'vh' });
    const turned = section(`<div id="g" data-group="" style="position:absolute; left:300px; top:300px; width:200px; height:200px; transform:rotate(45deg)"><x-connector id="line" x1="0" y1="0" x2="100" y2="100" route="hv"></x-connector><div id="d" style="position:absolute; left:150px; top:150px; width:50px; height:50px; background:#000000"></div></div>`);
    refuses(turned, () => ungroup(turned, 's', 'g', 'ed'), /route/);
  });
});
