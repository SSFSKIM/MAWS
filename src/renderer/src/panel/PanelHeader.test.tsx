// P3-G (§D2.2, M3): the panel's header over C8a's host in C5's region: the strip's label for a tool that registers
// nothing (its `setTitle` suffix included), "Session overview" on the summary, and an editor's X32 registration drawn
// as the breadcrumb, the saved state, the open-comment count, its actions (three, then "More actions"), its Export menu,
// beside the region's own controls, all of them folded into "More actions" under a 360 px header; an inactive tab's
// registration still vetoes its close.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMarkup } from '../markup/session';
import { registerMarkupSurface } from '../markup/surface';
import { registerSlot, resetSlots } from '../app/slots';
import { queryClient } from '../ipc/query';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout'; // P3-F wave S (F6)
import { FLOAT_COPY } from '../shell/floating'; // P3-F wave S (F6)
import { useLayout } from '../stores/layout'; // P3-F wave S (F6)
import { A, probeTool, resetPanelStores, type ProbeState } from '../test-support/panel';
import { installResizeObserver } from '../test-support/resize';
import { editorHostOf, focusEditorHostAction, registerEditorHost, resetEditorHosts, SAVED_COPY, useEditorHost, useEditorHostScope, type EditorHostAction, type EditorHostRegistration, type SavedState } from './editor-host';
import { panelHost, registerPanelTool, setTitle } from './host';
import { PanelHost } from './PanelHost';
import { PanelRegion } from './PanelRegion';
import type { PanelToolContext } from './tool';
import { EditorHeader } from './PanelHeader';

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
  it('moves saved state, primary action, grouped actions and host controls into an editor toolbar without a second header row', async () => {
    const user = userEvent.setup();
    const target = document.createElement('div');
    target.setAttribute('role', 'toolbar');
    document.body.append(target);
    offs.push(() => target.remove());
    const calls: string[] = [];
    const inlineScope = { surface: 'panel', tabId: 'inline-deck' } as const;
    render(<EditorHeader title="Deck" scope={inlineScope} registration={{ title: 'Deck', saved: 'saved', toolbarHost: { element: target, menuLabel: 'Deck actions' }, actions: [
      { id: 'present', label: 'Present', onSelect: () => calls.push('present') },
      { id: 'theme', label: 'Theme', pressed: false, onSelect: () => calls.push('theme') },
      { id: 'check', label: 'Check against the design system', onSelect: () => calls.push('check') },
    ], exports: [{ id: 'pdf', label: 'PDF', onSelect: () => calls.push('pdf') }] }} controls={<button onClick={() => calls.push('expand')}>Expand pane</button>} />);
    expect(document.querySelector('[data-editor-header]')).toBeNull();
    expect(within(target).getByText('Deck', { exact: true })).toBeTruthy(); // the panel has no main tab naming its record
    expect(within(target).getByText('Saved').getAttribute('title')).toBe('All changes saved');
    await user.click(within(target).getByRole('button', { name: 'Present' }));
    await user.click(within(target).getByRole('button', { name: 'Expand pane' }));
    expect(within(target).queryByRole('button', { name: 'Theme' })).toBeNull();
    await user.click(within(target).getByRole('button', { name: 'Deck actions' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Theme' }));
    await user.click(within(target).getByRole('button', { name: 'Deck actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'PDF' }));
    expect(calls).toEqual(['present', 'expand', 'theme', 'pdf']);
    act(() => expect(focusEditorHostAction(inlineScope, 'theme')).toBe(true));
    expect(document.activeElement).toBe(within(target).getByRole('button', { name: 'Deck actions' }));
    act(() => expect(focusEditorHostAction(inlineScope, 'present')).toBe(true));
    expect(document.activeElement).toBe(within(target).getByRole('button', { name: 'Present' }));
  });

  it('does not repeat a main tab’s record title in its hosted controls', () => {
    const target = document.createElement('div');
    document.body.append(target);
    offs.push(() => target.remove());
    render(<EditorHeader title="Presentation" scope={{ surface: 'main', tabId: 'main-deck' }} registration={{ title: 'Q3 review', saved: 'saved', toolbarHost: { element: target, menuLabel: 'Deck actions' } }} />);
    expect(within(target).queryByText('Q3 review', { exact: true })).toBeNull();
    expect(within(target).getByText('Saved')).toBeTruthy();
    expect(document.querySelector('[data-editor-header]')).toBeNull();
  });

  it('reserves no header or column for the resting summary (D1 floating cards)', () => {
    mount();
    expect(header()).toBeNull();
    expect(document.querySelector('[data-region="panel"]')?.hasAttribute('inert')).toBe(true);
  });

  // P3-F wave S (F6, candidate 58): the card draws the session in front; with none, Float is disabled and names why
  it('with no session in front, Float is disabled and reads its reason; Maximize and Hide stay', () => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    offs.push(registerPanelTool(probeTool('files', { multiInstance: false }).tool));
    panelHost.addTool('files', { appSessionId: null, pin: true });
    mount();
    expect(buttons()).toEqual([FLOAT_COPY.noSession, 'Expand surface', 'Close surface']);
    expect((within(header()).getByRole('button', { name: FLOAT_COPY.noSession }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(header()).getByRole('button', { name: 'Expand surface' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('puts an unregistered multi-instance tool’s tabs and surface controls in one header, naming the terminal only once', async () => {
    const user = userEvent.setup();
    offs.push(registerPanelTool(probeTool('terminal', { title: 'Terminal' }).tool));
    mount();
    const first = add('terminal');
    act(() => setTitle(first, 'zsh'));
    const tab = within(header()).getByRole('tab', { name: 'Terminal · zsh' });
    expect(header().textContent?.match(/Terminal/g)).toHaveLength(1);
    expect(within(header()).getByRole('button', { name: 'Close surface' })).toBeTruthy();
    await user.click(within(header()).getByRole('button', { name: 'New terminal tab' }));
    expect(within(header()).getAllByRole('tab')).toHaveLength(2);
    await user.click(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await user.click(within(tab.parentElement!).getByRole('button', { name: 'Close Terminal' }));
    expect(within(header()).getAllByRole('tab')).toHaveLength(1);
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
    expect(buttons()).toEqual(['3 open comments', 'Version history', 'Export', 'Float conversation over surface', 'Expand surface', 'Close surface']);
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
    expect(header()).toBeNull(); // floating cards no longer occupy a panel header
    expect(editorHostOf({ surface: 'panel', tabId: id })?.saved).toBe('saved');
    act(() => panelHost.selectTab(id));
    expect(header().textContent).toContain('All changes saved'); // and the remounted body's registration replaces it
  });

  it('opens a PowerPoint submenu without exporting, then invokes only the chosen variant', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const { tool } = editorTool('editor', () => ({ title: 'Deck', exports: [{ id: 'pptx', label: 'PowerPoint', onSelect: () => calls.push('parent'), children: [
      { id: 'basic', label: 'Basic fonts (default)', onSelect: () => calls.push('basic') },
      { id: 'named', label: 'Fonts by name', description: 'Matching fonts must be installed.', onSelect: () => calls.push('named') },
    ] }] }));
    offs.push(registerPanelTool(tool));
    mount();
    add('editor');
    await user.click(within(header()).getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('menuitem', { name: 'PowerPoint' }));
    expect(calls).toEqual([]);
    (await screen.findByRole('menuitem', { name: 'Basic fonts (default)' })).focus();
    await user.keyboard('{Enter}');
    expect(calls).toEqual(['basic']);
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
    expect(within(header()).getByRole('tab', { name: 'Plain' })).toBeTruthy();
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
    expect(buttons()).toEqual(['Action 1', 'Action 2', 'Action 3', 'Float conversation over surface', 'Expand surface', 'Close surface']);
    expect(within(header()).getByRole('button', { name: 'Action 1' }).getAttribute('aria-pressed')).toBe('true');

    resetEditorHosts();
    act(() => void registerEditorHost({ surface: 'panel', tabId: id }, { title: 'Doc', actions: [1, 2, 3, 4, 5].map((n) => action(n, n === 5 ? { disabled: true } : {})) }));
    expect(buttons()).toEqual(['Action 1', 'Action 2', 'Action 3', 'More actions', 'Float conversation over surface', 'Expand surface', 'Close surface']);
    await user.click(within(header()).getByRole('button', { name: 'More actions' }));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(items.map((i) => [i.textContent, i.getAttribute('aria-disabled')])).toEqual([
      ['Action 4', null],
      ['Action 5', 'true'],
    ]);
    await user.click(items[0]);
    expect(calls).toEqual(['a4']);
  });

  // P4-B5 (X32 additive): a pinned action (the header's Send to) is drawn beside the first three, never folded into "More
  // actions" but under the narrow header, where every action is
  it('draws a pinned action beside the first three, wherever the editor listed it, and folds it only under the narrow header', async () => {
    const user = userEvent.setup();
    const { resize } = installResizeObserver();
    let width = 0;
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-editor-header') ? width : 0;
    });
    offs.push(() => spy.mockRestore());
    const action = (n: number, extra: Partial<EditorHostAction> = {}): EditorHostAction => ({ id: `a${n}`, label: `Action ${n}`, onSelect: () => {}, ...extra });
    offs.push(registerPanelTool(probeTool('t').tool));
    mount();
    const id = add('t');
    act(() => void registerEditorHost({ surface: 'panel', tabId: id }, { title: 'Doc', actions: [action(1), action(2), action(3), action(4), action(5, { pinned: true, label: 'Send to…' })] }));
    const controls = ['Float conversation over surface', 'Expand surface', 'Close surface'];
    expect(buttons()).toEqual(['Action 1', 'Action 2', 'Action 3', 'Send to…', 'More actions', ...controls]);
    await user.click(within(header()).getByRole('button', { name: 'More actions' }));
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Action 4']);
    await user.keyboard('{Escape}');

    width = 280;
    resize(header(), { width: 264, height: 40 });
    expect(buttons()).toEqual(['More actions', ...controls]);
  });

  // P3-L (M6b fix wave 1, X32 additive): an editor gives focus back to an action's control in the header over its scope
  // (a dismissed comment card to Comment); an action folded into "More actions" gives it to that menu's button.
  it('focuses an action’s control in the header over the scope, "More actions" for a folded one, and answers false otherwise', () => {
    offs.push(registerPanelTool(probeTool('t').tool));
    mount();
    const id = add('t');
    const scope = { surface: 'panel', tabId: id } as const;
    const action = (n: number, extra: Partial<EditorHostAction> = {}): EditorHostAction => ({ id: `a${n}`, label: `Action ${n}`, onSelect: () => {}, ...extra });
    act(() => void registerEditorHost(scope, { title: 'Doc', actions: [1, 2, 3, 4].map((n) => action(n, n === 2 ? { disabled: true } : {})) }));
    expect(focusEditorHostAction(scope, 'a1')).toBe(true);
    expect(document.activeElement).toBe(within(header()).getByRole('button', { name: 'Action 1' }));
    expect(focusEditorHostAction(scope, 'a4')).toBe(true);
    expect(document.activeElement).toBe(within(header()).getByRole('button', { name: 'More actions' }));
    expect(focusEditorHostAction(scope, 'a2'), 'a disabled control takes no focus').toBe(false);
    expect(focusEditorHostAction(scope, 'nope')).toBe(false);
    expect(focusEditorHostAction({ surface: 'panel', tabId: 'another' }, 'a1'), 'no header over that scope').toBe(false);
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
    const controls = ['Float conversation over surface', 'Expand surface', 'Close surface'];

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

  // P3-G (§D2.2, §D4.4, M4): Mark up shows for a tab whose body registered a mark-up surface, after the actions and
  // before the region's controls, and starts a session over that surface
  it('shows Mark up for a tab with a mark-up surface and starts mark-up over it; a tab without one shows none', async () => {
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 300, x: 0, y: 0, right: 400, bottom: 300, toJSON: () => ({}) } as DOMRect);
    const begin = vi.fn(async () => null);
    offs.push(resetMarkup);
    offs.push(
      registerPanelTool(
        probeTool('page', {
          title: 'Page',
          multiInstance: false,
          render: function PageBody() {
            const scope = useEditorHostScope();
            useEffect(() => (scope ? registerMarkupSurface(scope, { element: () => element, label: () => 'Page', begin, end: () => {} }) : undefined), [scope]);
            return <p>page body</p>;
          },
        }).tool,
      ),
    );
    offs.push(registerPanelTool(probeTool('plain', { title: 'Plain', multiInstance: false }).tool));
    mount();
    add('page');
    expect(buttons()).toEqual(['Mark up', 'Float conversation over surface', 'Expand surface', 'Close surface']);
    await userEvent.click(within(header()).getByRole('button', { name: 'Mark up' }));
    expect(begin).toHaveBeenCalledTimes(1);
    const plain = add('plain');
    act(() => useLayout.getState().setSurfaceStack(A, [plain]));
    expect(buttons()).toEqual(['Float conversation over surface', 'Expand surface', 'Close surface']);
  });

  it('closing an inactive editor tab asks its guard: switched away, the registration still vetoes', async () => {
    let allow = false;
    const { tool, probe } = editorTool('editor', () => ({ title: 'Q3 brief', closeGuard: async () => allow }));
    offs.push(registerPanelTool(tool));
    offs.push(registerPanelTool(probeTool('other').tool));
    mount();
    const editor = add('editor');
    const other = add('other');
    act(() => useLayout.getState().setSurfaceStack(A, [other])); // hiding a surface keeps its editor instance
    expect(screen.queryByText('editor body')).toBeNull();
    let closed: boolean | undefined;
    await act(async () => void (closed = await panelHost.closeTab(editor)));
    expect(closed, 'the inactive tab’s guard vetoes').toBe(false);
    expect(probe.beforeClose, 'the veto stops before the tool is asked').toEqual([]);
    expect(useLayout.getState().effectivePanelTabs(A).some((tab) => tab.id === editor), 'the hidden editor ref stays').toBe(true);
    allow = true;
    await act(async () => void (closed = await panelHost.closeTab(editor)));
    expect(closed).toBe(true);
    expect(editorHostOf({ surface: 'panel', tabId: editor }), 'the disposed instance takes its registration').toBeNull();
  });
});
