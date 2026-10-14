// The editor mount registry (the P3-L execution document, Decision Log 7; the P3 interface ledger §7): a kind's editor
// registered, replaced and unregistered, `Main` defaulting to `Panel`, and the state an editor keeps per tab, made once
// by `createState` and disposed when the tab goes or the surface shows something else.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHostScope } from '../panel/editor-host';
import { useLayout } from '../stores/layout';
import { resetShellStores } from '../test-support/shell-stores';
import {
  artifactEditorFor, holdArtifactEditorState, registerArtifactEditor, releaseArtifactEditorState, resetArtifactEditors, useArtifactEditor,
  type ArtifactEditorProps,
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
});
