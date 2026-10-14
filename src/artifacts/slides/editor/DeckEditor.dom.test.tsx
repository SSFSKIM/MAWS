// P3-C M4 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8): the deck editor over a replica, under happy-dom:
// the filmstrip's thumbnails, sections, hidden and held slides; the slide gestures as one undo step each; the notes
// bound by character diff in both directions. Drag reorder, zoom by fit and paint are the e2e's.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyV1, diffV1, newDoc, stateVector, transact, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { flushLayout } from '../canvas';
import { importSlide, readSlide, setNotes, slideOrder, writeDeckKeys } from '../model';
import { DECK_LIMITS } from '../deck';
import { loadSlide } from '../parse';
import { DeckEditor } from './DeckEditor';
import { DeckSession } from './session';

function deck(): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'Q3', order: ['a', 'b', 'c'], sections: { s1: { description: 'Opening', start: 'a' }, s2: { description: 'Numbers', start: 'c' } } });
    ['a', 'b', 'c'].forEach((id, i) => {
      const l = loadSlide(`<section id="${id}" style="background:#ffffff"><h2 id="t" style="font-size:64px">Slide ${id}</h2><aside>Notes ${id}</aside></section>`);
      if (!l.ok) throw new Error('fixture');
      importSlide(doc, l.slide, `a${i}`);
    });
    Y.setSlideKey(doc, 'b', 'attr:hidden', '');
    Y.setSlideKey(doc, 'c', 'held', { source: '<section id="c"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
  });
  return doc;
}

afterEach(cleanup);

function mount(doc = deck(), readOnly = false) {
  const session = new DeckSession(doc);
  const utils = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={readOnly} />);
  return { doc, session, ...utils };
}
const thumbs = () => screen.getAllByRole('button', { name: /^Slide \d+(, hidden|, held)*$/ });

describe('the deck editor', () => {
  it('shows every slide as a live thumbnail, the sections before their slides, hidden and held slides marked', () => {
    const { container } = mount();
    expect(thumbs().map((b) => b.getAttribute('aria-label'))).toEqual(['Slide 1', 'Slide 2, hidden', 'Slide 3, held']);
    expect(container.querySelectorAll('[data-slide-thumb] .maws-slide')).toHaveLength(3);
    expect([...container.querySelectorAll('.deck-section-title')].map((n) => n.textContent)).toEqual(['Opening', 'Numbers']);
    expect(container.querySelector('[data-slide-thumb="c"]')!.hasAttribute('data-held')).toBe(true);
    expect(container.querySelector('[data-stage-slide="a"] .maws-slide')).not.toBeNull();
  });

  it('a thumbnail follows a remote edit of its slide; the stage shows the slide picked', () => {
    const { doc, container } = mount();
    const remote = newDoc();
    applyV1(remote, diffV1(doc));
    remote.transact(() => Y.setElementKey(remote, 'a', 't', 'style:color', '#ff0000'));
    act(() => applyV1(doc, diffV1(remote, stateVector(doc)), 'remote'));
    expect((container.querySelector('[data-slide-thumb="a"] [data-eid="t"]') as HTMLElement).style.color).toBe('#ff0000');
    fireEvent.click(thumbs()[2]!);
    expect(container.querySelector('[data-stage-slide="c"]')).not.toBeNull();
    expect(container.querySelector('[data-held-banner]')!.textContent).toContain('an unknown tag <blink>');
  });

  it('a new slide, a deletion by key and their undo and redo, each one step', () => {
    const { doc } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'New slide' }));
    expect(slideOrder(doc)).toHaveLength(4);
    expect(slideOrder(doc)[1]).toMatch(/^s[0-9a-z]+-\d+$/); // after the current slide
    fireEvent.keyDown(thumbs()[0]!, { key: 'Delete' });
    expect(slideOrder(doc)).toHaveLength(3);
    expect(slideOrder(doc)).not.toContain('a');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(slideOrder(doc)[0]).toBe('a');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(slideOrder(doc)).toEqual(['a', 'b', 'c']);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(slideOrder(doc)).toHaveLength(4);
  });

  it('the notes: typed into the model, a remote change into the field, the current slide’s only', () => {
    const { doc } = mount();
    const field = screen.getByRole('textbox', { name: 'Speaker notes' }) as HTMLTextAreaElement;
    expect(field.value).toBe('Notes a');
    field.value = 'Notes a, then more';
    fireEvent.input(field);
    expect(readSlide(doc, 'a').notes).toBe('Notes a, then more');
    act(() => setNotes(doc, 'a', 'Opening: Notes a, then more', 'remote'));
    expect(field.value).toBe('Opening: Notes a, then more');
  });

  it('read-only: no gestures offered, the notes not editable', () => {
    mount(deck(), true);
    expect(screen.queryByRole('button', { name: 'New slide' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Speaker notes' }) as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('reports the first showing drawn once every thumbnail has laid out', async () => {
    const doc = deck();
    const session = new DeckSession(doc);
    const drawn: number[] = [];
    render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} onThumbnailsDrawn={(n) => drawn.push(n)} />);
    act(() => flushLayout());
    await act(async () => {});
    expect(drawn).toEqual([3]);
  });
});

// ---- fix wave 1 ----------------------------------------------------------------------------------------------------

const notesField = () => screen.getByRole('textbox', { name: 'Speaker notes' }) as HTMLTextAreaElement;

describe('the notes under a composition and the dialect’s limits (findings 1 and 4)', () => {
  it('a composition ends carried onto a remote insertion at the edge of the owner’s deletion, nothing of either lost', () => {
    const { doc } = mount();
    const field = notesField();
    fireEvent.compositionStart(field);
    field.value = 'Note a'; // the owner removes the s while composing
    fireEvent.input(field);
    act(() => setNotes(doc, 'a', 'NotesX a', 'remote')); // the other writer types X right after the s
    expect(field.value).toBe('Note a'); // held while composing
    fireEvent.compositionEnd(field);
    expect(readSlide(doc, 'a').notes).toBe('NoteX a');
    expect(field.value).toBe('NoteX a');
  });

  it('notes past 4,000 characters are refused with the reason shown, the model untouched, and saved once short enough', () => {
    const { doc } = mount();
    const field = notesField();
    field.value = 'x'.repeat(4_001);
    fireEvent.input(field);
    expect(readSlide(doc, 'a').notes).toBe('Notes a');
    expect(screen.getByRole('alert').textContent).toMatch(/4,000/);
    expect(field.value).toHaveLength(4_001); // the owner's text stays to shorten, never cut silently
    field.value = 'x'.repeat(4_000);
    fireEvent.input(field);
    expect(readSlide(doc, 'a').notes).toBe('x'.repeat(4_000));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a composition whose rebased text passes the limit is refused too', () => {
    const { doc } = mount();
    const field = notesField();
    fireEvent.compositionStart(field);
    field.value = `Notes a${'y'.repeat(3_993)}`; // 4,000 of the owner's
    act(() => setNotes(doc, 'a', 'Notes aZ', 'remote'));
    fireEvent.compositionEnd(field);
    expect(readSlide(doc, 'a').notes).toBe('Notes aZ');
    expect(screen.getByRole('alert').textContent).toMatch(/4,000/);
  });

  it('a deck of 500 slides offers no new slide or duplicate, and says why', () => {
    const doc = newDoc();
    transact(doc, () => {
      writeDeckKeys(doc, { v: 4, title: 'Full', order: [] });
      for (let i = 0; i < DECK_LIMITS.slides; i++) {
        const l = loadSlide(`<section id="f${i}" style="background:#ffffff"></section>`);
        if (!l.ok) throw new Error('fixture');
        importSlide(doc, l.slide, `b${String(i).padStart(4, '0')}`);
      }
    });
    mount(doc);
    expect((screen.getByRole('button', { name: 'New slide' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/at most 500 slides/)).toBeTruthy();
  });
});
