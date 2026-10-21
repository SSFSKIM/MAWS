// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D14, D15; the prior art's A1 to A5): the stage and the
// boards for assistive technology and the keyboard, asserted on roles, names, states and the focus (never spoken
// strings, which vary by screen reader). The live VoiceOver run is the decks round's.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, onUpdate, transact, type Doc } from '../../yjs';
import { deleteElementTree, importSlide, setAttrs, slideFile, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import { DeckEditor } from './DeckEditor';
import { DeckSession } from './session';

function deck(html: string): Doc {
  const doc = newDoc();
  const l = loadSlide(html);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('P4-B2 (D15) A1: every element of the shown slide is a node assistive technology reads, named on the stage alone', () => {
  const KINDS = `<section id="s" style="background:#ffffff">
<h1 id="title" style="font-size:64px">Quarterly plan</h1>
<div id="g" data-group="" style="position:absolute; left:100px; top:400px; width:800px; height:300px"><p id="g1" style="position:absolute; left:0px; top:0px; width:400px">One</p><p id="g2" style="position:absolute; left:0px; top:100px; width:400px">Two</p></div>
<div id="card" style="position:absolute; left:1000px; top:100px; width:300px; height:200px"><p id="c1" style="position:absolute; left:0px; top:0px; width:200px">In</p></div>
<div id="band" style="position:absolute; left:0px; top:0px; width:1920px; height:96px; background:#eef2f1"></div>
<img id="bare" src="assets/a.png" style="position:absolute; left:100px; top:800px; width:100px; height:100px">
<img id="cat" src="assets/b.png" alt="A cat" style="position:absolute; left:300px; top:800px; width:100px; height:100px">
<x-shape id="dot" kind="ellipse" style="position:absolute; left:500px; top:800px; width:100px; height:100px; background:#2b7a78"></x-shape>
<x-icon id="star" name="PaperPlane" style="position:absolute; left:700px; top:800px; width:64px; height:64px; color:#2b7a78"></x-icon>
<x-connector id="arrow" x1="320" y1="300" x2="672" y2="300" route="hv" style="color:#2b7a78; border-width:3px"></x-connector>
<svg id="chart" viewBox="0 0 10 10" style="position:absolute; left:900px; top:800px; width:100px; height:100px"><rect width="10" height="10"/></svg>
<svg id="bars" aria-label="Bars" viewBox="0 0 10 10" style="position:absolute; left:1100px; top:800px; width:100px; height:100px"><rect width="10" height="10"/></svg>
<x-embed id="live" style="position:absolute; left:1300px; top:700px; width:300px; height:200px"><p>hi</p></x-embed>
<table id="t" style="position:absolute; left:1300px; top:300px; width:400px"><tr id="r1"><th>A</th><td>1</td></tr></table>
</section>`;

  function mount() {
    const doc = deck(KINDS);
    const before = slideFile(doc, 's');
    let updates = 0;
    const off = onUpdate(doc, () => updates++);
    const session = new DeckSession(doc, 0);
    const { container } = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    const stage = container.querySelector<HTMLElement>('[data-stage-surface]')!;
    const node = (id: string) => stage.querySelector<HTMLElement>(`[data-eid="${id}"]`)!;
    const read = (id: string) => [node(id).getAttribute('role'), node(id).getAttribute('aria-label')];
    return { doc, session, container, stage, node, read, written: () => (off(), { updates, same: slideFile(doc, 's') === before }) };
  }

  it('names groups by what they hold, other kinds by their kind, a picture by its alt or “Image”; text and tables stay native', () => {
    const { read, node, stage } = mount();
    expect(read('g')).toEqual(['group', 'Group, 2 items']);
    expect(read('card')).toEqual(['group', 'Box, 1 item']);
    expect(read('band')).toEqual(['img', 'Box']);
    expect(read('bare')).toEqual([null, 'Image']);
    expect(read('cat')).toEqual([null, null]); // its own alt names it
    expect(node('cat').getAttribute('alt')).toBe('A cat');
    expect(read('dot')).toEqual(['img', 'Ellipse']);
    expect(read('star')).toEqual(['img', 'Paper plane icon']);
    expect(read('arrow')).toEqual(['img', 'Connector']);
    expect(read('chart')).toEqual(['img', 'Drawing']);
    expect(read('bars')).toEqual(['img', 'Bars']); // the model's own name wins
    expect(read('live')).toEqual(['img', 'Embed']);
    for (const id of ['title', 'g1', 't', 'r1']) expect(read(id), id).toEqual([null, null]);
    for (const n of stage.querySelectorAll('[data-eid]')) expect(n.getAttribute('tabindex'), (n as HTMLElement).dataset.eid).toBe('-1');
  });

  it('only the stage: the filmstrip’s thumbnails carry no role, name or tabindex, and the model is never written', () => {
    const { container, written } = mount();
    const thumbs = container.querySelectorAll('.deck-filmstrip [data-eid]');
    expect(thumbs.length).toBeGreaterThan(0);
    for (const n of thumbs) {
      const id = (n as HTMLElement).dataset.eid;
      expect([n.getAttribute('tabindex'), n.getAttribute('role'), n.getAttribute('aria-label')], id).toEqual([null, null, id === 'bars' ? 'Bars' /* the model's own */ : null]);
    }
    expect(written()).toEqual({ updates: 0, same: true });
  });

  it('follows the model: a group losing an element, a picture given an alt', () => {
    const { doc, read } = mount();
    act(() => transact(doc, () => deleteElementTree(doc, 's', 'g2')));
    expect(read('g')).toEqual(['group', 'Group, 1 item']);
    act(() => setAttrs(doc, 's', 'bare', { alt: 'A dog' }, 'remote'));
    expect(read('bare')).toEqual([null, null]);
  });
});
