// P3-G (§D2.2, M3): the panel's header over C8a's host in C5's region: the strip's label for a tool that registers
// nothing (its `setTitle` suffix included), "Session overview" on the summary, and an editor's X32 registration drawn
// as the breadcrumb, the saved state, the open-comment count, its actions (three, then "More actions"), its Export menu,
// beside the region's own controls, all of them folded into "More actions" under a 360 px header; an inactive tab's
// registration still vetoes its close.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSlot, resetSlots } from '../app/slots';
import { queryClient } from '../ipc/query';
import { A, probeTool, resetPanelStores, type ProbeState } from '../test-support/panel';
import { installResizeObserver } from '../test-support/resize';
import { editorHostOf, registerEditorHost, resetEditorHosts, SAVED_COPY, useEditorHost, useEditorHostScope, type EditorHostAction, type EditorHostRegistration, type SavedState } from './editor-host';
import { panelHost, registerPanelTool, setTitle } from './host';
import { PanelHost } from './PanelHost';
import { PanelRegion } from './PanelRegion';
import type { PanelToolContext } from './tool';

const offs: (() => void)[] = [];
beforeEach(() => {
  resetPanelStores();
  resetEditorHosts();
  registerSlot('panelHost', PanelHost);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSlots();
  offs.splice(0).forEach((off) => off());
});

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <PanelRegion />
    </QueryClientProvider>,
  );
const header = () => document.querySelector<HTMLElement>('[data-editor-header]')!;
const title = () => header().querySelector('[data-header-title]')!;
const buttons = () => within(header()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);

// A tool whose body registers `host` through X32 from its context, as P3-L, B and C will.
function editorTool(id: string, host: () => EditorHostRegistration) {
  return probeTool(id, {
    title: 'Editor',
    render: function EditorBody() {
      useEditorHost(useEditorHostScope(), host());
      return <p>editor body</p>;
    },
  });
}

const add = (toolId: string) => {
  let id = '';
  act(() => void (id = panelHost.addTool(toolId, { appSessionId: A })));
  return id;
};

describe('the panel header', () => {
  it('reads "Session overview" on the summary and keeps the region’s controls', () => {
    mount();
    expect(title().textContent).toBe('Session overview');
    expect(buttons()).toEqual(['Float session over panel', 'Maximize right panel', 'Hide right panel']);
  });

  it('shows an unregistered tool’s strip label, its setTitle suffix following in the header and the strip alike', () => {
    offs.push(registerPanelTool(probeTool('terminal', { title: 'Terminal' }).tool));
    mount();
    const id = add('terminal');
    expect(title().textContent).toBe('Terminal');
    act(() => setTitle(id, 'claude'));
    expect(title().textContent).toBe('Terminal · claude');
    expect(title().getAttribute('title')).toBe('Terminal · claude');
    expect(screen.getByRole('tab', { name: 'Terminal · claude' })).toBeTruthy();
  });

  it('hands a tool its scope as ctx.editorHost', () => {
    let seen: PanelToolContext['editorHost'] | null = null;
    offs.push(
      registerPanelTool(
        probeTool('t', {
          render: function Body({ ctx }: { state: ProbeState; ctx: PanelToolContext }) {
            seen = ctx.editorHost;
            return null;
          },
        }).tool,
      ),
    );
    mount();
    const id = add('t');
    expect(seen).toEqual({ surface: 'panel', tabId: id });
  });

  it('draws a registration: breadcrumb, saved state, comment count, actions and Export, each invoking its handler; an update and the disposal follow', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    let host: EditorHostRegistration = {
      title: 'Q3 brief',
      breadcrumb: ['Docs', 'Planning'],
      saved: 'saving',
      unresolved: 3,
      actions: [
        { id: 'history', label: 'Version history', icon: () => <svg />, onSelect: () => calls.push('history') },
        { id: 'comments', label: 'Comments', pressed: false, onSelect: () => calls.push('comments') },
      ],
      exports: [
        { id: 'pdf', label: 'PDF', onSelect: () => calls.push('export:pdf') },
        { id: 'docx', label: 'Word document', onSelect: () => calls.push('export:docx'), disabled: true },
      ],
    };
    const { tool } = editorTool('editor', () => host);
    offs.push(registerPanelTool(tool));
    mount();
    const id = add('editor');

    expect(title().textContent).toBe('Q3 brief');
    expect(header().textContent).toContain('Docs/Planning/Q3 brief');
    expect(header().textContent).toContain('Saving…');
    // The count stands for the `comments` action, which is not repeated among the actions.
    expect(buttons()).toEqual(['3 open comments', 'Version history', 'Export', 'Float session over panel', 'Maximize right panel', 'Hide right panel']);
    await user.click(within(header()).getByRole('button', { name: '3 open comments' }));
    await user.click(within(header()).getByRole('button', { name: 'Version history' }));
    await user.click(within(header()).getByRole('button', { name: 'Export' }));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(items.map((i) => [i.textContent, i.getAttribute('aria-disabled')])).toEqual([
      ['PDF', null],
      ['Word document', 'true'],
    ]);
    await user.click(items[0]);
    expect(calls).toEqual(['comments', 'history', 'export:pdf']);

    host = { ...host, saved: 'saved' };
    act(() => panelHost.selectTab(id)); // a focus request re-renders the body, with its new fields
    expect(header().textContent).toContain('All changes saved');

    act(() => panelHost.showSummary()); // the body unmounts; its registration stays with the tab
    expect(title().textContent).toBe('Session overview');
    expect(editorHostOf({ surface: 'panel', tabId: id })?.saved).toBe('saved');
    act(() => panelHost.selectTab(id));
    expect(header().textContent).toContain('All changes saved'); // and the remounted body's registration replaces it
  });

  it('returns to the tool’s plain title when the registration is disposed', () => {
    offs.push(registerPanelTool(probeTool('t', { title: 'Plain' }).tool));
    mount();
    const id = add('t');
    let handle!: ReturnType<typeof registerEditorHost>;
    act(() => void (handle = registerEditorHost({ surface: 'panel', tabId: id }, { title: 'Registered', saved: 'unsaved' })));
    expect(title().textContent).toBe('Registered');
    expect(header().textContent).toContain('Unsaved changes');
    act(() => handle.dispose());
    expect(title().textContent).toBe('Plain');
    expect(header().textContent).not.toContain('Unsaved changes');
  });

  it('copies each saved state, and shows none for null', () => {
    offs.push(registerPanelTool(probeTool('t').tool));
    mount();
    const id = add('t');
    const handle = registerEditorHost({ surface: 'panel', tabId: id }, { title: 'Doc' });
    const copy: [SavedState, string][] = [
      ['saved', 'All changes saved'],
      ['saving', 'Saving…'],
      ['unsaved', 'Unsaved changes'],
      ['reconnecting', 'Reconnecting…'],
      ['readonly', 'Read-only'],
    ];
    expect(Object.entries(SAVED_COPY)).toEqual(copy);
    for (const [saved, text] of copy) {
      act(() => handle.update({ saved }));
      expect(header().querySelector('[data-header-saved]')?.textContent).toBe(text);
    }
    act(() => handle.update({ saved: null }));
    expect(header().querySelector('[data-header-saved]')).toBeNull();
  });

  it('labels the count in the singular and plural, inert without a comments action, absent at zero', () => {
    offs.push(registerPanelTool(probeTool('t').tool));
    mount();
    const id = add('t');
    let handle!: ReturnType<typeof registerEditorHost>;
    act(() => void (handle = registerEditorHost({ surface: 'panel', tabId: id }, { title: 'Doc', unresolved: 1 })));
    expect(within(header()).getByText('1 open comment')).toBeTruthy();
    expect(within(header()).queryByRole('button', { name: '1 open comment' })).toBeNull(); // no comments action: inert
    act(() => handle.update({ unresolved: 2 }));
    expect(within(header()).getByText('2 open comments')).toBeTruthy();
    act(() => handle.update({ unresolved: 0 }));
    expect(within(header()).queryByText(/open comment/)).toBeNull();
  });

  it('shows three actions and moves the rest into "More actions"; the region’s controls never collapse', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const action = (n: number, extra: Partial<EditorHostAction> = {}): EditorHostAction => ({ id: `a${n}`, label: `Action ${n}`, onSelect: () => calls.push(`a${n}`), ...extra });
    offs.push(registerPanelTool(probeTool('t').tool));
    mount();
    const id = add('t');
    act(() => void registerEditorHost({ surface: 'panel', tabId: id }, { title: 'Doc', actions: [action(1, { pressed: true }), action(2), action(3)] }));
    expect(buttons()).toEqual(['Action 1', 'Action 2', 'Action 3', 'Float session over panel', 'Maximize right panel', 'Hide right panel']);
    expect(within(header()).getByRole('button', { name: 'Action 1' }).getAttribute('aria-pressed')).toBe('true');

    resetEditorHosts();
    act(() => void registerEditorHost({ surface: 'panel', tabId: id }, { title: 'Doc', actions: [1, 2, 3, 4, 5].map((n) => action(n, n === 5 ? { disabled: true } : {})) }));
    expect(buttons()).toEqual(['Action 1', 'Action 2', 'Action 3', 'More actions', 'Float session over panel', 'Maximize right panel', 'Hide right panel']);
    await user.click(within(header()).getByRole('button', { name: 'More actions' }));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(items.map((i) => [i.textContent, i.getAttribute('aria-disabled')])).toEqual([
      ['Action 4', null],
      ['Action 5', 'true'],
    ]);
    await user.click(items[0]);
    expect(calls).toEqual(['a4']);
  });

  it('marks a pressed action in "More actions" with a visible check, and an unpressed one without', async () => {
    const user = userEvent.setup();
    offs.push(registerPanelTool(probeTool('t').tool));
    mount();
    const id = add('t');
    const action = (n: number, pressed?: boolean): EditorHostAction => ({ id: `a${n}`, label: `Action ${n}`, onSelect: () => {}, pressed });
    act(() => void registerEditorHost({ surface: 'panel', tabId: id }, { title: 'Doc', actions: [action(1), action(2), action(3), action(4, true), action(5, false)] }));
    await user.click(within(header()).getByRole('button', { name: 'More actions' }));
    const [on, off] = within(await screen.findByRole('menu')).getAllByRole('menuitemcheckbox');
    expect([on.getAttribute('aria-checked'), off.getAttribute('aria-checked')]).toEqual(['true', 'false']);
    expect(on.querySelector('[data-menu-check] svg'), 'the checked item draws its check').not.toBeNull();
    expect(off.querySelector('[data-menu-check] svg'), 'the unchecked item draws none').toBeNull();
    expect(off.querySelector('[data-menu-check]'), 'but keeps the check’s room, so the labels align').not.toBeNull();
  });

  it('under a 360 px header, folds every editor action and export into "More actions" so the title keeps the room', async () => {
    const user = userEvent.setup();
    const { resize } = installResizeObserver();
    let width = 0;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-editor-header') ? width : 0;
    });
    const calls: string[] = [];
    const action = (n: number): EditorHostAction => ({ id: `a${n}`, label: `Action ${n}`, icon: () => <svg />, onSelect: () => calls.push(`a${n}`) });
    offs.push(registerPanelTool(probeTool('t').tool));
    mount();
    const id = add('t');
    act(() =>
      void registerEditorHost(
        { surface: 'panel', tabId: id },
        { title: 'Q3 brief', saved: 'saved', actions: [action(1), action(2), action(3)], exports: [{ id: 'pdf', label: 'PDF', onSelect: () => calls.push('export:pdf') }] },
      ),
    );
    const controls = ['Float session over panel', 'Maximize right panel', 'Hide right panel'];

    width = 280; // the panel's narrowest
    resize(header(), { width: 264, height: 40 });
    expect(buttons()).toEqual(['More actions', ...controls]);
    expect(title().textContent).toBe('Q3 brief');
    await user.click(within(header()).getByRole('button', { name: 'More actions' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Action 1', 'Action 2', 'Action 3', 'PDF']);
    expect(within(menu).getByText('Export'), 'the exports under their own heading').toBeTruthy();
    await user.click(within(menu).getByRole('menuitem', { name: 'PDF' }));
    expect(calls).toEqual(['export:pdf']);

    width = 360; // at 360 px and wider, the actions and Export are inline again
    resize(header(), { width: 344, height: 40 });
    expect(buttons()).toEqual(['Action 1', 'Action 2', 'Action 3', 'Export', ...controls]);
  });

  it('closing an inactive editor tab asks its guard: switched away, the registration still vetoes', async () => {
    let allow = false;
    const { tool, probe } = editorTool('editor', () => ({ title: 'Q3 brief', closeGuard: async () => allow }));
    offs.push(registerPanelTool(tool));
    offs.push(registerPanelTool(probeTool('other').tool));
    mount();
    const editor = add('editor');
    add('other'); // the editor's body unmounts
    expect(screen.queryByText('editor body')).toBeNull();
    let closed: boolean | undefined;
    await act(async () => void (closed = await panelHost.closeTab(editor)));
    expect(closed, 'the inactive tab’s guard vetoes').toBe(false);
    expect(probe.beforeClose, 'the veto stops before the tool is asked').toEqual([]);
    expect(screen.getByRole('tab', { name: 'Editor' }), 'the tab stays').toBeTruthy();
    allow = true;
    await act(async () => void (closed = await panelHost.closeTab(editor)));
    expect(closed).toBe(true);
    expect(editorHostOf({ surface: 'panel', tabId: editor }), 'the disposed instance takes its registration').toBeNull();
  });
});
