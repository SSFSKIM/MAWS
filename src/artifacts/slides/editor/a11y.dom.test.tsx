// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D14, D15; the prior art's A1 to A5): the stage and the
// boards for assistive technology and the keyboard, asserted on roles, names, states and the focus (never spoken
// strings, which vary by screen reader). The live VoiceOver run is the decks round's.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { newDoc, onUpdate, transact, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { deleteElementTree, importSlide, readFlat, setAttrs, slideFile, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import { DesignWorkbench } from '../../design/editor/DesignWorkbench';
import { DesignView } from '../../design/editor/viewport';
import { design } from '../../design/fixtures/support';
import { armedBox } from './armed';
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

describe('P4-B2 (D15) A2 to A5: the focus follows the selection, the status says what it does not, never the body', () => {
  const SLIDE = `<section id="s" style="background:#ffffff">
<h1 id="title" style="font-size:64px">Quarterly plan</h1>
<div id="band" style="position:absolute; left:0px; top:0px; width:1920px; height:96px; background:#eef2f1"></div>
<x-shape id="dot" kind="ellipse" style="position:absolute; left:500px; top:800px; width:100px; height:100px; background:#2b7a78"></x-shape>
<x-icon id="star" name="Star" style="position:absolute; left:700px; top:800px; width:64px; height:64px; color:#2b7a78"></x-icon>
<table id="t" style="position:absolute; left:1300px; top:300px; width:400px"><tr id="r1"><th>A</th><td>1</td></tr></table>
</section>`;

  function mount(html = SLIDE) {
    const doc = deck(html);
    const session = new DeckSession(doc, 0);
    const { container } = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    const stage = container.querySelector<HTMLElement>('[data-stage-surface]')!;
    const node = (id: string) => stage.querySelector<HTMLElement>(`[data-eid="${id}"]`)!;
    const box = (id: string) => node(id).querySelector<HTMLElement>('.deck-textbox');
    const status = () => stage.querySelector('[role="status"][data-stage-status]')!.textContent;
    const notes = container.querySelector<HTMLTextAreaElement>('.deck-notes-field')!;
    const toolbar = container.querySelector<HTMLElement>('.deck-toolbar')!;
    const order = () => Array.from(node('title').parentElement!.children, (n) => (n as HTMLElement).dataset.eid);
    act(() => stage.focus());
    const key = (init: KeyboardEventInit) => act(() => void (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
    return { doc, session, stage, node, box, status, notes, toolbar, order, key };
  }

  // Chromium drops the focus to the body when the focused node, or a node holding it, is moved (`insertBefore`, as the
  // canvas reorders its nodes); happy-dom keeps it. Emulated for one test, restored after it.
  function chromiumMoves() {
    const insertBefore = Node.prototype.insertBefore;
    let dropped = 0;
    Node.prototype.insertBefore = function <T extends Node>(this: Node, moved: T, before: Node | null): T {
      const active = moved.ownerDocument?.activeElement;
      if (moved.isConnected && active instanceof HTMLElement && moved.contains(active)) {
        active.blur();
        dropped++;
      }
      return insertBefore.call(this, moved, before) as T;
    };
    onTestFinished(() => {
      Node.prototype.insertBefore = insertBefore;
    });
    return { dropped: () => dropped };
  }

  it('A3: the armed box for one text element, the node for one other, the stage for several or none; a focus on a node selects it', () => {
    const { session, stage, node, box } = mount();
    act(() => session.select(['band']));
    expect(document.activeElement).toBe(node('band'));
    act(() => session.select(['title']));
    expect(document.activeElement).toBe(box('title'));
    act(() => session.select(['band', 'dot']));
    expect(document.activeElement).toBe(stage);
    act(() => session.select([]));
    expect(document.activeElement).toBe(stage);
    act(() => node('dot').focus()); // VoiceOver's focus brought to a node
    expect(session.snapshot().selection).toEqual(['dot']);
    expect(document.activeElement).toBe(node('dot'));
  });

  it('A3: the keys reach the stage from a focused node (Tab walks, Delete removes), and nothing takes the focus back from outside the stage', () => {
    const { doc, session, node, notes, key } = mount();
    act(() => session.select(['band']));
    key({ key: 'Tab' });
    expect([session.snapshot().selection, document.activeElement]).toEqual([['dot'], node('dot')]);
    act(() => notes.focus());
    act(() => session.select(['star']));
    expect(document.activeElement).toBe(notes); // the keyboard is away: the selection changes, the focus stays
    act(() => node('star').focus());
    key({ key: 'Delete' });
    expect(Y.hasElement(doc, 's', 'star')).toBe(false);
  });

  it('A5: whenever the focused node or editor goes, the focus goes to the stage or the next selection, never the body', () => {
    const { doc, session, stage, node, box, key } = mount();
    act(() => session.select(['band']));
    key({ key: 'Delete' }); // the focused node removed
    expect(document.activeElement).toBe(stage);
    act(() => session.select(['dot']));
    act(() => transact(doc, () => deleteElementTree(doc, 's', 'dot'), 'remote')); // another replica deletes it
    expect(document.activeElement).toBe(stage);
    act(() => session.select(['star']));
    const before = node('star');
    act(() => setAttrs(doc, 's', 'star', { name: 'Clock' }, 'remote')); // an agent's change makes its node anew
    expect(node('star')).not.toBe(before);
    expect(document.activeElement).toBe(node('star'));
    const [cell] = cellsOf(doc);
    act(() => session.editText(cell!));
    expect(document.activeElement).toBe(box(cell!));
    key({ key: 'Escape' }); // T17 from a cell: the table selected, its node focused
    expect([session.snapshot().selection, document.activeElement]).toEqual([['t'], node('t')]);
    act(() => session.select(['title']));
    key({ key: 'Escape' }); // ARMED at the top level: nothing selected
    expect(document.activeElement).toBe(stage);
  });

  it('A5: a focused node the canvas moves (⌘], Chromium dropping its focus to the body) takes the focus back, the keys with it', () => {
    const moves = chromiumMoves();
    const { session, node, order, key } = mount();
    act(() => session.select(['band']));
    expect(document.activeElement).toBe(node('band'));
    const before = order();
    key({ key: ']', metaKey: true });
    expect(order()).not.toEqual(before);
    expect(moves.dropped()).toBe(1);
    expect([session.snapshot().selection, session.snapshot().keyboard, document.activeElement]).toEqual([['band'], 'stage', node('band')]);
    const again = order();
    key({ key: ']', metaKey: true }); // the element keys still reach the stage
    expect(order()).not.toEqual(again);
    expect(document.activeElement).toBe(node('band'));
  });

  it('A5: the armed box of a pinned text element the canvas moves (⌘]) takes the focus back', () => {
    const moves = chromiumMoves();
    const { session, box, order, key } = mount(SLIDE.replace('<div id="band"', '<p id="note" style="position:absolute; left:100px; top:500px; width:400px">Note</p>\n<div id="band"'));
    act(() => session.select(['note']));
    expect(document.activeElement).toBe(box('note'));
    const before = order();
    key({ key: ']', metaKey: true });
    expect(order()).not.toEqual(before);
    expect(moves.dropped()).toBe(1);
    expect(armedBox(session)?.elementId).toBe('note');
    expect(document.activeElement).toBe(box('note'));
  });

  it('A5: a focus the owner took away is never pulled back: after a press outside the stage, a write leaves it on the body', () => {
    const { doc, session, node, toolbar } = mount();
    act(() => session.select(['band']));
    expect(document.activeElement).toBe(node('band'));
    act(() => void toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));
    act(() => node('band').blur()); // the press landed on chrome that takes no focus: the body has it, with no focusin
    act(() => setAttrs(doc, 's', 'dot', { kind: 'rect' }, 'remote')); // any write
    expect([session.snapshot().keyboard, document.activeElement]).toEqual(['stage', document.body]);
  });

  it('A2: the status says a multi-selection’s count and nothing else; one element’s place rides on what its focus reads', () => {
    const { session, node, box, status } = mount();
    act(() => session.select(['band', 'dot']));
    expect(status()).toBe('2 elements selected');
    act(() => session.select(['dot']));
    expect(status()).toBe('');
    expect(node('dot').getAttribute('aria-description')).toBe('3 of 5');
    act(() => session.select(['title']));
    expect(node('dot').hasAttribute('aria-description')).toBe(false);
    expect(box('title')!.getAttribute('aria-description')).toBe('1 of 5');
    act(() => session.editText('title'));
    expect(status()).toBe('');
  });

  it('A4: the armed or editing box is a multi-line text field named as the element', () => {
    const { session, box } = mount();
    act(() => session.select(['title']));
    const root = box('title')!;
    expect([root.getAttribute('role'), root.getAttribute('aria-multiline'), root.getAttribute('aria-label')]).toEqual(['textbox', 'true', 'Heading 1']);
    act(() => session.editText('title'));
    expect(box('title')).toBe(root);
    expect(root.getAttribute('role')).toBe('textbox');
  });
});

function cellsOf(doc: Doc): string[] {
  return readFlat(doc, 's', false)
    .filter((e) => e.tag === 'th' || e.tag === 'td')
    .map((e) => e.id);
}

describe('P4-B2 (D14, tracker row 253): F6 and ⇧F6 cycle the editor’s regions, the selection kept', () => {
  const SLIDE = `<section id="s" style="background:#ffffff">
<h1 id="title" style="font-size:64px">Quarterly plan</h1>
<div id="band" style="position:absolute; left:0px; top:0px; width:1920px; height:96px; background:#eef2f1"></div>
<x-shape id="dot" kind="ellipse" style="position:absolute; left:500px; top:800px; width:100px; height:100px; background:#2b7a78"></x-shape>
<x-icon id="star" name="Star" style="position:absolute; left:700px; top:800px; width:64px; height:64px; color:#2b7a78"></x-icon>
</section>`;
  const key = (init: KeyboardEventInit) => act(() => void (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
  const f6 = (init: KeyboardEventInit = {}) => key({ key: 'F6', ...init });
  const within = (selector: string) => document.activeElement?.closest(selector) !== null && document.activeElement?.closest(selector) !== undefined;

  function mount(props: { bindsKey?: (event: KeyboardEvent) => boolean } = {}) {
    const doc = deck(SLIDE);
    const session = new DeckSession(doc, 0);
    const { container } = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} {...props} />);
    // UX2 keeps tools closed by default; this fixture exercises the ring with the inspector explicitly open.
    act(() => container.querySelector<HTMLButtonElement>('.deck-toolbar [aria-label="Inspector"]')!.click());
    const stage = container.querySelector<HTMLElement>('[data-stage-surface]')!;
    const node = (id: string) => stage.querySelector<HTMLElement>(`[data-eid="${id}"]`)!;
    const box = (id: string) => node(id).querySelector<HTMLElement>('.deck-textbox');
    act(() => stage.focus());
    return { doc, session, stage, node, box };
  }

  it('a middle element’s selection reaches the inspector by F6 and comes back by ⇧F6; the stage says its exit', () => {
    const { session, stage, node } = mount();
    expect(stage.getAttribute('aria-keyshortcuts')).toBe('F6');
    act(() => session.select(['dot'])); // neither the first nor the last: Tab leaves the stage only past an end
    f6();
    expect(within('[data-deck-inspector]')).toBe(true);
    expect(session.snapshot()).toMatchObject({ selection: ['dot'], keyboard: 'away' });
    f6({ shiftKey: true });
    expect([document.activeElement, session.snapshot().selection]).toEqual([node('dot'), ['dot']]);
  });

  it('T23: leaving the stage from ARMED drops to SEL (the box unmounts), coming back arms it again; an edit ends first', () => {
    const { session, box } = mount();
    act(() => session.select(['title']));
    expect(document.activeElement).toBe(box('title'));
    f6();
    expect(within('[data-deck-inspector]')).toBe(true);
    expect(armedBox(session)).toBeNull();
    expect(box('title')).toBeNull();
    expect(session.snapshot().selection).toEqual(['title']);
    f6({ shiftKey: true });
    expect(document.activeElement).toBe(box('title'));
    expect(armedBox(session)?.elementId).toBe('title');
    act(() => session.editText('title'));
    f6();
    expect(session.snapshot()).toMatchObject({ editingText: null, selection: ['title'] });
    expect(within('[data-deck-inspector]')).toBe(true);
  });

  it('the ring: the toolbar, the filmstrip’s current slide, the stage, the inspector (its last field), the notes, the open rail', () => {
    const { session, stage, node } = mount();
    act(() => session.select(['band']));
    f6({ shiftKey: true });
    expect(document.activeElement?.closest('[data-slide-thumb]')?.hasAttribute('data-current')).toBe(true);
    expect(session.snapshot().selection).toEqual(['band']); // the thumbnail's focus showed the slide already shown
    f6({ shiftKey: true });
    expect(within('.deck-toolbar')).toBe(true);
    f6({ shiftKey: true }); // around to the last region: the notes (no rail is open)
    expect(within('.deck-notes')).toBe(true);
    act(() => session.toggleRail('theme')); // a rail with something to focus (one with nothing is skipped)
    f6();
    expect(within('[data-deck-rail]')).toBe(true);
    f6();
    expect(within('.deck-toolbar')).toBe(true);
    // the inspector's last field is where F6 comes back to, for this selection or another
    act(() => stage.focus());
    f6({ shiftKey: true }); // the filmstrip
    f6(); // the stage: its selection's node
    expect(document.activeElement).toBe(node('band'));
    f6(); // the inspector
    const y = document.querySelector<HTMLElement>('[data-deck-inspector] input[aria-label="Y"]')!;
    act(() => y.focus());
    f6({ shiftKey: true });
    act(() => session.select(['dot']));
    f6();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Y');
    expect(within('[data-deck-inspector]')).toBe(true);
  });

  it('steps aside while an input method composes, and for a key the owner’s keymap binds', () => {
    const { session, node } = mount();
    act(() => session.select(['dot']));
    f6({ isComposing: true });
    f6({ keyCode: 229 });
    expect(document.activeElement).toBe(node('dot'));
    cleanup();
    const bound = mount({ bindsKey: (event) => event.key === 'F6' });
    act(() => bound.session.select(['dot']));
    f6();
    expect(document.activeElement).toBe(bound.node('dot'));
  });

  it('the board does the same: a selected element reaches the inspector and comes back armed', () => {
    const doc = design();
    const session = new DeckSession(doc, 0);
    const view = new DesignView();
    view.setRoom({ w: 1000, h: 800 });
    view.setViewport({ zoom: 1, x: 0, y: 0 });
    const { container } = render(<DesignWorkbench session={session} view={view} assetUrl={() => null} system={null} readOnly={false} />);
    const world = container.querySelector<HTMLElement>('[data-design-world]')!;
    const heading = container.querySelector<HTMLElement>('[data-board-id="b1"] [data-eid="title"]')!;
    expect(world.getAttribute('aria-keyshortcuts')).toBe('F6');
    act(() => {
      session.show('b1');
      session.select(['title']);
    });
    act(() => world.focus());
    expect(document.activeElement).toBe(heading.querySelector('.deck-textbox'));
    f6();
    expect(within('[data-design-rail="inspector"]')).toBe(true);
    expect(session.snapshot()).toMatchObject({ selection: ['title'], keyboard: 'away' });
    f6({ shiftKey: true });
    expect(document.activeElement).toBe(heading.querySelector('.deck-textbox'));
    f6({ shiftKey: true });
    expect(document.activeElement?.closest('[data-design-rail="boards"] [data-current]')).not.toBeNull();
    f6({ shiftKey: true });
    expect(within('.deck-toolbar')).toBe(true);
    f6({ shiftKey: true }); // no open rail: the inspector is the last region, not a second copy of it
    expect(within('[data-design-rail="inspector"]')).toBe(true);
    f6();
    expect(within('.deck-toolbar')).toBe(true);
    act(() => session.toggleRail('theme'));
    f6({ shiftKey: true });
    expect(within('[data-deck-rail="theme"]')).toBe(true);
    f6();
    expect(within('.deck-toolbar')).toBe(true);
  });
});
