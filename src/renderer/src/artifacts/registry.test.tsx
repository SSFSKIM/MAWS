// The editor mount registry (the P3-L execution document, Decision Log 7; the P3 interface ledger §7): a kind's editor
// registered, replaced and unregistered, `Main` defaulting to `Panel`, and the state an editor keeps per tab, made once
// by `createState` and disposed when the tab goes or the surface shows something else.
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHostScope } from '../panel/editor-host';
import { useLayout } from '../stores/layout';
import { resetShellStores } from '../test-support/shell-stores';
import {
  adoptStagedArtifactEditorState, artifactEditorFor, heldArtifactEditorState, holdArtifactEditorState, registerArtifactEditor, registerArtifactViewCapture,
  releaseArtifactEditorState, resetArtifactEditors, stageArtifactEditorState, takeCarriedView, useArtifactEditor, useArtifactViewCapture, useHeldArtifactEditorState,
  type ArtifactEditorHold, type ArtifactEditorProps,
} from './registry';

const A = '0b6f7d52-1c1f-4c4e-9a37-5d0e7a0d1a01';
const B = '0b6f7d52-1c1f-4c4e-9a37-5d0e7a0d1a02';
const Panel = (props: ArtifactEditorProps) => <p>panel {props.artifactId}</p>;
const Main = (props: ArtifactEditorProps) => <p>main {props.artifactId}</p>;

beforeEach(() => {
  resetShellStores();
  resetArtifactEditors();
});
afterEach(cleanup);

describe('registering an editor', () => {
  it('registers, replaces (the last registration wins) and unregisters; Main defaults to Panel', () => {
    expect(artifactEditorFor('document')).toBeNull();
    const off = registerArtifactEditor('document', { Panel });
    expect(artifactEditorFor('document')?.Panel).toBe(Panel);
    expect(artifactEditorFor('document')?.Main, 'no Main: the panel body serves the main tab too').toBe(Panel);
    expect(artifactEditorFor('presentation'), 'per kind').toBeNull();

    const offSecond = registerArtifactEditor('document', { Panel, Main });
    expect(artifactEditorFor('document')?.Main).toBe(Main);
    off(); // the replaced registration's unregister leaves the newer one
    expect(artifactEditorFor('document')?.Main).toBe(Main);
    offSecond();
    expect(artifactEditorFor('document')).toBeNull();
  });

  it('useArtifactEditor follows registrations made after the first render', () => {
    function Probe() {
      const editor = useArtifactEditor('design');
      return <p>{editor ? 'has editor' : 'no editor'}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('no editor')).toBeTruthy();
    let off = () => {};
    act(() => void (off = registerArtifactEditor('design', { Panel })));
    expect(screen.getByText('has editor')).toBeTruthy();
    act(() => off());
    expect(screen.getByText('no editor')).toBeTruthy();
  });
});

describe('the state an editor keeps per tab', () => {
  const panel: EditorHostScope = { surface: 'panel', tabId: 'p1' };
  const editor = () => {
    let made = 0;
    const createState = vi.fn((target: { artifactId: string; kind: string; surface: string }) => ({ n: ++made, ...target }));
    const dispose = vi.fn();
    return { Panel, createState, dispose };
  };

  it('is made once per scope and target, whoever asks, and disposed when the surface releases it', () => {
    const e = editor();
    registerArtifactEditor('document', e);
    const first = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    const again = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    expect(again).toBe(first);
    expect(e.createState).toHaveBeenCalledTimes(1);
    expect(e.createState).toHaveBeenCalledWith({ artifactId: A, kind: 'document', surface: 'panel' });
    expect(first.state).toMatchObject({ n: 1, artifactId: A });
    releaseArtifactEditorState(panel); // the panel went Back
    expect(e.dispose).toHaveBeenCalledWith(first.state);
    releaseArtifactEditorState(panel);
    expect(e.dispose, 'released once').toHaveBeenCalledTimes(1);
  });

  it('a re-target disposes the old state before the new one is made; another scope keeps its own', () => {
    const e = editor();
    registerArtifactEditor('document', e);
    const other: EditorHostScope = { surface: 'panel', tabId: 'p2' };
    const a = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    const elsewhere = holdArtifactEditorState(other, A, 'document', artifactEditorFor('document')!);
    expect(elsewhere, 'each tab its own replica state').not.toBe(a);
    const b = holdArtifactEditorState(panel, B, 'document', artifactEditorFor('document')!);
    expect(e.dispose).toHaveBeenCalledTimes(1);
    expect(e.dispose).toHaveBeenCalledWith(a.state);
    expect(b.state).toMatchObject({ artifactId: B });
    expect(e.createState).toHaveBeenCalledTimes(3);
  });

  it('a replaced editor’s state is disposed by the editor that made it, and the new editor makes its own', () => {
    const first = editor();
    const second = editor();
    registerArtifactEditor('document', first);
    const held = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    registerArtifactEditor('document', second);
    const replaced = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    expect(first.dispose).toHaveBeenCalledWith(held.state);
    expect(second.createState).toHaveBeenCalledTimes(1);
    expect(replaced).not.toBe(held);
  });

  it('an editor without createState holds undefined; a dispose that throws is logged and the state still goes', () => {
    registerArtifactEditor('file', { Panel });
    expect(holdArtifactEditorState(panel, A, 'file', artifactEditorFor('file')!).state).toBeUndefined();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerArtifactEditor('html', { Panel, createState: () => 'kept', dispose: () => { throw new Error('boom'); } });
    holdArtifactEditorState(panel, B, 'html', artifactEditorFor('html')!);
    releaseArtifactEditorState(panel);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('a main tab’s state is disposed when the tab leaves main, not when it moves between panes or is inactive', () => {
    const e = editor();
    registerArtifactEditor('document', e);
    act(() => useLayout.getState().openTab({ kind: 'artifact', artifactId: A }));
    const scope: EditorHostScope = { surface: 'main', tabId: `artifact:${A}` };
    const held = holdArtifactEditorState(scope, A, 'document', artifactEditorFor('document')!);
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' })); // the artifact's tab inactive
    act(() => useLayout.getState().moveTab(scope.tabId, 1, 0)); // to the other pane
    expect(e.dispose).not.toHaveBeenCalled();
    expect(holdArtifactEditorState(scope, A, 'document', artifactEditorFor('document')!)).toBe(held);
    act(() => useLayout.getState().closeTab(scope.tabId));
    expect(e.dispose).toHaveBeenCalledWith(held.state);
    expect(e.createState).toHaveBeenCalledTimes(1);
  });

  // P3-H (the P3 spec's Decision Log 93): a render reads the scope's hold through the hook, which every hold and release
  // publishes to (made, re-targeted, released by the surface, ended with its main tab), so a compiled render never keeps
  // one it read before.
  it('the scope’s hold, read through useHeldArtifactEditorState, follows every hold and release of that scope', async () => {
    const e = editor();
    registerArtifactEditor('document', e);
    const docEditor = artifactEditorFor('document')!;
    const seen = renderHook(() => useHeldArtifactEditorState(panel));
    expect(seen.result.current).toBeNull();
    let a!: ArtifactEditorHold;
    await act(async () => void (a = holdArtifactEditorState(panel, A, 'document', docEditor)));
    expect(seen.result.current).toBe(a);
    await act(async () => void holdArtifactEditorState({ surface: 'panel', tabId: 'p2' }, A, 'document', docEditor));
    expect(seen.result.current, 'another scope’s hold is its own').toBe(a);
    let b!: ArtifactEditorHold;
    await act(async () => void (b = holdArtifactEditorState(panel, B, 'document', docEditor))); // a re-target
    expect(seen.result.current).toBe(b);
    await act(async () => releaseArtifactEditorState(panel));
    expect(seen.result.current).toBeNull();

    act(() => useLayout.getState().openTab({ kind: 'artifact', artifactId: A }));
    const scope: EditorHostScope = { surface: 'main', tabId: `artifact:${A}` };
    const main = renderHook(() => useHeldArtifactEditorState(scope));
    let held!: ArtifactEditorHold;
    await act(async () => void (held = holdArtifactEditorState(scope, A, 'document', docEditor)));
    expect(main.result.current).toBe(held);
    await act(async () => useLayout.getState().closeTab(scope.tabId)); // ended with its tab
    expect(main.result.current).toBeNull();
  });
});

// P4-B3 (its Decision Log 19): a move hands the hold over instead of disposing it. The source stages it (detached, kept
// by artifact id) before it lets go; the target adopts it before React renders it, or a hold asked for the same artifact,
// kind and editor takes it; whatever nobody adopted by the end of the move's task is disposed.
describe('the hand-off of a hold between surfaces', () => {
  const panel: EditorHostScope = { surface: 'panel', tabId: 'p1' };
  const main: EditorHostScope = { surface: 'main', tabId: `artifact:${A}` };
  const editor = () => ({ Panel, createState: vi.fn((target: { artifactId: string }) => ({ ...target })), dispose: vi.fn() });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('stages the scope’s hold without disposing it, and the target adopts the same hold', async () => {
    const e = editor();
    registerArtifactEditor('document', e);
    const held = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    expect(stageArtifactEditorState(panel)).toBe(true);
    expect(heldArtifactEditorState(panel), 'the source holds nothing').toBeNull();
    releaseArtifactEditorState(panel); // the source letting go afterwards ends nothing
    expect(adoptStagedArtifactEditorState(A, main)).toBe(true);
    expect(heldArtifactEditorState(main)).toBe(held);
    expect(holdArtifactEditorState(main, A, 'document', artifactEditorFor('document')!), 'asked again, the same').toBe(held);
    await tick();
    expect(e.dispose).not.toHaveBeenCalled();
    expect(e.createState).toHaveBeenCalledTimes(1);
  });

  it('tells the editor the surface its state moved to (a state that keeps its surface follows it)', () => {
    const moved = vi.fn();
    registerArtifactEditor('document', { ...editor(), moved });
    const held = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    stageArtifactEditorState(panel);
    adoptStagedArtifactEditorState(A, main);
    expect(moved).toHaveBeenCalledExactlyOnceWith(held.state, { artifactId: A, kind: 'document', surface: 'main' });
  });

  it('stages nothing for a scope that holds nothing, and adopts nothing for an artifact not staged', () => {
    expect(stageArtifactEditorState(panel)).toBe(false);
    expect(adoptStagedArtifactEditorState(A, main)).toBe(false);
    expect(heldArtifactEditorState(main)).toBeNull();
  });

  it('adopting ends what the target scope held before (another artifact)', () => {
    const e = editor();
    registerArtifactEditor('document', e);
    const moved = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    const before = holdArtifactEditorState(main, B, 'document', artifactEditorFor('document')!);
    stageArtifactEditorState(panel);
    adoptStagedArtifactEditorState(A, main);
    expect(e.dispose).toHaveBeenCalledExactlyOnceWith(before.state);
    expect(heldArtifactEditorState(main)).toBe(moved);
  });

  it('a hold asked in another scope for the same artifact, kind and editor takes a staged one (the fallback)', () => {
    const e = editor();
    registerArtifactEditor('document', e);
    const held = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    stageArtifactEditorState(panel);
    expect(holdArtifactEditorState(main, A, 'document', artifactEditorFor('document')!)).toBe(held);
    expect(e.createState).toHaveBeenCalledTimes(1);
    expect(adoptStagedArtifactEditorState(A, panel), 'taken once').toBe(false);
  });

  it('a hold asked for another editor of the artifact does not take the staged one, which is disposed at the end of the task', async () => {
    const first = editor();
    registerArtifactEditor('document', first);
    const held = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    stageArtifactEditorState(panel);
    const second = editor();
    registerArtifactEditor('document', second);
    expect(holdArtifactEditorState(main, A, 'document', artifactEditorFor('document')!)).not.toBe(held);
    expect(second.createState).toHaveBeenCalledTimes(1);
    expect(first.dispose).not.toHaveBeenCalled();
    await tick();
    expect(first.dispose).toHaveBeenCalledExactlyOnceWith(held.state);
  });

  it('a staged hold nobody adopts by the end of the move’s task is disposed once', async () => {
    const e = editor();
    registerArtifactEditor('document', e);
    const held = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    stageArtifactEditorState(panel);
    expect(e.dispose).not.toHaveBeenCalled();
    await tick();
    expect(e.dispose).toHaveBeenCalledExactlyOnceWith(held.state);
    expect(adoptStagedArtifactEditorState(A, main)).toBe(false);
  });

  it('a main tab closing while its hold is staged does not dispose it (the move closes its source after staging)', async () => {
    const e = editor();
    registerArtifactEditor('document', e);
    act(() => useLayout.getState().openTab({ kind: 'artifact', artifactId: A }));
    const held = holdArtifactEditorState(main, A, 'document', artifactEditorFor('document')!);
    stageArtifactEditorState(main);
    act(() => useLayout.getState().closeTab(main.tabId));
    expect(adoptStagedArtifactEditorState(A, panel)).toBe(true);
    await tick();
    expect(e.dispose).not.toHaveBeenCalled();
    expect(heldArtifactEditorState(panel)).toBe(held);
  });

  it('the source’s and the target’s readers follow the hand-off', async () => {
    registerArtifactEditor('document', editor());
    const held = holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    const source = renderHook(() => useHeldArtifactEditorState(panel));
    const target = renderHook(() => useHeldArtifactEditorState(main));
    expect(source.result.current).toBe(held);
    await act(async () => {
      stageArtifactEditorState(panel);
      adoptStagedArtifactEditorState(A, main);
    });
    expect(source.result.current).toBeNull();
    expect(target.result.current).toBe(held);
  });
});

// P4-B3 M5 (its Decision Log 25): the view carry. A body registers what it would need to come back to the same place
// (`captureView`) under its scope; a move captures it as the source stages its hold, and the target's first mount takes
// it once (`takeCarriedView`).
describe('the view carried with a hold', () => {
  const panel: EditorHostScope = { surface: 'panel', tabId: 'p1' };
  const main: EditorHostScope = { surface: 'main', tabId: `artifact:${A}` };
  const editor = () => ({ Panel, createState: vi.fn((target: { artifactId: string }) => ({ ...target })), dispose: vi.fn() });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const held = () => {
    registerArtifactEditor('document', editor());
    return holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
  };

  it('is captured as the source stages, handed to the target at adoption and taken there once', () => {
    held();
    const capture = vi.fn(() => ({ scroll: 120 }));
    registerArtifactViewCapture(panel, capture);
    expect(takeCarriedView(main), 'nothing before a move').toBeUndefined();
    stageArtifactEditorState(panel);
    expect(capture).toHaveBeenCalledOnce();
    expect(takeCarriedView(main), 'not before the adoption').toBeUndefined();
    adoptStagedArtifactEditorState(A, main);
    expect(takeCarriedView(panel), 'never the source’s').toBeUndefined();
    expect(takeCarriedView(main)).toEqual({ scroll: 120 });
    expect(takeCarriedView(main), 'once').toBeUndefined();
  });

  it('travels through the fallback adoption too (a hold asked in another scope)', () => {
    held();
    registerArtifactViewCapture(panel, () => 'here');
    stageArtifactEditorState(panel);
    holdArtifactEditorState(main, A, 'document', artifactEditorFor('document')!);
    expect(takeCarriedView(main)).toBe('here');
  });

  it('carries nothing for a body not mounted (no capture), or one whose capture throws; the move goes on', () => {
    const state = held();
    stageArtifactEditorState(panel);
    adoptStagedArtifactEditorState(A, main);
    expect(takeCarriedView(main)).toBeUndefined();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerArtifactViewCapture(main, () => {
      throw new Error('no view');
    });
    expect(stageArtifactEditorState(main)).toBe(true);
    expect(adoptStagedArtifactEditorState(A, panel)).toBe(true);
    expect(heldArtifactEditorState(panel)).toBe(state);
    expect(takeCarriedView(panel)).toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('a view staged and never adopted goes with the sweep; one adopted goes when its scope’s hold ends', async () => {
    held();
    registerArtifactViewCapture(panel, () => 'staged');
    stageArtifactEditorState(panel);
    await tick();
    holdArtifactEditorState(main, A, 'document', artifactEditorFor('document')!);
    expect(takeCarriedView(main), 'swept with its hold').toBeUndefined();

    registerArtifactViewCapture(main, () => 'adopted');
    stageArtifactEditorState(main);
    adoptStagedArtifactEditorState(A, panel);
    releaseArtifactEditorState(panel);
    expect(takeCarriedView(panel), 'ended with its hold').toBeUndefined();
  });

  it('a capture belongs to its scope while registered: a later registration replaces it, a stale removal leaves the newer', () => {
    held();
    const stale = registerArtifactViewCapture(panel, () => 'first');
    registerArtifactViewCapture(panel, () => 'second');
    stale();
    stageArtifactEditorState(panel);
    adoptStagedArtifactEditorState(A, main);
    expect(takeCarriedView(main)).toBe('second');
  });

  it('a body registers its capture while mounted (useArtifactViewCapture), the latest render’s', () => {
    held();
    let value = 'first';
    const { rerender, unmount } = renderHook(() => useArtifactViewCapture(panel, () => value));
    value = 'latest';
    rerender();
    stageArtifactEditorState(panel);
    adoptStagedArtifactEditorState(A, main);
    expect(takeCarriedView(main)).toBe('latest');
    unmount();
    registerArtifactEditor('document', editor());
    holdArtifactEditorState(panel, A, 'document', artifactEditorFor('document')!);
    stageArtifactEditorState(panel);
    adoptStagedArtifactEditorState(A, main);
    expect(takeCarriedView(main), 'unmounted, nothing').toBeUndefined();
  });
});
