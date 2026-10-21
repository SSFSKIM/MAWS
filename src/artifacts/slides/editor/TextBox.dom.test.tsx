// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Text in place", "Undo"): the text box edits a
// text element in place through @y/prosemirror 2's binding to the element's `<doc>` node, under happy-dom: typing and
// marks reach the model (and the slide file reloads clean), a remote patch reaches the editor, the bind writes nothing,
// the deck's one undo stack takes a typed burst as one step, a composition holds remote frames, and Escape or a
// pointerdown outside hands the element back to the canvas. Real IME input and paint are the e2e's.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyV1, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { SlideCanvas } from '../canvas';
import { importSlide, slideFile, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import { DeckSession } from './session';
import { TextBox } from './TextBox';

const SLIDE = `<section id="s1">
  <h2 id="title" style="font-size:64px">Plan <b>now</b>.</h2>
  <ul id="list"><li>One</li><li>Two</li></ul>
  <aside>Notes</aside>
</section>`;

function deck(): Doc {
  const doc = newDoc();
  const l = loadSlide(SLIDE);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s1'] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

/** The stage's part: the text box mounted while the session edits that element. */
function Harness({ session, canvas }: { session: DeckSession; canvas: SlideCanvas }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  return <div className="deck-stage-overlay">{state.editingText && <TextBox session={session} canvas={canvas} slideId="s1" elementId={state.editingText} />}</div>;
}

const canvases: SlideCanvas[] = [];
function mount(id: string, options: { doc?: Doc; holdRemote?: (on: boolean) => void } = {}) {
  const doc = options.doc ?? deck();
  const session = new DeckSession(doc, 0, { holdRemote: options.holdRemote });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const canvas = new SlideCanvas(doc, 's1', host);
  canvases.push(canvas);
  act(() => session.editText(id));
  render(<Harness session={session} canvas={canvas} />);
  const root = canvas.node(id)!.querySelector('.deck-textbox') as (HTMLElement & { editor: Editor }) | null;
  return { doc, session, canvas, root, editor: root?.editor as Editor };
}
afterEach(() => {
  cleanup();
  canvases.splice(0).forEach((c) => c.dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const MOD = /Mac|iP(hone|[oa]d)/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
const text = (doc: Doc, id: string) => Y.readText(doc, 's1', id);
const end = (editor: Editor) => editor.state.doc.content.size - 1;

describe('the text box', () => {
  it('mounts in the element’s own node, focused with its text selected, and writes nothing on bind', () => {
    const doc = deck();
    let updates = 0;
    const off = onUpdate(doc, () => updates++);
    const { root, editor, canvas } = mount('title', { doc });
    off();
    expect(updates).toBe(0);
    expect(root).not.toBeNull();
    expect(root!.parentElement).toBe(canvas.node('title'));
    expect(root!.textContent).toBe('Plan now.');
    expect(document.activeElement).toBe(root);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(end(editor));
  });

  it('an element without a text node gains an empty one of its kind, never an undo step', () => {
    const doc = deck();
    transact(doc, () => {
      Y.removeText(doc, 's1', 'title');
      Y.removeText(doc, 's1', 'list');
    });
    const { editor, session } = mount('list', { doc });
    expect(text(doc, 'list')).toEqual([{ type: 'li', inline: [] }]);
    act(() => void editor.commands.insertContent('First'));
    expect(text(doc, 'list')).toEqual([{ type: 'li', inline: [{ text: 'First', marks: {} }] }]);
    act(() => session.undoStep());
    expect(text(doc, 'list')).toEqual([{ type: 'li', inline: [] }]);
    expect(session.snapshot().canUndo).toBe(false);
  });

  it('typing and marks reach the model through the binding, and the slide file reloads clean', () => {
    const { doc, editor } = mount('title');
    act(() => {
      editor.commands.setTextSelection(end(editor));
      editor.commands.insertContent(' and ');
      editor.commands.insertContent('later');
      editor.chain().setTextSelection({ from: end(editor) - 5, to: end(editor) }).setMark('a', { href: 'https://x.dev' }).run();
      editor.chain().setTextSelection({ from: 1, to: 5 }).setMark('span', { color: '#cc0000' }).run();
    });
    expect(text(doc, 'title')).toEqual([
      {
        type: 'p',
        inline: [
          { text: 'Plan', marks: { span: { color: '#cc0000' } } },
          { text: ' ', marks: {} },
          { text: 'now', marks: { b: {} } },
          { text: '. and ', marks: {} },
          { text: 'later', marks: { a: { href: 'https://x.dev' } } },
        ],
      },
    ]);
    const file = slideFile(doc, 's1');
    const reloaded = loadSlide(file);
    expect(reloaded.ok).toBe(true);
    expect(reloaded.diagnostics).toEqual([]);
  });

  it('pasted HTML enters through the dialect’s rules: only https links, colour spans, strong and em as b and i', () => {
    const { doc, editor } = mount('title');
    act(() => void editor.commands.insertContent('<a href="http://x.dev">x</a><a href="https://y.dev">y</a><span style="color:#00ff00">g</span><span style="font-size:9px">n</span><strong>s</strong><em>e</em>'));
    expect(text(doc, 'title')[0]!.inline).toEqual([
      { text: 'x', marks: {} },
      { text: 'y', marks: { a: { href: 'https://y.dev' } } },
      { text: 'g', marks: { span: { color: '#00ff00' } } },
      { text: 'n', marks: {} },
      { text: 's', marks: { b: {} } },
      { text: 'e', marks: { i: {} } },
    ]);
  });

  it('a remote replica’s patch reaches the editor while it is mounted', () => {
    const { doc, root } = mount('title');
    const remote = newDoc();
    applyV1(remote, diffV1(doc));
    transact(remote, () => Y.patchText(remote, 's1', 'title', [{ type: 'p', inline: [{ text: 'Plan ', marks: {} }, { text: 'today', marks: { i: {} } }] }]));
    act(() => applyV1(doc, diffV1(remote, stateVector(doc)), 'remote'));
    expect(root!.innerHTML).toContain('<i>today</i>');
    expect(root!.textContent).toBe('Plan today');
  });

  it('Mod-b on a selection writes a b mark', () => {
    const { doc, editor, root } = mount('title');
    act(() => void editor.commands.setTextSelection({ from: 1, to: 5 }));
    act(() => void fireEvent.keyDown(root!, { key: 'b', ...MOD }));
    expect(text(doc, 'title')[0]!.inline[0]).toEqual({ text: 'Plan', marks: { b: {} } });
  });

  it('in a list Enter makes a new li; Shift-Enter a line break; Backspace at a later item’s start joins it back', () => {
    const { doc, editor, root } = mount('list');
    act(() => void editor.commands.setTextSelection(4)); // after "One"
    act(() => void fireEvent.keyDown(root!, { key: 'Enter' }));
    act(() => void editor.commands.insertContent('Half'));
    expect(text(doc, 'list').map((b) => b.type)).toEqual(['li', 'li', 'li']);
    expect(text(doc, 'list')[1]!.inline).toEqual([{ text: 'Half', marks: {} }]);
    act(() => void fireEvent.keyDown(root!, { key: 'Enter', shiftKey: true }));
    expect(text(doc, 'list')[1]!.inline).toEqual([{ text: 'Half', marks: {} }, { br: true }]);
    act(() => void editor.commands.setTextSelection(6)); // the start of the second li
    act(() => void fireEvent.keyDown(root!, { key: 'Backspace' }));
    expect(text(doc, 'list').map((b) => b.inline)).toEqual([[{ text: 'OneHalf', marks: {} }, { br: true }], [{ text: 'Two', marks: {} }]]);
  });

  it('in a one-block text Enter inserts a line break, never a second block', () => {
    const { doc, editor, root } = mount('title');
    act(() => void editor.commands.setTextSelection(5)); // after "Plan"
    act(() => void fireEvent.keyDown(root!, { key: 'Enter' }));
    expect(text(doc, 'title')).toHaveLength(1);
    expect(text(doc, 'title')[0]!.inline).toEqual([{ text: 'Plan', marks: {} }, { br: true }, { text: ' ', marks: {} }, { text: 'now', marks: { b: {} } }, { text: '.', marks: {} }]);
  });

  it('undo takes a typed burst back as one step through the deck’s undo stack; a pause starts another', () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { doc, editor, session } = mount('title');
    act(() => void editor.commands.setTextSelection(end(editor)));
    for (const ch of ['!', '!', '?']) act(() => void editor.commands.insertContent(ch));
    now += 2_000;
    for (const ch of [' ', 'o', 'k']) act(() => void editor.commands.insertContent(ch));
    expect(text(doc, 'title')[0]!.inline.at(-1)).toEqual({ text: '.!!? ok', marks: {} });
    act(() => session.undoStep());
    expect(text(doc, 'title')[0]!.inline.at(-1)).toEqual({ text: '.!!?', marks: {} });
    act(() => session.undoStep());
    expect(text(doc, 'title')[0]!.inline).toEqual([{ text: 'Plan ', marks: {} }, { text: 'now', marks: { b: {} } }, { text: '.', marks: {} }]);
    expect(editor.state.doc.textContent).toBe('Plan now.');
    act(() => session.redoStep());
    expect(editor.state.doc.textContent).toBe('Plan now.!!?');
  });

  it('Mod-z and Shift-Mod-z in the editor go to the deck’s undo stack', () => {
    const { doc, editor, root } = mount('title');
    act(() => void editor.commands.setTextSelection(end(editor)));
    act(() => void editor.commands.insertContent('!'));
    act(() => void fireEvent.keyDown(root!, { key: 'z', ...MOD }));
    expect(text(doc, 'title')[0]!.inline.at(-1)).toEqual({ text: '.', marks: {} });
    act(() => void fireEvent.keyDown(root!, { key: 'z', shiftKey: true, ...MOD }));
    expect(editor.state.doc.textContent).toBe('Plan now.!');
  });

  it('a composition holds remote frames from its start until ProseMirror has ended it', async () => {
    const holds: boolean[] = [];
    const { root, editor } = mount('title', { holdRemote: (on) => holds.push(on) });
    fireEvent.compositionStart(root!);
    expect(holds).toEqual([true]);
    expect(editor.view.composing).toBe(true);
    fireEvent.compositionEnd(root!);
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(editor.view.composing).toBe(false);
    expect(holds).toEqual([true, false]);
  });

  it('a hold still on is released when the text box unmounts', () => {
    const holds: boolean[] = [];
    const { root, session } = mount('title', { holdRemote: (on) => holds.push(on) });
    fireEvent.compositionStart(root!);
    act(() => session.editText(null));
    expect(holds).toEqual([true, false]);
  });

  it('Escape ends the edit and the canvas draws the element from the model again', () => {
    const { session, canvas, root, editor } = mount('title');
    act(() => {
      editor.commands.setTextSelection(end(editor));
      editor.commands.insertContent('!');
    });
    act(() => void fireEvent.keyDown(root!, { key: 'Escape' }));
    expect(session.snapshot().editingText).toBeNull();
    expect(canvas.node('title')!.querySelector('.deck-textbox')).toBeNull();
    expect(canvas.node('title')!.innerHTML).toBe('Plan <b>now</b>.!');
    // the canvas follows the model again
    act(() => transact(session.doc, () => Y.patchText(session.doc, 's1', 'title', [{ type: 'p', inline: [{ text: 'Later', marks: {} }] }])));
    expect(canvas.node('title')!.innerHTML).toBe('Later');
  });

  it('a pointerdown outside the element ends the edit; one inside it or on the mark bar does not', () => {
    const { session, canvas, root } = mount('title');
    fireEvent.pointerDown(root!);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Bold' }));
    expect(session.snapshot().editingText).toBe('title');
    act(() => void fireEvent.pointerDown(canvas.node('list')!));
    expect(session.snapshot().editingText).toBeNull();
  });

  it('the mark bar: Bold, a link refused unless https, a colour swatch and a validated hex', () => {
    const { doc, editor } = mount('title');
    act(() => void editor.commands.setTextSelection({ from: 1, to: 5 }));
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(bold);
    expect(text(doc, 'title')[0]!.inline[0]).toEqual({ text: 'Plan', marks: { b: {} } });
    expect(bold.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const url = screen.getByRole('textbox', { name: 'Link address' });
    fireEvent.change(url, { target: { value: 'http://x.dev' } });
    fireEvent.submit(url.closest('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/https/);
    expect(text(doc, 'title')[0]!.inline[0]).toEqual({ text: 'Plan', marks: { b: {} } });
    fireEvent.change(url, { target: { value: 'https://x.dev/plan' } });
    fireEvent.submit(url.closest('form')!);
    expect(text(doc, 'title')[0]!.inline[0]).toEqual({ text: 'Plan', marks: { a: { href: 'https://x.dev/plan' }, b: {} } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(text(doc, 'title')[0]!.inline[0]).toEqual({ text: 'Plan', marks: { b: {} } });

    fireEvent.click(screen.getByRole('button', { name: 'Colour' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accent colour' }));
    expect(text(doc, 'title')[0]!.inline[0]).toEqual({ text: 'Plan', marks: { span: { color: 'var(--ds-color-accent)' }, b: {} } });
    fireEvent.click(screen.getByRole('button', { name: 'Colour' }));
    const hex = screen.getByRole('textbox', { name: 'Hex colour' });
    fireEvent.change(hex, { target: { value: 'red' } });
    fireEvent.submit(hex.closest('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/#rrggbb/);
    fireEvent.change(hex, { target: { value: '#1A2B3C' } });
    fireEvent.submit(hex.closest('form')!);
    expect(text(doc, 'title')[0]!.inline[0]).toEqual({ text: 'Plan', marks: { span: { color: '#1a2b3c' }, b: {} } });
    expect(loadSlide(slideFile(doc, 's1')).diagnostics).toEqual([]);
  });

  // P4-R9: as the app ships, under the React Compiler (the artifacts-dom-compiled project), the bar's pressed states once
  // stayed as the box opened with them, the editor they were read from being the same object at every transaction
  it('the mark bar follows the marks at the selection: a caret move, a key, another replica’s change', () => {
    const { doc, editor, root } = mount('title');
    const button = (name: string) => screen.getByRole('button', { name });
    act(() => void editor.commands.setTextSelection(7)); // inside "now"
    expect(button('Bold').getAttribute('aria-pressed')).toBe('true');
    act(() => void editor.commands.setTextSelection({ from: 1, to: 5 })); // "Plan"
    expect(button('Bold').getAttribute('aria-pressed')).toBe('false');
    act(() => void fireEvent.keyDown(root!, { key: 'i', ...MOD }));
    expect(button('Italic').getAttribute('aria-pressed')).toBe('true');

    const remote = newDoc();
    applyV1(remote, diffV1(doc));
    transact(remote, () => Y.patchText(remote, 's1', 'title', [{ type: 'p', inline: [{ text: 'Plan', marks: { span: { color: '#cc0000' } } }, { text: ' ', marks: {} }, { text: 'now', marks: { b: {} } }, { text: '.', marks: {} }] }]));
    act(() => applyV1(doc, diffV1(remote, stateVector(doc)), 'remote'));
    expect(editor.state.selection).toMatchObject({ from: 1, to: 5 });
    expect(button('Italic').getAttribute('aria-pressed')).toBe('false');
    expect(button('Colour').getAttribute('aria-pressed')).toBe('true');
    expect((button('Colour').firstElementChild as HTMLElement).style.background).toBe('#cc0000');
  });
});

describe('fix wave 1: the text box stays within the slide’s text budget', () => {
  it('refuses typing past 20,000 characters on the slide, visibly, writing nothing', () => {
    const doc = newDoc();
    const l = loadSlide(`<section id="s1"><p id="long" style="font-size:16px">${'a'.repeat(19995)}</p><h2 id="title" style="font-size:64px">Plan</h2></section>`);
    if (!l.ok) throw new Error('fixture');
    transact(doc, () => {
      writeDeckKeys(doc, { v: 4, title: 'T', order: ['s1'] });
      importSlide(doc, l.slide, 'a0');
    });
    const { editor } = mount('title', { doc });
    let updates = 0;
    const off = onUpdate(doc, () => updates++);
    act(() => void editor.chain().setTextSelection(end(editor)).insertContent('ab').run());
    off();
    expect(updates).toBe(0);
    expect(text(doc, 'title')[0]!.inline).toEqual([{ text: 'Plan', marks: {} }]);
    expect(screen.getByRole('alert').textContent).toMatch(/20,000 characters/);
    expect(loadSlide(slideFile(doc, 's1')).ok).toBe(true);
    act(() => void editor.chain().setTextSelection(end(editor)).insertContent('b').run()); // one more fits
    expect(text(doc, 'title')[0]!.inline).toEqual([{ text: 'Planb', marks: {} }]);
  });
});

// P3-F wave S, F9 (docs/doperpowers/plans/2026-10-18-p3-f-finish.md, Wave S triage c43, obs 5a): a key the owner typed
// on the selected element (the stage hands it over with the edit, `editText(id, { typed })`) is typed into the box once
// it binds, over the text it opens with selected, as a key typed on a selection replaces it; nothing typed is dropped.
describe('P3-F F9: the keys typed on the selected element before the box took the focus', () => {
  const plain = (doc: Doc, id: string) => text(doc, id).map((b) => b.inline.map((r) => ('text' in r ? r.text : '\n')).join('')).join('\n');
  function canvasOf(doc: Doc): SlideCanvas {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const canvas = new SlideCanvas(doc, 's1', host);
    canvases.push(canvas);
    return canvas;
  }

  it('are typed over the text the box opens with selected, the caret after them, one undo step with the typing after', () => {
    const doc = deck();
    const session = new DeckSession(doc, 0);
    const canvas = canvasOf(doc);
    act(() => {
      session.select(['title']);
      session.editText('title', { typed: 'Q' });
      session.editText('title', { typed: '3' }); // a second key before the box mounted: kept, in order
    });
    render(<Harness session={session} canvas={canvas} />);
    const root = canvas.node('title')!.querySelector('.deck-textbox') as HTMLElement & { editor: Editor };
    expect(root.textContent).toBe('Q3');
    expect(plain(doc, 'title')).toBe('Q3');
    expect(document.activeElement).toBe(root);
    expect([root.editor.state.selection.from, root.editor.state.selection.to]).toEqual([3, 3]);
    act(() => void root.editor.commands.insertContent(' review'));
    expect(plain(doc, 'title')).toBe('Q3 review');
    act(() => session.undoStep());
    expect(plain(doc, 'title')).toBe('Plan now.');
    expect(session.snapshot().canUndo).toBe(false);
  });

  it('a key that reaches the stage while the box is already open goes in at its selection, typed once', () => {
    const { doc, session, editor } = mount('list');
    act(() => session.editText('list', { typed: 'x' }));
    expect(plain(doc, 'list')).toBe('x');
    expect(editor.state.doc.textContent).toBe('x');
    act(() => session.editText('list', {})); // no key: nothing more typed
    expect(plain(doc, 'list')).toBe('x');
  });

  it('keys typed for an edit that ended before its box bound are not typed into a later one', () => {
    const doc = deck();
    const session = new DeckSession(doc, 0);
    act(() => {
      session.editText('title', { typed: 'Q' });
      session.editText(null);
      session.editText('title'); // Enter: the box opens with nothing pending
    });
    render(<Harness session={session} canvas={canvasOf(doc)} />);
    expect(plain(doc, 'title')).toBe('Plan now.');
    expect(session.takeTyped('title')).toBeNull();
  });
});
