// P3-C M4 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8): the deck editor over a replica, under happy-dom:
// the filmstrip's thumbnails, sections, hidden and held slides; the slide gestures as one undo step each; the notes
// bound by character diff in both directions. Drag reorder, zoom by fit and paint are the e2e's.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { HistoryApi } from '../../document/editor/history/api';
import { applyV1, diffV1, encodeMap, mergeMaps, newDoc, stateV2, stateVector, transact, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { flushLayout } from '../canvas';
import { importSlide, readSlide, setNotes, slideOrder, writeDeckKeys } from '../model';
import { DECK_LIMITS } from '../deck';
import { loadSlide } from '../parse';
import { addThread } from '../threads';
import { DeckEditor } from './DeckEditor';
import chromeCss from './chrome.css?raw';
import type { DeckReveal } from './reveal';
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

function PortalToolbar({ session, consume = false }: { session: DeckSession; consume?: boolean }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return <>
    <DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} onToolbarHost={setHost} />
    {host && createPortal(<button onKeyDown={(event) => { if (consume && event.key === 'F6') event.preventDefault(); }}>Host action</button>, host)}
  </>;
}

describe('the deck editor', () => {
  it.each(['Insert', 'Arrange', 'Text style'].flatMap((name) => [false, true].map((shiftKey) => ({ name, shiftKey }))))('routes F6 from the real open $name menu (shift: $shiftKey) back into the editor ring', async ({ name, shiftKey }) => {
    const user = userEvent.setup();
    const { session, container } = mount();
    act(() => session.select(['t']));
    await user.click(within(screen.getByRole('toolbar', { name: 'Deck' })).getByRole('button', { name }));
    const menu = await screen.findByRole('menu');
    expect(container.contains(menu)).toBe(false); // Radix renders this React-owned menu under document.body.
    act(() => menu.focus());
    expect(document.activeElement).toBe(menu);
    const event = new KeyboardEvent('keydown', { key: 'F6', code: 'F6', shiftKey, bubbles: true, cancelable: true });
    act(() => { menu.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.closest(shiftKey ? '.deck-notes' : '.deck-toolbar')).not.toBeNull();
  });

  it('consults the owner keymap only once for one DOM-and-React-owned F6 event', () => {
    const bindsKey = vi.fn(() => true);
    render(<DeckEditor session={new DeckSession(deck())} assetUrl={() => null} system={null} readOnly={false} bindsKey={bindsKey} />);
    const inspector = within(screen.getByRole('toolbar', { name: 'Deck' })).getByRole('button', { name: 'Inspector' });
    inspector.focus();
    fireEvent.keyDown(inspector, { key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(inspector);
    expect(bindsKey).toHaveBeenCalledTimes(1);
  });

  it('cycles F6 from a separately rendered host portal and remembers that toolbar control on return', () => {
    const session = new DeckSession(deck());
    render(<PortalToolbar session={session} />);
    const hostAction = screen.getByRole('button', { name: 'Host action' });
    hostAction.focus();
    fireEvent.keyDown(hostAction, { key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(thumbs()[0]);
    fireEvent.keyDown(thumbs()[0], { key: 'F6', code: 'F6', shiftKey: true });
    expect(document.activeElement).toBe(hostAction);
  });

  it('lets a nested React control consume F6 before the native editor ring sees it', () => {
    render(<PortalToolbar session={new DeckSession(deck())} consume />);
    const hostAction = screen.getByRole('button', { name: 'Host action' });
    hostAction.focus();
    fireEvent.keyDown(hostAction, { key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(hostAction);
  });

  it('steps an ordinary toolbar descendant exactly once on F6', () => {
    mount();
    const inspector = within(screen.getByRole('toolbar', { name: 'Deck' })).getByRole('button', { name: 'Inspector' });
    inspector.focus();
    fireEvent.keyDown(inspector, { key: 'F6', code: 'F6' });
    expect(document.activeElement).toBe(thumbs()[0]);
  });

  it('starts notes folded with saved content indicated, preserves the choice on remount, and follows remote notes while folded', () => {
    const { session, doc, unmount } = mount();
    const disclosure = () => screen.getByRole('button', { name: 'Speaker notes' });
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(disclosure().textContent).toContain('Notes a');
    expect(screen.queryByRole('textbox', { name: 'Speaker notes' })).toBeNull();
    fireEvent.click(disclosure());
    expect(screen.getByRole('textbox', { name: 'Speaker notes' })).toBeTruthy();
    fireEvent.click(disclosure());
    act(() => setNotes(doc, 'a', 'Opening notes from another writer', 'remote'));
    expect(disclosure().textContent).toContain('Opening notes from another writer');
    unmount();
    const reopened = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(disclosure());
    expect((screen.getByRole('textbox', { name: 'Speaker notes' }) as HTMLTextAreaElement).value).toBe('Opening notes from another writer');
    reopened.unmount();
    render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps an unsaved notes draft visible even when the tab’s notes choice is folded', () => {
    const doc = deck();
    const session = new DeckSession(doc);
    session.keepNotesDraft('a', { from: 'Notes a', text: 'Retained notes while read-only' });
    render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly />);
    expect(screen.getByRole('button', { name: 'Speaker notes' }).getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByRole('textbox', { name: 'Speaker notes' }) as HTMLTextAreaElement).value).toBe('Retained notes while read-only');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('keeps the inspector closed until its own toolbar action is used, then closes it from the card', () => {
    mount();
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
    const inspector = within(screen.getByRole('toolbar', { name: 'Deck' })).getByRole('button', { name: 'Inspector' });
    expect(inspector.textContent).toBe('Inspector');
    fireEvent.click(inspector);
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  });

  it('visually distinguishes every open toolbar card, including Inspector while Comments is also open', () => {
    const sheet = document.createElement('style');
    sheet.textContent = `${chromeCss}\n.deck-editor { --bg-active: #eeeeee; --fg: #111111; --fg-muted: #777777; }`;
    document.head.append(sheet);
    onTestFinished(() => sheet.remove());
    mount();
    const toolbar = within(screen.getByRole('toolbar', { name: 'Deck' }));
    const inspector = toolbar.getByRole('button', { name: 'Inspector' });
    const comments = toolbar.getByRole('button', { name: /^Comments/ });
    const closedBackground = getComputedStyle(inspector).backgroundColor;
    fireEvent.click(inspector);
    expect(inspector.getAttribute('aria-pressed')).toBe('true');
    expect(getComputedStyle(inspector).backgroundColor).not.toBe(closedBackground);
    fireEvent.click(comments);
    expect(comments.getAttribute('aria-pressed')).toBe('true');
    expect(getComputedStyle(comments).backgroundColor).toBe(getComputedStyle(inspector).backgroundColor);
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(inspector.getAttribute('aria-pressed')).toBe('false');
    expect(getComputedStyle(inspector).backgroundColor).toBe(closedBackground);
    expect(comments.getAttribute('aria-pressed')).toBe('true');
  });

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
    const field = notesField();
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
    expect(notesField().readOnly).toBe(true);
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

const notesField = () => {
  const disclosure = screen.getByRole('button', { name: 'Speaker notes' });
  if (disclosure.getAttribute('aria-expanded') === 'false') fireEvent.click(disclosure);
  return screen.getByRole('textbox', { name: 'Speaker notes' }) as HTMLTextAreaElement;
};

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

  // P3-F (L203): the refused text is the tab's (its session), not the field's: another slide and back, or the body
  // unmounting on a tab switch, shows it again with its refusal, carried onto what changed meanwhile
  it('notes refused for their length outlive the field: shown again, still refused, on the same slide and after a remount', () => {
    const { doc, session, unmount } = mount();
    const over = 'y'.repeat(4_000);
    notesField().value = `Notes a${over}`;
    fireEvent.input(notesField());
    fireEvent.click(thumbs()[1]!);
    expect(notesField().value).toBe('Notes b');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(thumbs()[0]!);
    expect(notesField().value).toBe(`Notes a${over}`);
    expect(screen.getByRole('alert').textContent).toMatch(/4,007/);
    unmount();
    act(() => setNotes(doc, 'a', 'Opening: Notes a', 'remote'));
    render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    expect(notesField().value).toBe(`Opening: Notes a${over}`);
    expect(screen.getByRole('alert').textContent).toMatch(/4,016/);
    expect(readSlide(doc, 'a').notes).toBe('Opening: Notes a');
    notesField().value = 'Opening: Notes a, shorter';
    fireEvent.input(notesField());
    expect(readSlide(doc, 'a').notes).toBe('Opening: Notes a, shorter');
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    expect(notesField().value).toBe('Opening: Notes a, shorter');
  });

  const keptOverModel = (doc: Doc) => {
    const model = 'm'.repeat(4_000);
    act(() => setNotes(doc, 'a', model, 'remote'));
    notesField().value = `${model}ZZ`;
    fireEvent.input(notesField());
    expect(screen.getByRole('alert').textContent).toMatch(/4,002/);
  };
  const editor = (session: DeckSession, readOnly = false) => render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={readOnly} />);

  it('autosaves retained notes when returning to a field whose rebased draft now fits', () => {
    const { doc, session, unmount } = mount();
    keptOverModel(doc);
    unmount();
    act(() => setNotes(doc, 'a', '', 'remote'));
    editor(session);
    expect(notesField().value).toBe('ZZ');
    expect(readSlide(doc, 'a').notes).toBe('ZZ');
    expect(session.hasUnwrittenNotes()).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('autosaves a refused draft once a remote edit brings the merged notes within the limit', () => {
    const { doc, session } = mount();
    keptOverModel(doc);
    act(() => setNotes(doc, 'a', 'm'.repeat(3_999), 'remote'));
    expect(screen.getByRole('alert').textContent).toMatch(/4,001/);
    act(() => setNotes(doc, 'a', '', 'remote'));
    expect(notesField().value).toBe('ZZ');
    expect(readSlide(doc, 'a').notes).toBe('ZZ');
    expect(session.hasUnwrittenNotes()).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retains a recovered draft while read-only and autosaves when editing becomes available', () => {
    const { doc, session, unmount } = mount();
    keptOverModel(doc);
    unmount();
    act(() => setNotes(doc, 'a', '', 'remote'));
    const view = editor(session, true);
    expect(notesField().value).toBe('ZZ');
    expect(readSlide(doc, 'a').notes).toBe('');
    expect(session.hasUnwrittenNotes()).toBe(true);
    view.rerender(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    expect(readSlide(doc, 'a').notes).toBe('ZZ');
    expect(session.hasUnwrittenNotes()).toBe(false);
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

// ---------------------------------------------------------------- final fix wave (B4): awaited edits and the editor's lifetime

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('final fix wave B4: an awaited edit writes only while the deck takes writes', () => {
  const pictures = (doc: Doc) => readSlide(doc, 'a').children.filter((e) => e.tag === 'img');
  function withUpload(readOnly = false) {
    const doc = deck();
    const session = new DeckSession(doc);
    const upload = deferred<string>();
    const ui = (ro: boolean) => <DeckEditor session={session} assetUrl={() => null} system={null} readOnly={ro} uploadAsset={() => upload.promise} />;
    const utils = render(ui(readOnly));
    const pick = () => fireEvent.change(utils.container.querySelector('[data-insert-image]')!, { target: { files: [new File(['x'], 'b.png', { type: 'image/png' })] } });
    return { doc, session, upload, ui, pick, ...utils };
  }

  it('an image whose upload finishes in time is placed', async () => {
    const { doc, upload, pick } = withUpload();
    pick();
    await act(async () => upload.resolve('assets/b.png'));
    expect(pictures(doc).map((e) => e.attrs.src)).toEqual(['assets/b.png']);
  });

  it('an image whose upload finishes after the deck turned read-only is not placed, and the owner is told', async () => {
    const { doc, upload, ui, pick, rerender } = withUpload();
    pick();
    rerender(ui(true));
    await act(async () => upload.resolve('assets/b.png'));
    expect(pictures(doc)).toEqual([]);
    expect(screen.getByText(/uploaded but not placed/)).toBeTruthy();
  });

  it('an image whose upload finishes after the tab closed writes nothing into the disposed session', async () => {
    const { doc, session, upload, pick, unmount } = withUpload();
    pick();
    unmount();
    session.dispose();
    await act(async () => upload.resolve('assets/b.png'));
    expect(pictures(doc)).toEqual([]);
  });

  it('the session counts an awaited edit until it settles, and drops its write while a version shows', async () => {
    const session = new DeckSession(deck());
    const work = deferred<string>();
    const write = vi.fn();
    const done = session.later(work.promise, write);
    expect(session.snapshot().pending).toBe(1);
    session.holdWrites(true); // the editor shows a version in place of the live deck
    work.resolve('x');
    await expect(done).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(session.snapshot().pending).toBe(0);
    session.holdWrites(false);
    await expect(session.later(Promise.resolve('y'), write)).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith('y');
  });
});

// ---- P3-F (L233) ---------------------------------------------------------------------------------------------------

describe('what the editor shows, for the header’s Export (L233)', () => {
  it('tells its session the one version its history previews, two compared, and the live deck once the rail closes', async () => {
    const doc = deck();
    const states = [stateV2(doc)];
    setNotes(doc, 'a', 'Notes a, revised');
    states.push(stateV2(doc));
    const versions: ArtifactVersion[] = states.map((_, i) => ({ id: i + 1, seq: i + 1, at: Date.UTC(2026, 9, 18, 9, i), actor: { kind: 'human' as const }, kind: 'named' as const, label: `Draft ${i + 1}`, assetRefs: [] }));
    const api: HistoryApi = {
      versions: async () => versions,
      lastViewedAt: async () => null,
      versionState: async (id) => states[id - 1]!,
      attributions: async () => encodeMap(mergeMaps([])),
      saveVersion: async () => ({ versionId: 3 }),
      restore: async () => ({ revision: 3, versionId: 3 }),
      duplicate: async () => ({ artifactId: 'copy' }),
      markViewed: async () => {},
    };
    const session = new DeckSession(doc);
    const toolbarHosts: Array<HTMLDivElement | null> = [];
    render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} onToolbarHost={(element) => { toolbarHosts.push(element); }} history={{ api, handle: { doc, onRestored: () => () => {} } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Speaker notes' }));
    act(() => session.toggleRail('history'));
    const row = (label: string) => screen.findByRole('button', { name: new RegExp(`^Version ${label} by`) });
    fireEvent.click(await row('Draft 2'));
    await waitFor(() => expect(session.snapshot().shown).toEqual({ versionId: 2 }));
    expect(toolbarHosts.at(-1)?.closest('.deck-history-bar')).toBeTruthy();
    fireEvent.click(await row('Draft 1'), { shiftKey: true });
    await waitFor(() => expect(session.snapshot().shown).toBe('compare'));
    act(() => session.toggleRail('history'));
    await waitFor(() => expect(session.snapshot().shown).toBeNull());
    expect(toolbarHosts.at(-1)?.closest('[aria-label="Deck"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Speaker notes' }).getAttribute('aria-expanded')).toBe('true');
  });
});

// P4-B4 (the link grammar; "Opening at a place"): a reveal asked from outside the editor (a link's `#slide=`, `#v<id>`)
// selects the slide on the stage and opens the history rail previewing a version named by its id; a place the deck does
// not have changes nothing, as a plain open; each reveal is taken once
describe('a reveal asked from outside', () => {
  function revealing() {
    const doc = deck();
    const versions: ArtifactVersion[] = [{ id: 7, seq: 1, at: Date.UTC(2026, 9, 18, 9), actor: { kind: 'human' }, kind: 'named', label: 'Draft', assetRefs: [] }];
    const api: HistoryApi = {
      versions: async () => versions,
      lastViewedAt: async () => null,
      versionState: async () => stateV2(doc),
      attributions: async () => encodeMap(mergeMaps([])),
      saveVersion: async () => ({ versionId: 8 }),
      restore: async () => ({ revision: 3, versionId: 8 }),
      duplicate: async () => ({ artifactId: 'copy' }),
      markViewed: async () => {},
    };
    const session = new DeckSession(doc);
    const revealed = vi.fn();
    const view = (reveal: DeckReveal | null) => <DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} history={{ api, handle: { doc, onRestored: () => () => {} } }} reveal={reveal} onRevealed={revealed} />;
    const utils = render(view(null));
    return { session, revealed, container: utils.container, reveal: (reveal: DeckReveal) => utils.rerender(view(reveal)) };
  }

  it('selects the slide a link names, on the stage', () => {
    const { session, revealed, container, reveal } = revealing();
    expect(session.snapshot().currentSlide).toBe('a');
    reveal({ serial: 1, location: { slide: 'c' } });
    expect(session.snapshot().currentSlide).toBe('c');
    expect(container.querySelector('[data-stage-slide="c"]')).not.toBeNull();
    expect(revealed).toHaveBeenCalledWith(1);
  });

  it('opens the history rail previewing a version named by its id', async () => {
    const { session, reveal, container } = revealing();
    reveal({ serial: 2, location: { version: 7 } });
    await waitFor(() => expect(session.snapshot().shown).toEqual({ versionId: 7 }));
    expect(session.snapshot().rail).toBe('history');
    expect(container.querySelector('[data-history-previewing]')).not.toBeNull();
  });

  it('opens a place the deck does not have as a plain open', async () => {
    const { session, revealed, reveal } = revealing();
    reveal({ serial: 3, location: { slide: 'gone', version: 99 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.snapshot()).toMatchObject({ currentSlide: 'a', rail: null, shown: null });
    expect(revealed).toHaveBeenCalledWith(3);
  });
});

// ---- P3-F (the slide-editor panel) ---------------------------------------------------------------------------------

describe('the editor-wide ⌘Z (scalpel-4#2)', () => {
  it('⌘Z in a comment’s reply field leaves the deck as it is and the field its own undo; in the notes it is still the deck’s', async () => {
    const { doc, session } = mount();
    notesField().value = 'Notes a, then more';
    fireEvent.input(notesField()); // a deck edit to take back: one undo step
    act(() => addThread(doc, { threadId: 't1', slideId: 'a', elementId: 't', quote: 'Slide a', by: { kind: 'human' }, at: 1 }));
    act(() => session.toggleRail('comments'));
    const reply = await screen.findByRole('textbox', { name: 'Reply' });
    fireEvent.change(reply, { target: { value: 'Cut it' } });
    expect(fireEvent.keyDown(reply, { key: 'z', metaKey: true })).toBe(true); // not cancelled: the field undoes its own typing
    expect(readSlide(doc, 'a').notes).toBe('Notes a, then more');
    expect(fireEvent.keyDown(notesField(), { key: 'z', metaKey: true })).toBe(false);
    expect(readSlide(doc, 'a').notes).toBe('Notes a');
  });
});

// ---- W1 (tech debt, 2026-10-19): the fit zoom -------------------------------------------------------------------------

describe('Fit follows the stage, with the rails open and closed and after a version’s preview', () => {
  // happy-dom lays nothing out and its ResizeObserver never reports: a stand-in that reports every observed node when the
  // test lays the window out, the stage (connected) at the size given, a detached node (or a hidden stage) at 0 × 0, as
  // a browser reports an observed node taken out of the document
  let stage = { w: 1200, h: 800 };
  let editorWidth = 1280;
  let cardWidth = 0;
  const observers = new Set<StubObserver>();
  class StubObserver {
    readonly nodes = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) {
      observers.add(this);
    }
    observe(node: Element) {
      this.nodes.add(node);
    }
    unobserve(node: Element) {
      this.nodes.delete(node);
    }
    disconnect() {
      this.nodes.clear();
      observers.delete(this);
    }
  }
  const layout = (size?: { w: number; h: number }) => {
    if (size) stage = size;
    act(() => {
      for (const o of [...observers]) if (o.nodes.size) o.callback([...o.nodes].map((target) => ({ target }) as ResizeObserverEntry), o as unknown as ResizeObserver);
    });
  };
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', StubObserver);
    const side = (axis: 'w' | 'h') =>
      function (this: HTMLElement) {
        if (!this.isConnected) return 0;
        if (this.classList.contains('deck-stage')) return stage[axis];
        if (axis === 'w' && this.classList.contains('deck-editor')) return editorWidth;
        if (axis === 'w' && this.classList.contains('deck-tool-cards')) return cardWidth;
        return 0;
      };
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(side('w'));
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(side('h'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    observers.clear();
    stage = { w: 1200, h: 800 };
    editorWidth = 1280;
    cardWidth = 0;
  });

  function withHistory() {
    const doc = deck();
    const states = [stateV2(doc)];
    setNotes(doc, 'a', 'Notes a, revised');
    states.push(stateV2(doc));
    const versions: ArtifactVersion[] = states.map((_, i) => ({ id: i + 1, seq: i + 1, at: Date.UTC(2026, 9, 19, 9, i), actor: { kind: 'human' as const }, kind: 'named' as const, label: `Draft ${i + 1}`, assetRefs: [] }));
    const api: HistoryApi = {
      versions: async () => versions,
      lastViewedAt: async () => null,
      versionState: async (id) => states[id - 1]!,
      attributions: async () => encodeMap(mergeMaps([])),
      saveVersion: async () => ({ versionId: 3 }),
      restore: async () => ({ revision: 3, versionId: 3 }),
      duplicate: async () => ({ artifactId: 'copy' }),
      markViewed: async () => {},
    };
    const session = new DeckSession(doc);
    const utils = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} history={{ api, handle: { doc, onRestored: () => () => {} } }} />);
    /** Opens the history rail, shows a version in place of the editor, and closes the rail: the live editor is back. */
    const preview = async () => {
      act(() => session.toggleRail('history'));
      fireEvent.click(await screen.findByRole('button', { name: /^Version Draft 1 by/ }));
      await waitFor(() => expect(utils.container.querySelector('[data-history-previewing]')).not.toBeNull());
      layout(); // the live stage, taken out of the document, reads 0 × 0
      act(() => session.toggleRail('history'));
      await waitFor(() => expect(utils.container.querySelector('[data-history-previewing]')).toBeNull());
    };
    return { session, preview, ...utils };
  }
  const zoom = () => screen.getByRole('combobox', { name: 'Zoom' }) as HTMLSelectElement;
  /** The zoom select's shown option (by its value: happy-dom's `selectedOptions` can lag a controlled select's update). */
  const shown = () => [...zoom().options].find((o) => o.value === zoom().value)!.text;
  // (w − 48) / 1920 against (h − 48) / 1080: 1200 × 800 fits at 60 %, 900 × 800 at 44 %
  const WIDE = { w: 1200, h: 800 };
  const NARROW = { w: 900, h: 800 };

  // Approved layout-mockups/app.js:368 keeps at least 520 px beside the stack before cards become an overlay.
  it('fits the width left by all open floating cards without reserving a second column', () => {
    cardWidth = 288;
    const { container } = withHistory();
    const tools = within(screen.getByRole('toolbar', { name: 'Deck' }));
    expect(shown()).toBe('Fit (60%)');
    fireEvent.click(tools.getByRole('button', { name: 'Inspector' }));
    expect(shown()).toBe('Fit (44%)');
    fireEvent.click(tools.getByRole('button', { name: 'Version history' }));
    expect(screen.getByRole('complementary', { name: 'Version history' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeTruthy();
    expect(shown()).toBe('Fit (44%)');
    expect(container.querySelector('.deck-editor-body')!.getAttribute('style')).toContain('--deck-card-reserve: 304px');
    fireEvent.click(tools.getByRole('button', { name: 'Inspector' }));
    expect(shown()).toBe('Fit (44%)');
    fireEvent.click(tools.getByRole('button', { name: 'Version history' }));
    expect(shown()).toBe('Fit (60%)');
  });

  it('moves the filmstrip below the stage when the editor narrows, keeping the selected slide', () => {
    const sheet = document.createElement('style');
    sheet.textContent = chromeCss;
    document.head.append(sheet);
    onTestFinished(() => sheet.remove());
    const { session, container } = withHistory();
    act(() => session.show('b'));
    const strip = () => container.querySelector<HTMLElement>('.deck-filmstrip')!;
    const order = (element: Element) => Number(getComputedStyle(element).order || 0);
    const stage = container.querySelector('.deck-editor-main')!;
    expect(strip().dataset.direction).toBe('vertical');
    expect(order(strip())).toBe(order(stage));
    editorWidth = 1000;
    layout();
    expect(strip().dataset.direction).toBe('horizontal');
    // The real scope wrapper is display:contents. The stylesheet must order its filmstrip after the stage, not merely
    // change the data attribute or match a direct-child nav that the editor never renders. Pixel bounds live in UX2 e2e.
    expect(order(strip())).toBeGreaterThan(order(stage));
    expect(session.snapshot().currentSlide).toBe('b');
    expect(strip().querySelector('[data-current]')!.getAttribute('data-slide-thumb')).toBe('b');
    editorWidth = 1100;
    layout();
    expect(strip().dataset.direction).toBe('vertical');
    expect(order(strip())).toBe(order(stage));
  });

  it('remeasures the card reservation while a preview narrows into a sheet', async () => {
    cardWidth = 288;
    const { session, container } = withHistory();
    act(() => session.toggleRail('history'));
    fireEvent.click(await screen.findByRole('button', { name: /^Version Draft 1 by/ }));
    await waitFor(() => expect(container.querySelector('[data-history-stage]')).not.toBeNull());
    const width = () => Number.parseFloat(container.querySelector<HTMLElement>('[data-history-stage] .deck-slide-frame')!.style.width);
    layout(WIDE);
    expect(width()).toBeCloseTo(848);
    layout({ w: 700, h: 800 });
    expect(width()).toBeCloseTo(652);
  });

  it('history Fit preserves its last usable size while hidden and refits when shown again', async () => {
    const { session, container } = withHistory();
    act(() => session.toggleRail('history'));
    fireEvent.click(await screen.findByRole('button', { name: /^Version Draft 1 by/ }));
    await waitFor(() => expect(container.querySelector('[data-history-stage]')).not.toBeNull());
    const width = () => container.querySelector<HTMLElement>('[data-history-stage] .deck-slide-frame')!.style.width;
    layout(WIDE);
    const wide = width();
    expect(Number.parseFloat(wide)).toBeGreaterThan(1000);
    layout({ w: 0, h: 0 });
    expect(width()).toBe(wide);
    layout(NARROW);
    expect(Number.parseFloat(width())).toBeLessThan(Number.parseFloat(wide));
    expect(Number.parseFloat(width())).toBeGreaterThan(800);
  });

  it('refits as a rail opens and closes beside the stage', () => {
    const { session } = withHistory();
    expect(shown()).toBe('Fit (60%)');
    act(() => session.toggleRail('comments'));
    layout(NARROW);
    expect(shown()).toBe('Fit (44%)');
    act(() => session.toggleRail('comments'));
    layout(WIDE);
    expect(shown()).toBe('Fit (60%)');
  });

  for (const rail of ['closed', 'open'] as const)
    it(`refits the stage a version’s preview gave back, with the comments rail ${rail}`, async () => {
      const { session, container, preview } = withHistory();
      await preview();
      if (rail === 'open') act(() => session.toggleRail('comments'));
      layout(rail === 'open' ? NARROW : WIDE);
      expect(shown()).toBe(rail === 'open' ? 'Fit (44%)' : 'Fit (60%)');
      expect(container.querySelector('[data-stage-slide] .maws-slide')).not.toBeNull();
    });

  it('a 0 × 0 reading (the stage hidden, a tab in the background) keeps the last scale', () => {
    withHistory();
    layout(WIDE);
    layout({ w: 0, h: 0 });
    expect(shown()).toBe('Fit (60%)');
    layout(NARROW);
    expect(shown()).toBe('Fit (44%)');
  });

  it('Fit chosen again after a fixed zoom draws at the fit of the stage a preview gave back', async () => {
    const { preview } = withHistory();
    await preview();
    layout(WIDE);
    fireEvent.change(zoom(), { target: { value: '1' } });
    expect(shown()).toBe('100%');
    expect(zoom().options[0]!.text).toBe('Fit (60%)'); // what Fit would draw at, read before it is chosen
    fireEvent.change(zoom(), { target: { value: 'fit' } });
    expect(shown()).toBe('Fit (60%)');
  });
});
