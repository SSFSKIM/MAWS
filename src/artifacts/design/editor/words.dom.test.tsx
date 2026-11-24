// The word cut on the design workbench (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4; the rows of
// editors.md whose place is "Design workbench"): what the toolbar, the boards rail, the canvas titles, the banners, the
// board inspector, the comments and the version preview say now, under happy-dom. What is drawn is the pictures'.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatChord } from '@shared/keymap/chord';
import { accessibleDescription } from '../../../renderer/src/test-support/accessible-text';
import type { DocumentComments } from '../../document/editor/comments/surface';
import { ROOT } from '../../slides/model';
import { DeckSession } from '../../slides/editor/session';
import { transact, type Doc } from '../../yjs';
import * as Y from '../../yjs/slides';
import { design, type BoardSeed } from '../fixtures/support';
import { MISSING_SOURCE_KEY } from '../model';
import { BoardList } from './BoardList';
import type { BoardView } from './boards';
import { designRailLabels } from './comments';
import { DesignWorkbench } from './DesignWorkbench';
import { DesignView } from './viewport';

const BOARDS: BoardSeed[] = [
  { id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone', body: '<h1 id="title">Launch</h1><p id="lede">Ship the first week.</p>' },
  { id: 'b2', at: { x: 500, y: 0, w: 1440, h: 1024 }, title: 'Desktop' },
];
const COMMENT_CHORD = formatChord('Cmd+Alt+M');

afterEach(cleanup);

const surface: DocumentComments = { opened: () => {}, overlay: () => null };
function mount(options: { doc?: Doc; comments?: boolean } = {}) {
  const doc = options.doc ?? design(BOARDS);
  const session = new DeckSession(doc, 0);
  const view = new DesignView();
  view.setRoom({ w: 1000, h: 800 });
  view.setViewport({ zoom: 1, x: 0, y: 0 });
  const utils = render(<DesignWorkbench session={session} view={view} assetUrl={() => null} system={null} readOnly={false} comments={options.comments === false ? undefined : surface} />);
  return { doc, session, view, ...utils };
}
const toolbar = () => screen.getByRole('toolbar', { name: 'Design' });
const openMenu = (trigger: HTMLElement) => fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
const title = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-board-title="${id}"]`)!;
const row = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-board-row="${id}"]`)!;

describe('the toolbar', () => {
  it('G510: the boards toggle’s tooltip reads “Boards” open and closed', () => {
    mount();
    const toggle = within(toolbar()).getByRole('button', { name: 'Boards' });
    expect(toggle.getAttribute('title')).toBe('Boards');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('title')).toBe('Boards');
  });

  it('G511, G513, G514: Add comment is a glyph named “Add comment”, its tooltip the word and the chord, and the board it goes on when no element is selected', () => {
    const { session, view } = mount();
    act(() => {
      session.show('b1');
      session.select(['lede']);
    });
    const comment = within(toolbar()).getByRole('button', { name: 'Add comment' });
    expect(comment.textContent).toBe(''); // a glyph: its word is its name
    expect(comment.querySelector('svg')).not.toBeNull();
    expect(comment.hasAttribute('title')).toBe(false);
    expect(accessibleDescription(comment)).toBe(COMMENT_CHORD);
    act(() => {
      session.select([]);
      view.selectFrame('b2');
    });
    expect(accessibleDescription(comment)).toBe(`On Desktop · ${COMMENT_CHORD}`);
    expect(comment.hasAttribute('aria-disabled')).toBe(false);
  });

  it('G513: with several elements selected, Add comment is greyed with its reason and keeps the keyboard', () => {
    const { session } = mount();
    act(() => {
      session.show('b1');
      session.select(['title', 'lede']);
    });
    const comment = within(toolbar()).getByRole('button', { name: 'Add comment' });
    expect(comment.getAttribute('aria-disabled')).toBe('true');
    expect(comment.hasAttribute('disabled')).toBe(false);
    expect(accessibleDescription(comment)).toBe(`Select one element or a board to comment on · ${COMMENT_CHORD}`);
  });

  it('G512: the toolbar has no Comments button of its own; the header’s opens the rail', () => {
    mount();
    expect(within(toolbar()).queryByRole('button', { name: /^Comments/ })).toBeNull();
    expect(toolbar().querySelector('[data-comments-toggle]')).toBeNull();
  });
});

describe('the boards rail', () => {
  it('G522: a row shows the board’s name at rest; its size waits for pointing or focus in the row, and stays in its name', () => {
    const { container } = mount();
    const phone = row(container, 'b1');
    expect(phone.hasAttribute('data-hover-scope')).toBe(true);
    const size = phone.querySelector<HTMLElement>('.design-board-size')!;
    expect(size.textContent).toBe('390 × 844');
    expect(size.hasAttribute('data-on-hover')).toBe(true);
    expect(phone.querySelector('.design-board-name')!.hasAttribute('data-on-hover')).toBe(false);
    expect(within(phone).getByRole('button', { name: 'Phone, 390 × 844' })).toBeTruthy();
  });

  it('G525: a row’s menu reads Zoom to board, Rename, Duplicate, Move up, Move down, Delete', () => {
    mount();
    openMenu(screen.getByRole('button', { name: 'Board Desktop options' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Zoom to board', 'Rename', 'Duplicate', 'Move up', 'Move down', 'Delete']);
  });

  it('G526: with no boards, the canvas alone says so; the rail is its header and Add board', () => {
    const { container } = mount({ doc: design([]) });
    expect(container.textContent!.split('This design has no boards yet.')).toHaveLength(2);
    const rail = screen.getByRole('navigation', { name: 'Boards' });
    expect(rail.textContent).toBe('Boards+');
  });

  it('G527: at its limit the rail’s note reads the limit', () => {
    const doc = design([]);
    const boards: BoardView[] = Array.from({ length: 200 }, (_, i) => ({ id: `b${i}`, title: '', frame: { x: i * 10, y: 0, w: 10, h: 10 }, held: null, missing: false, token: {} }));
    const noop = () => {};
    const { container } = render(<BoardList session={new DeckSession(doc, 0)} boards={boards} current={null} frame={null} readOnly={false} onSelect={noop} onZoomTo={noop} onAdd={noop} onDuplicate={noop} onRemove={noop} onRename={noop} />);
    expect(container.querySelector('.deck-filmstrip-note')!.textContent).toBe('200 boards is the most');
  });
});

describe('the canvas', () => {
  it('G528: a board’s title shows its name at rest; its size waits for pointing, focus or the board selected, and its tooltip keeps both', () => {
    const { container } = mount();
    const phone = title(container, 'b1');
    expect(phone.hasAttribute('data-hover-scope')).toBe(true);
    expect(phone.querySelector('.design-board-title-size')!.hasAttribute('data-on-hover')).toBe(true);
    expect(phone.querySelector('.design-board-title-name')!.textContent).toBe('Phone');
    expect(phone.getAttribute('title')).toBe('Phone, 390 × 844');
  });

  it('G529: a held board’s title has no Held badge; its rail row keeps it (G523) and its board its dashed outline', () => {
    const doc = design(BOARDS);
    transact(doc, () => Y.setSlideKey(doc, 'b2', 'held', { source: '<section id="b2"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] }));
    const { container } = mount({ doc });
    expect(title(container, 'b2').querySelector('.design-board-badge')).toBeNull();
    expect(row(container, 'b2').querySelector('.design-board-badge')!.textContent).toBe('Held');
    expect(container.querySelector('[data-board-mark="b2"]')).not.toBeNull();
  });
});

describe('the banners', () => {
  it('G533, G534: a held board’s banner is one line, the loader’s reasons folded under it, opened by the line', () => {
    const doc = design(BOARDS);
    transact(doc, () => Y.setSlideKey(doc, 'b2', 'held', { source: '<section id="b2"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] }));
    const { container, session } = mount({ doc });
    act(() => session.show('b2'));
    const banner = container.querySelector<HTMLElement>('[data-held-banner]')!;
    const fold = banner.querySelector('details')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('This board’s file doesn’t load; showing its last good version.');
    expect(fold.querySelector('li')!.textContent).toBe('an unknown tag <blink>');
  });

  // M5 task 4's review: the fold is the board's, so moving straight from one held board to another starts it closed
  it('G534: a fold opened on one held board is closed on the next', () => {
    const doc = design(BOARDS);
    transact(doc, () => {
      Y.setSlideKey(doc, 'b2', 'held', { source: '<section id="b2"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
      Y.setSlideKey(doc, 'b1', 'held', { source: '<section id="b1"><marquee>x</marquee></section>', reasons: ['an unknown tag <marquee>'] });
    });
    const { container, session } = mount({ doc });
    act(() => session.show('b2'));
    const fold = () => container.querySelector<HTMLDetailsElement>('[data-held-banner] details')!;
    fold().open = true;
    act(() => session.show('b1'));
    expect(fold().querySelector('li')!.textContent).toBe('an unknown tag <marquee>');
    expect(fold().open).toBe(false);
  });

  it('G535: a board whose file never arrived reads that it has not arrived yet', () => {
    const doc = design(BOARDS);
    transact(doc, () => Y.setSlideKey(doc, 'b2', MISSING_SOURCE_KEY, true));
    const { container, session } = mount({ doc });
    act(() => session.show('b2'));
    expect(container.querySelector('[data-missing-banner]')!.textContent).toBe('This board’s file hasn’t arrived yet.');
  });
});

describe('the board inspector', () => {
  it('G536, G538, G539: keeps its board heading, “Board” and “Board name”; the size caption reads “Size”; a refused size reads its limit', () => {
    const { container } = mount();
    fireEvent.click(title(container, 'b1'));
    const inspector = container.querySelector<HTMLElement>('[data-board-inspector="b1"]')!;
    expect(inspector.querySelector('h2')!.textContent).toBe('Phone');
    expect(within(inspector).getByText('Board')).toBeTruthy();
    expect(within(inspector).getByText('Board name')).toBeTruthy();
    const size = within(inspector).getByRole('combobox', { name: 'Board size' });
    expect(size.closest('.deck-inspector-row')!.querySelector('.deck-inspector-caption')!.textContent).toBe('Size');
    const width = within(inspector).getByRole('textbox', { name: 'Board width' });
    fireEvent.change(width, { target: { value: '20000' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    expect(within(inspector).getByRole('alert').textContent).toBe('At most 16,384 px a side');
  });

  it('G541: Move to board…’s tooltip reads “Move to another board”', () => {
    const { session } = mount();
    act(() => {
      session.show('b1');
      session.select(['lede']);
    });
    expect(screen.getByRole('button', { name: 'Move to board…' }).getAttribute('title')).toBe('Move to another board');
  });
});

describe('the toolbar notice for a refused board edit (G518)', () => {
  it('a resize past the cap reads its limit, with no board id', () => {
    const { container } = mount();
    fireEvent.click(title(container, 'b2'));
    const world = container.querySelector<HTMLElement>('[data-design-world]')!;
    fireEvent.pointerDown(container.querySelector('[data-board-handle="s"]')!, { button: 0, buttons: 1, clientX: 600, clientY: 1024, pointerId: 1 });
    fireEvent.pointerMove(world, { buttons: 1, clientX: 600, clientY: 1024 + 16_000, pointerId: 1 });
    fireEvent.pointerUp(world, { button: 0, clientX: 600, clientY: 1024 + 16_000, pointerId: 1 });
    expect(container.querySelector('[data-deck-notice]')!.textContent).toBe('At most 16,384 px a side');
  });
});

describe('the comments rail’s words (G542, G543, G545)', () => {
  const boards: BoardView[] = [{ id: 'b1', title: 'Phone', frame: { x: 0, y: 0, w: 390, h: 844 }, held: null, missing: false, token: {} }];
  const labels = designRailLabels(boards);
  const thread = (slideId: string, elementId: string) => ({ id: 't', slideId, elementId, quote: 'Phone' }) as Parameters<typeof labels.target>[0];

  it('names the control to choose when nothing is open', () => {
    expect(labels.empty).toBe('No open comments. Select a board or an element and choose Add comment.');
  });

  it('locates a board’s own thread by the board’s name alone, as an element’s', () => {
    expect(labels.target(thread('b1', ROOT), null).location).toBe('Phone');
    expect(labels.target(thread('b1', 'lede'), null).location).toBe('Phone');
  });

  it('a thread whose board was deleted says so once, in its location; one whose element went says “Element deleted”', () => {
    expect(labels.target(thread('gone', ROOT), null)).toMatchObject({ location: 'A deleted board', orphan: null });
    expect(labels.target(thread('gone', 'lede'), null)).toMatchObject({ location: 'A deleted board', orphan: null });
    expect(labels.target(thread('b1', 'lede'), null).orphan).toBe('Element deleted');
  });
});
