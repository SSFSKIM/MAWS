// The Question sheet's row of the side column's icons (`toggleSurface`, UX wave U8b's one entry): it shows and hides
// the sheet as it does any tool's. UX wave U1b (M6) took out its call that settled the asks waiting for the automatic
// open, which is gone; this case pins that the toggle itself is unchanged.
// UX wave U6b-5a (M1, decisions 2 and 3): a tool shown by its key has the keyboard, by its own answer to the focus
// request or else at F6's stop two frames later; hidden by its key, the keyboard goes back to the composer when it was in
// the column or nowhere.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { A, panelOf, probeTool, resetPanelStores, TestHost, type ProbeState } from '../test-support/panel';
import { useLayout } from '../stores/layout';
import { registerFocusTarget, resetComposerStore } from '../stores/composer';
import { panelHost, registerPanelTool, usePanelHost } from './host';
import type { PanelToolContext } from './tool';
import { surfaceTabs } from './surface-model';
import { SurfaceRow, toggleSurface } from './SurfaceRow';

beforeEach(() => resetPanelStores());
afterEach(() => resetPanelStores());

it('toggling the ask sheet’s row shows the sheet, hides the column, and shows the same tab again', () => {
  const files = { id: 'files:aaaa0002', toolId: 'files', pinned: false };
  const { tool, probe } = probeTool(ASK_SHEET_TOOL_ID, { multiInstance: false, pinnable: false });
  registerPanelTool(tool);
  useLayout.setState({
    panelBySession: new Map([[A, { tabs: [files], activeTabId: files.id }]]),
    panelSurfaces: { version: 2, stacks: { [A]: [files.id] }, pinnedTools: [], contexts: {} },
  });
  const inView = () => surfaceTabs(useLayout.getState(), A).map((tab) => tab.toolId);

  toggleSurface(ASK_SHEET_TOOL_ID); // no sheet yet: one is added, in view
  expect(probe.created.map((init) => init.appSessionId)).toEqual([A]);
  expect(inView()).toEqual([ASK_SHEET_TOOL_ID]);
  expect(useLayout.getState().regions.panel.collapsed).toBe(false);
  const sheet = panelOf(A)!.tabs.find((tab) => tab.toolId === ASK_SHEET_TOOL_ID)!;

  toggleSurface(ASK_SHEET_TOOL_ID); // in view: the column hides, closing nothing
  expect(inView()).toEqual([]);
  expect(panelOf(A)?.tabs.map((tab) => tab.id)).toEqual([files.id, sheet.id]);

  toggleSurface(ASK_SHEET_TOOL_ID); // hidden: the same tab comes back
  expect(inView()).toEqual([ASK_SHEET_TOOL_ID]);
  expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.id)).toEqual([sheet.id]);
  expect(probe.created).toHaveLength(1);
});

describe('the keyboard on show and hide', () => {
  const offs: (() => void)[] = [];
  // The animation frames, run when the test says (`frame`), so a case can act between a request and its second frame.
  let frames: FrameRequestCallback[] = [];
  const frame = () => act(() => frames.splice(0).forEach((callback) => callback(0)));

  // A tool that answers a focus request on its own field, once per request (the counter outlives its mounts).
  const seen = new WeakMap<ProbeState, number>();
  function Answering({ state, ctx }: { state: ProbeState; ctx: PanelToolContext }) {
    const field = useRef<HTMLInputElement>(null);
    useEffect(() => {
      if (ctx.focusRequest <= (seen.get(state) ?? 0)) return;
      seen.set(state, ctx.focusRequest);
      field.current?.focus();
    }, [ctx.focusRequest, state]);
    return <input ref={field} aria-label="Shell input" />;
  }

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    offs.push(
      registerPanelTool(probeTool('terminal', { title: 'Terminal', render: Answering }).tool),
      registerPanelTool(probeTool('background', { title: 'Background tasks' }).tool), // answers nothing
    );
  });
  afterEach(() => {
    for (let round = 0; round < 4 && frames.length > 0; round += 1) frame(); // what a case left asked runs, before the next case
    cleanup();
    offs.splice(0).forEach((off) => off());
    resetComposerStore();
    vi.unstubAllGlobals();
  });

  // The window's regions as the shell draws them: the sidebar with a field, A's pane with its strip and its composer's
  // box, the side column.
  function Window() {
    return <>
      <section id="region-sidebar"><input aria-label="Find a session" /></section>
      <section id="region-main">
        <section id="pane-0" data-pane="0">
          <div data-pane-strip><div role="tablist"><button type="button" role="tab" aria-selected="true">Chat A</button></div></div>
          <div role="tabpanel"><textarea aria-label="Message to A" /></div>
        </section>
      </section>
      <section id="region-panel"><TestHost /></section>
    </>;
  }
  const box = () => screen.getByLabelText('Message to A');
  const field = () => screen.getByLabelText('Find a session');
  const composerOfA = () => offs.push(registerFocusTarget(A, { focusEditor: () => box().focus(), focusFrame: () => box().focus(), insertText: () => {} }));
  const tabOf = (toolId: string) => panelOf(A)!.tabs.find((tab) => tab.toolId === toolId)!.id;
  const asked = (toolId: string) => usePanelHost.getState().focus[tabOf(toolId)] ?? 0;
  const upperContent = () => document.getElementById('panel-host-body-upper');

  it('shown from a hidden column, from a column open on another tool and from behind a page, the tab is asked; one that answers keeps the keyboard, one that does not gets F6’s stop two frames later', () => {
    render(<Window />);
    act(() => box().focus());
    act(() => toggleSurface('background')); // the column hidden: the tool is added
    expect(asked('background')).toBeGreaterThan(0);
    frame();
    expect(document.activeElement, 'one frame: not yet').toBe(box());
    frame();
    expect(document.activeElement).toBe(upperContent());

    act(() => toggleSurface('terminal')); // a column open on another tool; the tool answers
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
    frame();
    frame();
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));

    const before = asked('background');
    act(() => toggleSurface('background')); // a column open on another tool, the tool's tab held
    expect(asked('background')).toBe(before + 1);
    frame();
    frame();
    expect(document.activeElement).toBe(upperContent());

    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    const terminal = asked('terminal');
    act(() => toggleSurface('terminal')); // brought into view from behind a page
    expect(useLayout.getState().destination).toBeNull();
    expect(asked('terminal')).toBe(terminal + 1);
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
  });

  it('held open before the second frame: a press elsewhere keeps the keyboard there, and a tab hidden again is not focused', () => {
    render(<Window />);
    act(() => box().focus());
    act(() => toggleSurface('background'));
    frame();
    frame();
    expect(document.activeElement, 'the control: nothing in between').toBe(upperContent());

    act(() => useLayout.getState().hideSurfaces(A));
    act(() => box().focus());
    act(() => toggleSurface('background'));
    fireEvent.pointerDown(field());
    act(() => field().focus());
    frame();
    frame();
    expect(document.activeElement).toBe(field());

    act(() => useLayout.getState().hideSurfaces(A));
    act(() => box().focus());
    act(() => toggleSurface('background'));
    act(() => useLayout.getState().hideSurfaces(A));
    frame();
    frame();
    expect(document.activeElement).toBe(box());
  });

  it('hidden by its key with the keyboard in the column or held by nothing, the composer takes it; in the sidebar it stays', () => {
    render(<Window />);
    composerOfA();
    act(() => toggleSurface('terminal'));
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
    act(() => toggleSurface('terminal'));
    frame(); // the hide drawn
    expect(document.activeElement, 'the keyboard was in the column').toBe(box());

    act(() => toggleSurface('terminal'));
    frame();
    frame();
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    act(() => toggleSurface('terminal'));
    frame();
    expect(document.activeElement, 'nothing held the keyboard').toBe(box());

    act(() => toggleSurface('terminal'));
    frame();
    frame();
    act(() => field().focus());
    act(() => toggleSurface('terminal'));
    frame();
    expect(surfaceTabs(useLayout.getState(), A)).toEqual([]);
    expect(document.activeElement, 'the keyboard was in the sidebar').toBe(field());
  });

  it('hidden by its key with the keyboard in the column, where the pane in front holds no composer, the pane takes it', () => {
    render(<Window />);
    act(() => toggleSurface('terminal'));
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
    act(() => toggleSurface('terminal'));
    frame();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Chat A' }));

    composerOfA(); // the control: with a composer, the same act gives it the keyboard
    act(() => toggleSurface('terminal'));
    frame();
    frame();
    act(() => toggleSurface('terminal'));
    frame();
    expect(document.activeElement).toBe(box());
  });

  // A side surface that covers the main area leaves it inert until the hide has been drawn, and an inert element takes no
  // keyboard; the composer here refuses it while inert, as the browser does.
  it('hidden by its key while it covered the main area, the composer takes the keyboard once the main area is no longer inert; a move in between stays', () => {
    function CoveredWindow() {
      const covered = useLayout((s) => s.regions.panel.maximized && surfaceTabs(s, A).length > 0);
      return <>
        <section id="region-sidebar"><input aria-label="Find a session" /></section>
        <section id="region-main" inert={covered}>
          <section id="pane-0" data-pane="0"><div role="tabpanel"><textarea aria-label="Message to A" /></div></section>
        </section>
        <section id="region-panel"><TestHost /></section>
      </>;
    }
    render(<CoveredWindow />);
    const takes = () => {
      if (box().closest('[inert]') === null) box().focus();
    };
    offs.push(registerFocusTarget(A, { focusEditor: takes, focusFrame: takes, insertText: () => {} }));
    act(() => toggleSurface('terminal'));
    act(() => useLayout.getState().setPanel({ maximized: true }));
    expect(document.getElementById('region-main')!.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
    act(() => toggleSurface('terminal'));
    expect(document.getElementById('region-main')!.hasAttribute('inert')).toBe(false);
    frame();
    expect(document.activeElement).toBe(box());

    act(() => toggleSurface('terminal'));
    frame();
    frame();
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
    act(() => toggleSurface('terminal'));
    act(() => field().focus()); // the person, before the hide is drawn
    frame();
    expect(document.activeElement).toBe(field());
  });

  // The branch panel's fix wave (G3): one hand-over of the keyboard at a time. A newer act of the keys, a newer request of
  // the host for any tab, or (for a show) a press ends the one before, and nothing it scheduled moves the keyboard after.
  it('a show’s fallback does nothing once the host has asked another tab for the keyboard; the control: alone, it lands', () => {
    render(<Window />);
    let terminal = '';
    act(() => void (terminal = panelHost.addTool('terminal', { appSessionId: A })));
    act(() => void panelHost.addTool('background', { appSessionId: A }));
    act(() => useLayout.getState().moveSurfaceTab(A, terminal, 'lower')); // two groups: Background above, Terminal below
    frame();
    frame();
    act(() => useLayout.getState().hideSurfaces(A));
    act(() => box().focus());
    act(() => toggleSurface('background')); // shown by its key (the column with both groups); Background answers nothing
    expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.toolId).sort()).toEqual(['background', 'terminal']);
    act(() => panelHost.selectTab(terminal)); // a native menu's act asks for Terminal: no key or pointer press here
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
    frame();
    frame();
    expect(document.activeElement, 'the background tool’s fallback is stale').toBe(screen.getByLabelText('Shell input'));

    act(() => useLayout.getState().hideSurfaces(A)); // the control, in this test: the same show with no newer request
    act(() => box().focus());
    act(() => toggleSurface('background'));
    frame();
    frame();
    expect(document.activeElement).toBe(upperContent());
  });

  it('a hide’s return to the composer does nothing once the column is shown again before its frame; the control: alone, it returns', () => {
    render(<Window />);
    composerOfA();
    act(() => toggleSurface('terminal'));
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
    act(() => toggleSurface('terminal')); // hidden: the return waits for the next frame
    act(() => toggleSurface('terminal')); // shown again first: the shell takes the keyboard
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
    frame(); // the hide's frame: what is typed now goes where the keyboard is
    expect(document.activeElement, 'the hide’s return is stale').toBe(screen.getByLabelText('Shell input'));
    frame();

    const terminal = tabOf('terminal'); // by the host this time: a reopen that is no key's
    act(() => toggleSurface('terminal'));
    act(() => panelHost.selectTab(terminal));
    frame();
    expect(document.activeElement, 'stale under the host’s reopen too').toBe(screen.getByLabelText('Shell input'));

    act(() => toggleSurface('terminal')); // the control, in this test: the same hide with nothing after it
    frame();
    expect(document.activeElement).toBe(box());
  });

  it('a tool chosen in More surfaces keeps the keyboard it took; the menu’s close does not take it back to its trigger', async () => {
    const answered = new WeakMap<ProbeState, number>();
    function Shell({ state, ctx }: { state: ProbeState; ctx: PanelToolContext }) {
      const field = useRef<HTMLInputElement>(null);
      useEffect(() => {
        if (ctx.focusRequest <= (answered.get(state) ?? 0)) return;
        answered.set(state, ctx.focusRequest);
        field.current?.focus();
      }, [ctx.focusRequest, state]);
      return <><button type="button">New terminal here</button><input ref={field} aria-label="Extra shell" /></>;
    }
    offs.push(registerPanelTool(probeTool('extra', { title: 'Extra', render: Shell }).tool));
    render(<><SurfaceRow /><Window /></>);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'More surfaces' });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Extra' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0))); // the menu's close focus, a task after it unmounts
    frame();
    frame();
    expect(document.activeElement).toBe(screen.getByLabelText('Extra shell'));

    await user.click(trigger); // the control, in this test: a menu closed with no act keeps its own return
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
