// The word cut in the slides editor (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3; editors.md): the
// toolbar's History, Add comment, Comments and Inspector are named glyphs (G401 to G404), the zoom reads the bare
// percentage while Fit is chosen (G400), a notice is notice.dom.test's (G413), the
// filmstrip's menu, hidden badge and section actions say less (G424, G428, G429), the held banner and the empty stage
// shorten (G431 to G433), the inspector card is headed by what it edits (G439), the comments rail's toggle, orphan note
// and reply (G479, G481, G482), and the version bar (G489, G490, G492, G498). Happy-dom over a replica, as the editor's
// own suite.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { accessibleDescription, accessibleText } from '../../../renderer/src/test-support/accessible-text';
import { realTimeouts } from '../../../renderer/src/test-support/fake-timeouts';
import type { DocumentComments } from '../../document/editor/comments/surface';
import { newDoc, transact, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { deleteElementTree, importSlide, setNotes, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import { addThread } from '../threads';
import { DeckEditor } from './DeckEditor';
import type { DeckHistoryController, DeckPreview } from './history/controller';
import { HistoryBar } from './history/HistoryBar';
import { DeckSession } from './session';

const SLIDE = (id: string) => `<section id="${id}" style="background:#ffffff"><h2 id="t${id}" style="font-size:64px">Slide ${id}</h2><p id="p${id}" style="position:absolute; left:100px; top:400px; width:400px; height:100px">Body ${id}</p></section>`;

function deck(ids = ['a', 'b', 'c']): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'Q3', order: ids, sections: ids.length ? { s1: { description: 'Opening', start: ids[0]! } } : undefined });
    ids.forEach((id, i) => {
      const l = loadSlide(SLIDE(id));
      if (!l.ok) throw new Error('fixture');
      importSlide(doc, l.slide, `a${i}`);
    });
    if (ids.includes('b')) Y.setSlideKey(doc, 'b', 'attr:hidden', '');
    if (ids.includes('c')) Y.setSlideKey(doc, 'c', 'held', { source: '<section id="c"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
  });
  return doc;
}

const comments: DocumentComments = { opened: () => {}, overlay: () => null };

function mount(doc = deck(), options: { comments?: boolean } = {}) {
  const session = new DeckSession(doc, 0);
  const utils = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} comments={options.comments ? comments : undefined} commentAuthor={{ actor: { kind: 'human' }, now: () => 1_000 }} />);
  return { doc, session, ...utils };
}
const toolbar = () => screen.getByRole('toolbar', { name: 'Deck' });
const tool = (name: string | RegExp) => within(toolbar()).getByRole('button', { name });

afterEach(() => {
  cleanup();
  realTimeouts();
});

describe('the toolbar’s glyphs (G401 to G404)', () => {
  it('draws Inspector, Add comment and Comments as glyphs named by their words', () => {
    const doc = deck();
    transact(doc, () => addThread(doc, { threadId: 'th1', slideId: 'a', elementId: 'ta', quote: 'Slide a', by: { kind: 'human' }, at: 1, body: 'Look' }));
    mount(doc, { comments: true });
    for (const name of ['Inspector', 'Add comment', 'Comments (1 open)']) {
      const glyph = tool(name);
      expect(glyph.querySelector('svg'), `${name} is a glyph`).not.toBeNull();
      expect(glyph.getAttribute('title'), `${name}’s tooltip is the keyboard’s too`).toBeNull();
    }
    expect(accessibleText(tool('Inspector')).trim()).toBe('');
    expect(accessibleText(tool('Add comment')).trim()).toBe('');
    // G404 (seen): the open count is a small corner badge on the glyph, and the tooltip says Comments
    const toggle = tool('Comments (1 open)');
    expect(toggle.querySelector('[data-comments-count]')?.textContent).toBe('1');
    act(() => toggle.focus());
    expect(screen.getByRole('tooltip').textContent).toBe('Comments');
  });

  it('keeps Add comment’s tooltip, Comment on the selected element, with its chord; its name stays Add comment', () => {
    const { session } = mount(deck(), { comments: true });
    act(() => session.select(['ta']));
    const add = tool('Add comment');
    act(() => add.focus());
    expect(screen.getByRole('tooltip').textContent).toBe('Comment on the selected element · ⌘⌥M');
  });

  it('greys Add comment, still focusable, until one element is selected, its chord in the tooltip', () => {
    const { session } = mount(deck(), { comments: true });
    const add = tool('Add comment');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect((add as HTMLButtonElement).disabled).toBe(false);
    expect(accessibleDescription(add)).toBe('Select one element to comment on · Comment on the selected element · ⌘⌥M');
    act(() => session.select(['ta']));
    expect(tool('Add comment').getAttribute('aria-disabled')).toBeNull();
    expect(accessibleDescription(tool('Add comment'))).toBe('Comment on the selected element · ⌘⌥M'); // where the comment goes, heard too
  });

  it('draws no comment count at zero', () => {
    mount(deck(), { comments: true });
    expect(tool('Comments').querySelector('[data-comments-count]')).toBeNull();
  });
});

describe('the zoom (G400)', () => {
  it('reads the bare percentage while Fit is chosen, Fit in its tooltip, and Fit once another zoom is chosen', () => {
    mount();
    const zoom = within(toolbar()).getByRole('combobox', { name: 'Zoom' }) as HTMLSelectElement;
    const fit = () => zoom.querySelector<HTMLOptionElement>('option[value="fit"]')!;
    expect(fit().textContent).toMatch(/^\d+%$/);
    expect(accessibleDescription(zoom)).toBe('Fit');
    fireEvent.change(zoom, { target: { value: '1' } });
    expect(fit().textContent).toBe('Fit');
    expect(accessibleDescription(zoom)).toBe('');
  });
});

describe('the filmstrip (G424, G428, G429)', () => {
  it('a slide’s menu reads Duplicate, Hide, New section here and Delete', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Slide 2 options' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Duplicate', 'Show', 'New section here', 'Delete']);
  });

  it('marks a hidden slide with a glyph, not the word, its name still saying hidden', () => {
    const { container } = mount();
    const thumb = container.querySelector('[data-slide-thumb="b"]')!;
    expect(within(thumb as HTMLElement).getByRole('button', { name: 'Slide 2, hidden' })).toBeTruthy();
    expect(thumb.textContent).not.toContain('Hidden');
    expect(thumb.querySelector('[data-hidden-mark] svg')).not.toBeNull();
  });

  it('a section title’s rename and remove wait for the pointer or focus; a double-click renames', () => {
    const { container } = mount();
    const section = container.querySelector<HTMLElement>('[data-section-key="s1"]')!;
    expect(section.hasAttribute('data-hover-scope')).toBe(true);
    const rename = within(section).getByRole('button', { name: 'Rename section Opening' });
    expect(rename.closest('[data-on-hover]')).not.toBeNull();
    expect(rename.textContent).toBe(''); // a pencil, not the word
    expect(within(section).getByRole('button', { name: 'Remove section Opening' }).closest('[data-on-hover]')).not.toBeNull();
    fireEvent.doubleClick(within(section).getByText('Opening'));
    expect(screen.getByRole('textbox', { name: 'Section name' })).toBeTruthy();
  });
});

describe('the stage (G431 to G433)', () => {
  it('the held banner says the last good version shows, its reasons behind Details', () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Slide 3, held' }));
    const banner = container.querySelector<HTMLElement>('[data-held-banner]')!;
    expect(banner.querySelector('strong')!.textContent).toBe('Showing the last good version (read-only). The agent’s next valid file fixes it.');
    const details = banner.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Details');
    expect(details.textContent).toContain('an unknown tag <blink>');
  });

  it('an empty deck’s stage says so', () => {
    mount(deck([]));
    expect(screen.getByRole('region', { name: 'Slide' }).textContent).toBe('No slides yet');
  });
});

describe('the notes (G436 to G438)', () => {
  it('an opened, empty notes field has no placeholder; notes too long say so with the numbers', () => {
    const doc = deck(['a']);
    const { session } = mount(doc);
    act(() => session.setNotesOpen(true));
    const field = screen.getByRole('textbox', { name: 'Speaker notes' }) as HTMLTextAreaElement;
    expect(field.placeholder).toBe('');
    field.value = 'x'.repeat(4_312);
    fireEvent.input(field);
    expect(screen.getByRole('alert').textContent).toBe('Too long to save: 4,312 / 4,000');
  });

  // the pair review (G436): with no placeholder, opening must visibly open something; the field takes the caret, after
  // the notes it holds
  it('opening the notes puts the caret in the field, after its text; a field already open at mount takes no focus', () => {
    const doc = deck(['a']);
    setNotes(doc, 'a', 'Mention the Q3 numbers');
    const { session } = mount(doc);
    const disclosure = screen.getByRole('button', { name: 'Speaker notes' });
    fireEvent.click(disclosure);
    const field = screen.getByRole('textbox', { name: 'Speaker notes' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([22, 22]);
    fireEvent.click(disclosure);
    expect(session.snapshot().notesOpen).toBe(false);
    cleanup();
    const reopened = new DeckSession(doc, 0);
    reopened.setNotesOpen(true);
    render(<DeckEditor session={reopened} assetUrl={() => null} system={null} readOnly={false} commentAuthor={{ actor: { kind: 'human' }, now: () => 1_000 }} />);
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Speaker notes' }));
  });
});

describe('the inspector card (G439)', () => {
  it('is headed by what it edits, with its ×; the word Inspector stays the panel’s name only', () => {
    const { session } = mount();
    fireEvent.click(tool('Inspector'));
    const panel = screen.getByRole('complementary', { name: 'Inspector' });
    const card = panel.closest('.deck-tool-card')!;
    expect(card.textContent).not.toContain('Inspector');
    expect(within(panel).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Slide']);
    act(() => session.select(['pa']));
    expect(within(panel).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Text']);
    fireEvent.click(within(panel).getByRole('button', { name: 'Close inspector' }));
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  });
});

describe('the comments rail (G479, G481, G482)', () => {
  it('reads Show deleted, named in full; an orphan says Element deleted; Reply is a send glyph greyed while empty', () => {
    const doc = deck(['a']);
    transact(doc, () => {
      addThread(doc, { threadId: 'th1', slideId: 'a', elementId: 'ta', quote: 'Slide a', by: { kind: 'human' }, at: 1, body: 'Keep' });
      addThread(doc, { threadId: 'th2', slideId: 'a', elementId: 'pa', quote: 'Body a', by: { kind: 'human' }, at: 2, body: 'Gone' });
    });
    transact(doc, () => deleteElementTree(doc, 'a', ['pa'], 'remote'));
    const { session } = mount(doc, { comments: true });
    act(() => session.toggleRail('comments'));
    const rail = screen.getByRole('complementary', { name: 'Comments' });
    const toggle = within(rail).getByRole('button', { name: 'Show deleted-target comments' });
    expect(toggle.textContent).toBe('Show deleted');
    fireEvent.click(toggle);
    expect(within(rail).getByRole('button', { name: 'Hide deleted-target comments' }).textContent).toBe('Hide deleted');
    const orphan = rail.querySelector('[data-thread="th2"]')!;
    expect(orphan.querySelector('.deck-thread-note')!.textContent).toBe('Element deleted');
    const live = rail.querySelector<HTMLElement>('[data-thread="th1"]')!;
    const send = within(live).getByRole('button', { name: 'Reply' });
    expect(send.querySelector('svg')).not.toBeNull();
    expect(accessibleText(send).trim()).toBe('');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect(accessibleDescription(send)).toBe('Write a reply first');
    expect((within(live).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement).placeholder).toBe('Reply…');
  });
});

describe('the version bar (G489, G490, G492)', () => {
  function bar(focus: number | null) {
    const preview = { title: 'Before the review', showChanges: true, changes: { count: 5 }, focus, stops: [1, 2, 3, 4, 5], versionId: 'v1' } as unknown as DeckPreview;
    const controller = { canName: true, setShowChanges: () => {}, step: () => {}, duplicate: async () => {}, name: async () => true, restore: async () => {} } as unknown as DeckHistoryController;
    return render(<HistoryBar preview={preview} controller={controller} onBack={() => {}} />);
  }

  it('steps through changes as “2 / 5”, named in words', () => {
    bar(1);
    const count = screen.getByRole('img', { name: 'Change 2 of 5' });
    expect(count.textContent).toBe('2 / 5');
  });

  it('reads Restore, Make a copy, Name and Done, each keeping its full name, which its tooltip shows', () => {
    bar(null);
    const named = (name: string) => screen.getByRole('button', { name });
    expect(named('Restore this version').textContent).toBe('Restore');
    expect(named('Make a copy').textContent).toBe('Make a copy');
    expect(named('Name this version').textContent).toBe('Name');
    // the review's fix: the name begins with the word drawn (label in name, WCAG 2.5.3); the tooltip says where it goes
    expect(named('Done, back to presentation').textContent).toBe('Done');
    for (const name of ['Restore this version', 'Name this version', 'Done, back to presentation']) expect(named(name).getAttribute('title')).toBeNull();
    act(() => named('Done, back to presentation').focus());
    expect(screen.getByRole('tooltip').textContent).toBe('Back to presentation');
    fireEvent.click(named('Name this version'));
    expect((screen.getByRole('textbox', { name: 'Version name' }) as HTMLInputElement).placeholder).toBe('Version name');
  });
});
