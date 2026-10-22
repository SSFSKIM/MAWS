// P3-C M6 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D13): the show under happy-dom: the keys move through
// builds and slides (skipping a hidden slide), the build state hides what has not built in, the presenter view shows the
// next step, the notes and the count, P shows it in a lone audience window, two windows keep one position over the
// channel, Escape ends the show in both, and an edit while the show runs shows at once. Motion and pixels are the e2e's.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newDoc, transact, type Doc } from '../../../yjs';
import { importSlide, ROOT, setNotes, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { addThread } from '../../threads';
import { removeSlide } from '../../writers';
import { Presentation, type PresentRole } from './Presentation';

const pin = (id: string, attrs = '') => `<p id="${id}" ${attrs} style="position:absolute; left:100px; top:100px; width:400px; font-size:40px">${id}</p>`;
function deck(extra: Record<string, string> = {}): Doc {
  const files: Record<string, string> = {
    one: `<section id="one" data-transition="fade"><h1 id="t1" style="font-size:96px">One</h1><aside>Say hello</aside></section>`,
    two: `<section id="two">${pin('a', 'data-build-in="fade"')}${pin('b', 'data-build-in="rise"')}</section>`,
    secret: `<section id="secret" hidden><p id="x" style="font-size:40px">Hidden</p></section>`,
    three: `<section id="three"><p id="z" style="font-size:40px">Three</p></section>`,
    ...extra,
  };
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: Object.keys(files) });
    Object.entries(files).forEach(([id, html], i) => {
      const loaded = loadSlide(html, { fileId: id });
      if (!loaded.ok) throw new Error(`fixture ${id}`);
      importSlide(doc, loaded.slide, `a${i}`);
    });
  });
  return doc;
}

let deckIds = 0;
function show(doc: Doc, role: PresentRole, options: { paired?: boolean; start?: string | null; artifactId?: string; embedUrl?: () => string } = {}) {
  const onEnd = vi.fn();
  const artifactId = options.artifactId ?? `00000000-0000-4000-8000-${String(++deckIds).padStart(12, '0')}`;
  const utils = render(
    <Presentation doc={doc} artifactId={artifactId} role={role} paired={options.paired ?? false} start={options.start ?? null} system={null} assetUrl={() => null} embedUrl={options.embedUrl} onEnd={onEnd} />,
  );
  const root = () => utils.container.querySelector('[data-present-role]') as HTMLElement;
  return { ...utils, onEnd, artifactId, at: () => `${root().dataset.presentSlide}/${root().dataset.presentBuild}`, root };
}
const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }));
/** A key pressed on an element as Chromium does: its keydown, then a button's activation by Enter or Space unless cancelled. */
const pressOn = (el: HTMLElement, k: string) =>
  act(() => {
    if (fireEvent.keyDown(el, { key: k }) && el instanceof HTMLButtonElement && (k === 'Enter' || k === ' ')) el.click();
  });
/** A mouse click on an element as Chromium does: its mousedown focuses it unless cancelled, then the click. */
const clickOn = (el: HTMLElement) =>
  act(() => {
    if (fireEvent.mouseDown(el)) el.focus();
    fireEvent.mouseUp(el);
    fireEvent.click(el);
  });

afterEach(cleanup);

describe('the show', () => {
  it('moves through builds and slides by the keys, skipping the hidden slide, Home and End to the ends', () => {
    const s = show(deck(), 'audience');
    expect(s.at()).toBe('one/0');
    const walk = [s.at()];
    for (let i = 0; i < 5; i++) {
      key(i % 2 ? ' ' : 'ArrowRight');
      walk.push(s.at());
    }
    expect(walk).toEqual(['one/0', 'two/0', 'two/1', 'two/2', 'three/0', 'three/0']);
    key('ArrowLeft');
    expect(s.at()).toBe('two/2');
    key('Home');
    expect(s.at()).toBe('one/0');
    key('End');
    expect(s.at()).toBe('three/0');
  });

  it('hides what has not built in yet on the slide shown', () => {
    const s = show(deck(), 'audience', { start: 'two' });
    const hidden = () => [...s.container.querySelectorAll('[data-present-layer] style')].map((n) => n.textContent).join('');
    expect(hidden()).toContain('[data-eid="a"]');
    expect(hidden()).toContain('[data-eid="b"]');
    key('ArrowRight');
    expect(hidden()).not.toContain('[data-eid="a"]');
    expect(hidden()).toContain('[data-eid="b"]');
  });

  it('shows the presenter view: the next build or slide, the notes, the count, the time', () => {
    const s = show(deck(), 'presenter');
    const next = () => s.container.querySelector('[data-present-next]')!;
    expect(s.container.querySelector('[data-present-notes]')!.textContent).toContain('Say hello');
    expect(s.container.querySelector('[data-present-count]')!.textContent).toBe('Slide 1 of 3');
    expect(s.container.querySelector('[data-present-timer]')!.textContent).toBe('0:00');
    expect(next().querySelector('.maws-slide')!.getAttribute('data-slide')).toBe('two');
    key('ArrowRight');
    expect(next().textContent).toContain('Next build');
    expect(s.container.querySelector('[data-present-notes]')!.textContent).toContain('No notes');
    key('End');
    expect(next().textContent).toContain('End of the show.');
  });

  it('a lone audience window shows the presenter view on P; a paired one does not', () => {
    const lone = show(deck(), 'audience');
    expect(lone.container.querySelector('[data-present-view]')!.getAttribute('data-present-view')).toBe('audience');
    key('p');
    expect(lone.container.querySelector('[data-present-view]')!.getAttribute('data-present-view')).toBe('presenter');
    cleanup();
    const paired = show(deck(), 'audience', { paired: true });
    key('p');
    expect(paired.container.querySelector('[data-present-view]')!.getAttribute('data-present-view')).toBe('audience');
  });

  // P3-F slide-editor scalpel-4#3: Enter and Space on a focused presenter button are the button's, so End ends the show
  it('leaves Enter and Space to a focused presenter button; the arrows still drive the show, and a press keeps focus off the bar', () => {
    const s = show(deck(), 'presenter');
    const button = (name: string) => s.getByRole('button', { name });
    pressOn(button('Black'), ' ');
    expect([s.at(), s.root().hasAttribute('data-present-black')]).toEqual(['one/0', true]);
    pressOn(button('End show'), 'ArrowRight');
    expect(s.at()).toBe('two/0');
    pressOn(button('End show'), 'Enter');
    expect([s.at(), s.onEnd.mock.calls.length]).toEqual(['two/0', 1]);
    // a pointer press does not move focus onto the bar, so the show's Space and Enter still follow a click on a button
    expect(fireEvent.mouseDown(button('Next'))).toBe(false);
  });

  // the wave's review (P3): a click on the bar also lets go of the focus a bar button took from the keyboard, so the
  // Space after a click on → is the show's, not the ← that held focus
  it('drops a bar button’s keyboard focus on a click on the bar, so the show’s Space follows the click', () => {
    const s = show(deck(), 'presenter');
    const button = (name: string) => s.getByRole('button', { name });
    act(() => button('Previous').focus()); // a Tab onto the bar
    clickOn(button('Next'));
    expect(s.at()).toBe('two/0');
    pressOn(document.activeElement as HTMLElement, ' ');
    expect(s.at()).toBe('two/1');
  });

  // L259: the current pane's embeds are live frames a click goes into, and a key typed there is the frame's page's
  it('takes focus back from an embed the presenter clicked into on a press on the bar, so the show’s Space follows', () => {
    const embed = `<x-embed id="e" style="position:absolute; left:100px; top:100px; width:800px; height:400px">Hello</x-embed>`;
    const s = show(deck({ one: `<section id="one">${embed}</section>` }), 'presenter', { embedUrl: () => 'about:blank' });
    const frame = s.container.querySelector<HTMLIFrameElement>('[data-present-current] iframe')!;
    act(() => frame.focus()); // a click into the embed's page
    expect(document.activeElement).toBe(frame);
    clickOn(s.container.querySelector<HTMLElement>('[data-present-count]')!);
    expect(document.activeElement).not.toBe(frame);
    act(() => void fireEvent.keyDown(document, { key: ' ' }));
    expect(s.at()).toBe('two/0');
  });

  it('B shows black; Escape ends the show', () => {
    const s = show(deck(), 'audience');
    key('b');
    expect(s.root().hasAttribute('data-present-black')).toBe(true);
    key('Escape');
    expect(s.onEnd).toHaveBeenCalledTimes(1);
  });

  it('keeps the show where it can when its slide is removed or hidden meanwhile, and shows the notes as they change', () => {
    const doc = deck();
    const s = show(doc, 'presenter', { start: 'two' });
    act(() => setNotes(doc, 'two', 'New words'));
    expect(s.container.querySelector('[data-present-notes]')!.textContent).toContain('New words');
    act(() => removeSlide(doc, 'two'));
    expect(s.at()).toBe('three/0');
  });

  // P3-F slide-editor scalpel-3#2: the removed slide sits mid-deck, so the slide after it is not also the last
  it('gives a removed current slide’s place to the slide after it, there through later updates, and goes on from it', () => {
    const doc = deck({ four: `<section id="four"><p id="w" style="font-size:40px">Four</p></section>` });
    const s = show(doc, 'audience', { start: 'two' });
    act(() => removeSlide(doc, 'two'));
    expect(s.at()).toBe('three/0');
    act(() => setNotes(doc, 'three', 'Still here'));
    expect(s.at()).toBe('three/0');
    key('ArrowRight');
    expect(s.at()).toBe('four/0');
  });
});

describe('two windows of one show', () => {
  it('follow each other’s moves and end together', async () => {
    const doc = deck();
    const audience = show(doc, 'audience', { paired: true, artifactId: '00000000-0000-4000-8000-0000000000aa' });
    const presenter = show(doc, 'presenter', { artifactId: '00000000-0000-4000-8000-0000000000aa' });
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    await settle();
    act(() => void fireEvent.click(presenter.container.querySelector('button[aria-label="Next"]')!));
    await settle();
    expect(audience.at()).toBe('two/0');
    act(() => void fireEvent.click(presenter.container.querySelector('.present-end')!));
    await settle();
    expect(presenter.onEnd).toHaveBeenCalledTimes(1);
    expect(audience.onEnd).toHaveBeenCalledTimes(1);
  });
});

// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V14): presenting shows no pins and
// no popover, in the audience's window and the presenter's, whatever threads the deck holds.
describe('comments while presenting (V14)', () => {
  it('draws no pin and no popover for a slide with open threads', () => {
    const doc = deck();
    addThread(doc, { threadId: 'tt', slideId: 'one', elementId: 't1', quote: 'One', by: { kind: 'human' }, at: 1, body: 'Bigger?' });
    addThread(doc, { threadId: 'ts', slideId: 'one', elementId: ROOT, quote: '', by: { kind: 'human' }, at: 2, body: 'Whole slide.' });
    for (const role of ['audience', 'presenter'] as const) {
      const { container, unmount } = show(doc, role, { start: 'one' });
      expect(container.querySelector('[data-present-role]')).not.toBeNull();
      expect(container.querySelectorAll('.deck-comment-pin, [data-comment-pin], [data-pin-popover], [data-comments-badge]')).toHaveLength(0);
      unmount();
    }
  });
});
