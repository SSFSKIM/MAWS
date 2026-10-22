// P4-B5 review: the design header's Send to sends what its Export would picture: the board selected (its frame, else the
// active board) and, while the history previews a version, that version's board. Mounted as an `artifact` main tab
// mounts it (as ./comments.test.tsx does), the header's registration read and its Send to chosen.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { Awareness } from '@y/protocols/awareness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { design } from '@artifacts/design/fixtures/support';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { fakeClient } from '../../../../../test/support/fake-client';
import { artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors } from '../../artifacts/registry';
import { resetDelivery, useDelivery } from '../../delivery/store';
import { resetLibrary } from '../../library/store';
import { resetMarkupSurfaces } from '../../markup/surface';
import { editorHostOf, EditorHostScopeContext, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerDesignEditor } from './index';
import type { DesignTabState } from './tab-state';

const DESIGN = '66666666-6666-4666-8666-666666666666';
const scope: EditorHostScope = { surface: 'main', tabId: 'main-tab-1' };
const row: LibraryRow = {
  id: DESIGN, kind: 'design', title: 'Launch screens', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
  revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [],
};

let off = () => {};
beforeEach(() => {
  resetShellStores();
  resetLibrary();
  resetEditorHosts();
  resetMarkupSurfaces();
  resetArtifactEditors();
  resetDelivery();
});
afterEach(() => {
  cleanup();
  releaseArtifactEditorState(scope);
  off();
  delete (window as { maws?: unknown }).maws;
});

async function mount(): Promise<DesignTabState> {
  window.maws = fakeClient({ 'session.intent.get': null, 'library.get': { row } }).client;
  const doc = design([
    { id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone' },
    { id: 'b2', at: { x: 500, y: 0, w: 1280, h: 800 }, title: 'Desktop' },
  ]);
  const state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
  const handle = { doc, awareness: new Awareness(doc), state: () => state, subscribe: () => () => {}, onRestored: () => () => {}, onProvisional: () => () => {}, holdRemote() {}, close() {} } as unknown as DocumentHandle;
  const host = { open: vi.fn(async () => handle), assetUrl: () => '', identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' }) } as unknown as ArtifactHost;
  off = registerDesignEditor(() => ({ host, log: () => {}, confirmDiscard: async () => true }));
  const editor = artifactEditorFor('design')!;
  const hold = holdArtifactEditorState<DesignTabState>(scope, DESIGN, 'design', editor as never);
  const Main = editor.Main;
  render(
    <EditorHostScopeContext.Provider value={scope}>
      <Main artifactId={DESIGN} state={hold.state} scope={scope} visible onShown={() => {}} />
    </EditorHostScopeContext.Provider>,
  );
  await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Design' })).toBeTruthy());
  return hold.state;
}
const sendTo = () => {
  act(() => editorHostOf(scope)!.actions!.find((action) => action.id === 'sendTo')!.onSelect());
  return useDelivery.getState().sheet!.subject;
};

describe('the design header’s Send to (P4-B5 review)', () => {
  it('names the board its Export would picture: the active one, the selected frame, a previewed version’s', async () => {
    const tab = await mount();
    await waitFor(() => expect(editorHostOf(scope)?.actions?.some((action) => action.id === 'sendTo')).toBe(true));
    expect(sendTo()).toMatchObject({ artifactId: DESIGN, kind: 'design', board: 'b1' });
    act(() => tab.view.selectFrame('b2'));
    expect(sendTo()).toMatchObject({ board: 'b2' });
    act(() => tab.view.showVersion({ versionId: 3, board: 'b1', label: 'Phone' }));
    expect(sendTo()).toMatchObject({ versionId: 3, board: 'b1' });
  });
});
