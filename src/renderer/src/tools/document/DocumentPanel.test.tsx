// The document editor registered into L's registry and mounted as L's surfaces mount it (M8 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13; X32; G's Mark-up surface): the state `createState` makes
// opens the replica and the editor shows it, `onShown` once the document is on screen, the header registered under the
// scope given (the title, the saved word, History toggling the rail the tab holds, the close guard the tab's), the page
// a Mark-up surface while visible, Comment offered only with a session to send to, and the page inside the governing
// system's scope once D's apply API is provided.
import '../../../../../test/support/artifacts-dom-setup'; // first: the editor loads KaTeX, which warns under happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { setDsOverrides } from '@artifacts/document/meta';
import type { ArtifactHost } from '@artifacts/host';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../../test/support/fake-client';
import { artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors } from '../../artifacts/registry';
import { markupSurfaceOf, resetMarkupSurfaces } from '../../markup/surface';
import { editorHostOf, EditorHostScopeContext, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { useLayout } from '../../stores/layout';
import { resetShellStores } from '../../test-support/shell-stores';
import { provideDocumentDesignSystem, type DesignSystemScopeProps } from './design-system';
import { registerDocumentEditor } from './index';
import type { DocumentTabDeps, DocumentTabState } from './tab-state';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const SPACE = '5a5a5a5a-4b5a-4968-8778-695a4b3c2d1e';
const SESSION = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const scope: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-1' };

let memory: MemoryDocumentHost;
let off = () => {};
beforeEach(() => {
  resetShellStores();
  resetEditorHosts();
  resetMarkupSurfaces();
  resetArtifactEditors();
  window.maws = fakeClient({ 'session.intent.get': null }).client;
  memory = new MemoryDocumentHost();
});
afterEach(() => {
  cleanup();
  releaseArtifactEditorState(scope);
  off();
  memory.destroy();
  delete (window as { maws?: unknown }).maws;
});

const until = async (check: () => boolean, what: string) => {
  const give = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
};

function deps(): DocumentTabDeps {
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async (name: CommandName) => ({ ok: true, value: name === 'artifacts.get' ? { artifact: { id: A, kind: 'document', title: 'Launch plan', lastViewedAt: null, spaceId: SPACE, revision: 1 } } : undefined })) as MawsBridge['invoke'],
    on: (() => () => {}) as MawsBridge['on'],
  };
  const editor = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });
  const host = {
    ...editor,
    open: async () => {
      const handle = openMemoryHandle(memory, { log: () => {} });
      await whenSynced(handle);
      return handle;
    },
    export: async () => Promise.reject(new Error('exporting an artifact is not available yet')),
    versionState: async () => new Uint8Array(),
    attributions: async () => new Uint8Array(),
  } as unknown as ArtifactHost;
  return { host, ipc, log: () => {}, confirm: () => false, sessionTitle: () => undefined, sessions: () => [] };
}

// What L's record view does: the kind's Panel with the state held for this scope.
function mount({ visible = true, onShown = vi.fn<() => void>() }: { visible?: boolean; onShown?: ReturnType<typeof vi.fn<() => void>> } = {}) {
  off = registerDocumentEditor(deps);
  const editor = artifactEditorFor('document')!;
  const hold = holdArtifactEditorState<DocumentTabState>(scope, A, 'document', editor as never);
  const Panel = editor.Panel;
  const tree = (shownNow: boolean) => (
    <EditorHostScopeContext.Provider value={scope}>
      <Panel artifactId={A} state={hold.state} scope={scope} visible={shownNow} onShown={onShown} />
    </EditorHostScopeContext.Provider>
  );
  const view = render(tree(visible));
  return { state: hold.state as DocumentTabState, onShown, view, setVisible: (now: boolean) => view.rerender(tree(now)) };
}
const shown = () => until(() => document.querySelector('.ds-doc .ProseMirror') !== null, 'the page');

describe('the document editor in L’s registry', () => {
  it('registers Panel and Main with the tab’s state, and opens the document there', async () => {
    off = registerDocumentEditor(deps);
    const editor = artifactEditorFor('document')!;
    expect(editor.Panel.name).toBe('DocumentPanel');
    expect(editor.Main.name).toBe('DocumentMain');
    expect(typeof editor.createState).toBe('function');
    off();
    expect(artifactEditorFor('document')).toBeNull();
  });

  it('shows the document and says so once it is on screen', async () => {
    const { onShown } = mount();
    expect(screen.getByRole('status').textContent).toContain('Opening the document');
    await shown();
    await until(() => onShown.mock.calls.length > 0, 'onShown');
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(onShown).toHaveBeenCalledOnce();
  });

  it('registers the X32 header under the scope given: the title, the saved word, the rail the tab holds, the tab’s guard', async () => {
    const { state } = mount();
    await shown();
    await until(() => editorHostOf(scope)?.saved === 'saved', 'saved');
    const header = editorHostOf(scope)!;
    expect(header.title).toBe('Launch plan');
    expect(header.unresolved).toBe(0);
    expect(header.closeGuard).toBe(state.closeGuard);
    act(() => header.actions!.find((a) => a.id === 'history')!.onSelect());
    await until(() => screen.queryByRole('complementary', { name: 'Version history' }) !== null, 'the history rail');
    expect(editorHostOf(scope)!.actions!.find((a) => a.id === 'history')!.pressed).toBe(true);
    act(() => editorHostOf(scope)!.actions!.find((a) => a.id === 'history')!.onSelect());
    await until(() => screen.queryByRole('complementary', { name: 'Version history' }) === null, 'the rail closed');
    // an export's failure is said in the header's own action
    act(() => editorHostOf(scope)!.exports!.find((e) => e.id === 'pdf-a4')!.onSelect());
    await until(() => editorHostOf(scope)!.actions!.some((a) => a.id === 'export' && /PDF export failed/.test(a.label)), 'the export’s failure');
  });

  it('registers the page as the tab’s Mark-up surface while it is visible', async () => {
    const first = mount({ visible: false });
    await shown();
    expect(markupSurfaceOf(scope)).toBeNull();
    first.setVisible(true);
    await until(() => markupSurfaceOf(scope) !== null, 'the surface');
    expect(markupSurfaceOf(scope)!.element()).toBe(document.querySelector('.ds-doc'));
    expect(markupSurfaceOf(scope)!.label()).toBe('“Launch plan”');
  });

  it('offers Comment only while a session is shown to send it to', async () => {
    mount();
    await shown();
    expect(within(screen.getByRole('toolbar', { name: 'Formatting' })).queryByRole('button', { name: 'Comment' })).toBeNull();
    act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: SESSION }));
    await until(() => within(screen.getByRole('toolbar', { name: 'Formatting' })).queryByRole('button', { name: 'Comment' }) !== null, 'Comment');
  });

  it('draws the page in the governing system’s scope, in the document medium, with the document’s overrides', async () => {
    const scopes: Array<Omit<DesignSystemScopeProps, 'children'>> = [];
    const systemFor = vi.fn(() => ({ id: 'ds-1' }));
    const offSystem = provideDocumentDesignSystem({
      Scope: ({ children, ...props }) => {
        scopes.push(props);
        return <div data-testid="system-scope">{children}</div>;
      },
      systemFor,
    });
    try {
      const { state } = mount();
      await shown();
      expect(screen.getByTestId('system-scope').contains(document.querySelector('.ds-doc'))).toBe(true);
      expect(systemFor).toHaveBeenLastCalledWith({ spaceId: SPACE });
      expect(scopes.at(-1)).toMatchObject({ system: { id: 'ds-1' }, medium: 'document', overrides: {} });
      act(() => setDsOverrides(state.snapshot().handle!.doc, { '--ds-font-body': 'Georgia, serif' }));
      await until(() => scopes.at(-1)?.overrides?.['--ds-font-body'] === 'Georgia, serif', 'the overrides');
    } finally {
      offSystem();
    }
  });
});
