// P3-F1 (fix 1, docs/doperpowers/ledgers/2026-10-17-P3-F1.md): the document shell in a narrow artifact panel. The rail
// (Comments, History) sits beside the page from a 720 px body up, capped there by the stylesheet, and below that is a
// drawer over the page's right side, starting at the page's top (under the toolbar and find), the page's layout untouched
// beneath it, closed by Escape; the formatting toolbar is one row whose tools scroll in a strip while its menus open
// under their buttons, kept inside the toolbar, and the strip says which way it has more. happy-dom lays nothing out,
// so the geometry each rule reads is given here (a body width, the page frame's top, a button's place) and the observers
// the shell follows are driven by hand.
import type { AppSessionId } from '@shared/graph/ids';
import { applyEdit } from '../patch-writer';
import type { Editor } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commentSelection } from './comments/plugins';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import { MemoryHistory } from './history/memory-history';
import { TAB, World, doc, para, until } from './test-world';

const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

// Every ResizeObserver the shell makes, so a test can report a resize as the browser would.
const observers = new Set<{ callback: ResizeObserverCallback; self: ResizeObserver }>();
class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    observers.add({ callback, self: this as unknown as ResizeObserver });
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    for (const entry of observers) if (entry.self === (this as unknown as ResizeObserver)) observers.delete(entry);
  }
}
const resized = () =>
  act(() => {
    for (const { callback, self } of [...observers]) callback([], self);
  });

// The laid-out geometry: the body is `width` wide at y 40; the toolbar row is 37 px, find adds 36; the toolbar starts at
// x 100 (in the toolbar tests) and each menu button sits at its offset in the strip, less the strip's scroll.
let width = 1200;
const TOOLBAR_LEFT = 100;
const BUTTON_AT: Record<string, number> = { Insert: 400, Link: 250 };
const POPOVER_WIDTH = 160;
function rect(this: Element): DOMRect {
  const box = (x: number, y: number, w: number, h: number) => new DOMRect(x, y, w, h);
  if (this.classList.contains('doc-pill')) return box(180, 85, 240, 32);
  if (this.classList.contains('doc-editor-body')) return box(0, 40, width, 760);
  if (this.classList.contains('doc-page-frame')) {
    const top = 40 + 37 + (this.parentElement?.querySelector('.doc-find') ? 36 : 0);
    return box(0, top, width, 800 - top);
  }
  if (this.matches('[role="toolbar"][aria-label="Formatting"]')) return box(TOOLBAR_LEFT, 40, width, 37);
  if (this.classList.contains('doc-menu-anchor')) {
    const name = this.querySelector('button')?.getAttribute('aria-label') ?? '';
    const strip = this.closest<HTMLElement>('.doc-toolbar-tools');
    return box(TOOLBAR_LEFT + (BUTTON_AT[name] ?? 0) - (strip?.scrollLeft ?? 0), 44, 28, 28);
  }
  if (this.matches('.doc-menu, .doc-popover')) return box(0, 77, POPOVER_WIDTH, 200);
  return box(0, 0, 0, 0);
}

let world: World | null = null;
let history: MemoryHistory | null = null;
let handles: DocumentHandle[] = [];
beforeEach(() => {
  width = 1200;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(rect);
});
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
  history?.destroy();
  history = null;
  world?.destroy();
  world = null;
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let editor: Editor | null = null;
async function mount({ withHistory = false }: { withHistory?: boolean } = {}): Promise<HTMLElement> {
  world = new World(doc(para('p1', 'The owner reviews the launch plan today.')));
  const handle = openMemoryHandle(world.host, { log: () => {} });
  handles.push(handle);
  await whenSynced(handle);
  editor = null;
  history = withHistory ? new MemoryHistory(world.host) : null;
  const { container } = render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} {...(history && { history })} onEditor={(e) => (editor = e)} />);
  await until(() => editor !== null && editor.getText().length > 0, 'the editor to bind');
  // a thread on "launch plan", so the rail has a reply field
  act(() => {
    editor!.commands.setTextSelection({ from: 23, to: 34 });
    commentSelection(editor!, handle.doc, { threadId: 'th1', tabId: TAB, by: { kind: 'human' }, at: 1 });
  });
  return container;
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Formatting' });
const press = (name: string | RegExp) => act(() => fireEvent.click(within(toolbar()).getByRole('button', { name })));
const body = (container: HTMLElement) => container.querySelector<HTMLElement>('.doc-editor-body')!;
const layout = (container: HTMLElement) => body(container).getAttribute('data-rail-layout');
const resizeTo = (next: number) => {
  width = next;
  resized();
};

describe('the rail in the body’s width', () => {
  it.each(['Comments', 'Version history'])('keeps a new-changes pill above the %s drawer rather than straddling it', async (name) => {
    width = 600;
    const container = await mount({ withHistory: true });
    await until(() => history!.viewedAt !== null, 'first look');
    await until(() => handles[0].state().unsaved === 0, 'comment saved');
    act(() => world!.host.write(doc => void applyEdit(doc, [{ op: 'insert', after: 'p1', markdown: 'A new agent paragraph. ^newp' }]), { kind: 'session', appSessionId: 'agent' as AppSessionId }));
    await until(() => editor!.getText().includes('A new agent paragraph.'), 'agent edit');
    act(() => history!.version('turn', { kind: 'session', appSessionId: 'agent' as AppSessionId }));
    await act(async () => { history!.returned(); });
    await until(() => container.querySelector('.doc-pill') !== null, 'new changes pill');
    press(new RegExp(`^${name}`));
    resized();
    const pill = container.querySelector<HTMLElement>('.doc-pill')!.getBoundingClientRect();
    const drawerTop = body(container).getBoundingClientRect().top + Number.parseFloat(body(container).style.getPropertyValue('--doc-drawer-top'));
    expect(drawerTop).toBeGreaterThanOrEqual(pill.bottom);
    expect(screen.getByRole('complementary', { name })).toBeTruthy();
  });

  it('sits beside the page from 720 px up and is a drawer below; with no rail open there is no rail layout', async () => {
    const container = await mount();
    expect(layout(container)).toBeNull();
    press(/^Comments/);
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBeTruthy();
    expect(layout(container)).toBe('beside');
    resizeTo(720);
    expect(layout(container)).toBe('beside');
    resizeTo(719);
    expect(layout(container)).toBe('drawer');
    resizeTo(600);
    expect(layout(container)).toBe('drawer');
    resizeTo(1400);
    expect(layout(container)).toBe('beside');
    press(/^Comments/);
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull();
    expect(layout(container)).toBeNull();
  });

  it('opens as a drawer at once in a narrow body, without waiting for a resize', async () => {
    width = 600;
    const container = await mount();
    press(/^Comments/);
    expect(layout(container)).toBe('drawer');
  });

  it('is beside the page in a body not laid out (0 px), as before the rule', async () => {
    width = 0;
    const container = await mount();
    press(/^Comments/);
    expect(layout(container)).toBe('beside');
  });

  it.each([600, 1200])('floats below the toolbar and find at %i px, without moving those controls into the card', async (bodyWidth) => {
    width = bodyWidth;
    const container = await mount();
    press(/^Comments/);
    expect(body(container).style.getPropertyValue('--doc-drawer-top')).toBe('37px');
    press('Find');
    expect(screen.getByRole('search')).toBeTruthy();
    resized(); // the page frame shrank as find opened
    expect(body(container).style.getPropertyValue('--doc-drawer-top')).toBe('73px');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Close find' })));
    resized();
    expect(body(container).style.getPropertyValue('--doc-drawer-top')).toBe('37px');
  });

  it('as a drawer closes on Escape inside it and gives the keyboard back to the page; beside the page Escape leaves it', async () => {
    width = 600;
    const container = await mount();
    press(/^Comments/);
    const rail = screen.getByRole('complementary', { name: 'Comments' });
    act(() => fireEvent.keyDown(within(rail).getByRole('button', { name: 'Close comments' }), { key: 'Escape' }));
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[data-editor="live"]'));

    resizeTo(1200);
    press(/^Comments/);
    expect(layout(container)).toBe('beside');
    act(() => fireEvent.keyDown(within(screen.getByRole('complementary', { name: 'Comments' })).getByRole('button', { name: 'Close comments' }), { key: 'Escape' }));
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBeTruthy();
  });

  it('as a drawer leaves an Escape in a reply being written to the reply (the draft is not lost); an empty reply’s closes it', async () => {
    width = 600;
    await mount();
    press(/^Comments/);
    const field = () => within(screen.getByRole('complementary', { name: 'Comments' })).getByRole('textbox', { name: 'Reply' });
    act(() => fireEvent.change(field(), { target: { value: 'Not yet sent' } }));
    act(() => fireEvent.keyDown(field(), { key: 'Escape' }));
    expect((field() as HTMLTextAreaElement).value).toBe('Not yet sent');
    act(() => fireEvent.change(field(), { target: { value: '' } }));
    act(() => fireEvent.keyDown(field(), { key: 'Escape' }));
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull();
  });

  // The panel's follow-up: only a text-entry control holding text keeps the Escape; a checkbox's value is 'on' whatever
  // its state, and there is no draft in it to lose.
  it('as a drawer closes on Escape from History’s Named only checkbox; a version name being written keeps it', async () => {
    width = 600;
    const container = await mount({ withHistory: true });
    const rail = () => screen.queryByRole('complementary', { name: 'Version history' });
    const openHistory = async () => {
      press('Version history');
      await until(() => rail() !== null, 'the history rail');
    };
    await openHistory();
    expect(layout(container)).toBe('drawer');
    const named = within(rail()!).getByRole('checkbox', { name: 'Named only' }) as HTMLInputElement;
    expect(named.value).toBe('on');
    act(() => fireEvent.keyDown(named, { key: 'Escape' }));
    expect(rail(), 'Escape on the checkbox closes the drawer').toBeNull();

    await openHistory();
    act(() => fireEvent.click(within(rail()!).getByRole('button', { name: 'Save version' })));
    const name = within(rail()!).getByRole('textbox', { name: 'Version name' });
    act(() => fireEvent.change(name, { target: { value: 'Draft to legal' } }));
    act(() => fireEvent.keyDown(name, { key: 'Escape' }));
    expect(rail(), 'the name being written is not lost').not.toBeNull();
    expect((within(rail()!).getByRole('textbox', { name: 'Version name' }) as HTMLInputElement).value).toBe('Draft to legal');
  });

  // F's L241: closing History ends its preview, so the page Escape gives the keyboard back to is the live one, once the
  // preview has gone (the preview's page, focused first, went with it and the focus with it)
  it('as a drawer closes History on Escape while a version is previewed and gives the keyboard back to the live page', async () => {
    // happy-dom renders nothing: a page under `hidden` (the live one while a version is previewed) reads as visible and
    // takes the focus, neither of which a browser's does; this case holds happy-dom to the browser's rule
    const unrendered = (element: Element) => element.closest('[hidden]') !== null;
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(Element.prototype, 'checkVisibility').mockImplementation(function (this: Element) {
      return !unrendered(this);
    });
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (!unrendered(this)) focus.call(this, options);
    });
    width = 600;
    const container = await mount({ withHistory: true });
    history!.version('named', undefined, { label: 'Before' });
    press('Version history');
    const rail = () => screen.queryByRole('complementary', { name: 'Version history' });
    await until(() => rail() !== null && within(rail()!).queryAllByRole('button', { name: /^Version Before/ }).length > 0, 'the version list');
    expect(layout(container)).toBe('drawer');
    act(() => fireEvent.click(within(rail()!).getByRole('button', { name: /^Version Before/ })));
    await until(() => container.querySelector('[data-editor="preview"]') !== null && screen.queryByText('Loading the version…') === null, 'the preview');
    act(() => fireEvent.keyDown(within(rail()!).getByRole('checkbox', { name: 'Named only' }), { key: 'Escape' }));
    expect(rail()).toBeNull();
    const live = container.querySelector('[data-editor="live"]');
    await until(() => container.querySelector('[data-editor="preview"]') === null && document.activeElement === live, 'the live page focused once the preview went');
  });

  it('does not take an Escape the page handles itself (find closes, the drawer stays)', async () => {
    width = 600;
    await mount();
    press(/^Comments/);
    press('Find');
    act(() => fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find in document' }), { key: 'Escape' }));
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBeTruthy();
  });
});

describe('the formatting toolbar in a narrow body', () => {
  const strip = () => toolbar().querySelector<HTMLElement>('.doc-toolbar-tools')!;
  const popoverLeft = () => toolbar().style.getPropertyValue('--doc-popover-left');

  it('keeps the formatting tools in one strip and the comment, history and find controls after it', async () => {
    await mount();
    const tools = strip();
    for (const name of ['Undo', 'Bold', 'Link', 'Insert', 'Code block']) expect(within(tools).getByRole('button', { name })).toBeTruthy();
    const end = toolbar().querySelector<HTMLElement>('.doc-toolbar-end')!;
    for (const name of [/^Comments/, 'Find']) expect(within(end).getByRole('button', { name })).toBeTruthy();
    expect(tools.contains(end)).toBe(false);
  });

  it('opens Insert’s menu under its button wherever the strip is scrolled, and the menu’s items insert', async () => {
    width = 600;
    await mount();
    press('Insert');
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(popoverLeft()).toBe('400px');
    act(() => {
      strip().scrollLeft = 150;
      fireEvent.scroll(strip());
    });
    expect(popoverLeft()).toBe('250px');
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: 'Table' })));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.querySelector('.ds-doc table')).not.toBeNull();
  });

  it('keeps a menu inside the toolbar when its button is near the toolbar’s right edge', async () => {
    width = 450; // Insert at 400 with a 160 px menu would end at 560
    await mount();
    press('Insert');
    expect(popoverLeft()).toBe(`${450 - POPOVER_WIDTH}px`);
  });

  it('places the link form under Link as well', async () => {
    width = 600;
    await mount();
    press('Link');
    expect(screen.getByRole('textbox', { name: 'Link address' })).toBeTruthy();
    expect(popoverLeft()).toBe('250px');
  });

  it('says which way the strip has more tools, following its scroll and its size', async () => {
    await mount();
    const tools = strip();
    let scrollWidth = 300;
    Object.defineProperty(tools, 'scrollWidth', { configurable: true, get: () => scrollWidth });
    Object.defineProperty(tools, 'clientWidth', { configurable: true, get: () => 320 });
    resized();
    expect(tools.dataset.overflow).toBeUndefined();
    scrollWidth = 900;
    resized();
    expect(tools.dataset.overflow).toBe('end');
    act(() => {
      tools.scrollLeft = 100;
      fireEvent.scroll(tools);
    });
    expect(tools.dataset.overflow).toBe('both');
    act(() => {
      tools.scrollLeft = 580;
      fireEvent.scroll(tools);
    });
    expect(tools.dataset.overflow).toBe('start');
  });
});
