// The Question sheet's row of the side column's icons (`toggleSurface`, UX wave U8b's one entry): it shows and hides
// the sheet as it does any tool's. UX wave U1b (M6) took out its call that settled the asks waiting for the automatic
// open, which is gone; this case pins that the toggle itself is unchanged.
// UX wave U6b-5a (M1, decisions 2 and 3): a tool shown by its key has the keyboard, by its own answer to the focus
// request or else at F6's stop two frames later; hidden by its key, the keyboard goes back to the composer when it was in
// the column or nowhere.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { A, panelOf, probeTool, resetPanelStores, TestHost, type ProbeState } from '../test-support/panel';
import { useLayout } from '../stores/layout';
import { registerFocusTarget, resetComposerStore } from '../stores/composer';
import { registerPanelTool, usePanelHost } from './host';
import type { PanelToolContext } from './tool';
import { surfaceTabs } from './surface-model';
import { toggleSurface } from './SurfaceRow';

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
    expect(document.activeElement, 'the keyboard was in the column').toBe(box());

    act(() => toggleSurface('terminal'));
    frame();
    frame();
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    act(() => toggleSurface('terminal'));
    expect(document.activeElement, 'nothing held the keyboard').toBe(box());

    act(() => toggleSurface('terminal'));
    frame();
    frame();
    act(() => field().focus());
    act(() => toggleSurface('terminal'));
    expect(surfaceTabs(useLayout.getState(), A)).toEqual([]);
    expect(document.activeElement, 'the keyboard was in the sidebar').toBe(field());
  });

  it('hidden by its key with the keyboard in the column, where the pane in front holds no composer, the pane takes it', () => {
    render(<Window />);
    act(() => toggleSurface('terminal'));
    expect(document.activeElement).toBe(screen.getByLabelText('Shell input'));
    act(() => toggleSurface('terminal'));
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Chat A' }));

    composerOfA(); // the control: with a composer, the same act gives it the keyboard
    act(() => toggleSurface('terminal'));
    frame();
    frame();
    act(() => toggleSurface('terminal'));
    expect(document.activeElement).toBe(box());
  });
});
