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
import { createDocument } from '@artifacts/document/tabs';
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
  sent = [];
  noContentMs = undefined;
  memory = new MemoryDocumentHost();
  memory.write((doc) => createDocument(doc, { title: 'Launch plan' })); // the host's first tab (kinds/document.ts)
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

// The commands the tab sent, by name.
let sent: string[] = [];
let noContentMs: number | undefined;

function deps(): DocumentTabDeps {
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async (name: CommandName) => (sent.push(name), { ok: true, value: name === 'artifacts.get' ? { artifact: { id: A, kind: 'document', title: 'Launch plan', lastViewedAt: null, spaceId: SPACE, revision: 1 } } : name === 'artifacts.versions' ? { versions: [] } : undefined })) as MawsBridge['invoke'],
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
  return { host, ipc, log: () => {}, confirm: () => false, sessionTitle: () => undefined, sessions: () => [], ...(noContentMs !== undefined && { noContentMs }) };
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
  return { state: hold.state as DocumentTabState, onShown, view, setVisible: (now: boolean) => view.rerender(tree(now)), remount: (now: boolean) => (view.unmount(), render(tree(now))) };
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

  // M8 fix wave 1 (the review's reproduction: the editor said shown with `visible={false}`, and again per editor):
  // `onShown` is the owner's view, so it fires once per showing (the tab's state), only once the synced document is
  // drawn and the body is visible, and never after the body went; the history rail's first `markViewed` waits the same.
  it('says shown only once the document is visible, once per showing, and the rail’s first view waits for it', async () => {
    const first = mount({ visible: false });
    await shown();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(first.onShown).not.toHaveBeenCalled();
    expect(sent.filter((name) => name === 'artifacts.markViewed')).toEqual([]);
    first.setVisible(true);
    await until(() => first.onShown.mock.calls.length === 1, 'onShown');
    await until(() => sent.filter((name) => name === 'artifacts.markViewed').length === 1, 'the rail’s view');
    // another tab of the document mounts another editor; the body remounting (its panel tab reselected) keeps the showing
    act(() => screen.getByRole('button', { name: 'Add tab' }).click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    first.remount(true);
    await shown();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(first.onShown).toHaveBeenCalledOnce();
  });

  it('says nothing for a body that went before its document was drawn', async () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void (frames[id - 1] = () => {}));
    try {
      const { onShown, view } = mount();
      await shown();
      await until(() => frames.length > 0, 'the frame asked for');
      view.unmount();
      for (const frame of frames.splice(0)) frame(0);
      expect(onShown).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
      caf.mockRestore();
    }
  });

  // M8 fix wave 2: a document still without its first tab past the bound says why, in place of an endless "Loading…".
  it('says a document without its first tab has no content yet, then shows it once the tab arrives', async () => {
    noContentMs = 30;
    memory.destroy();
    memory = new MemoryDocumentHost();
    mount();
    await until(() => screen.queryByText(/This document has no content yet/) !== null, 'the notice');
    expect(screen.getByRole('status').textContent).toContain('it was created before MAWS gave every new document its first page');
    act(() => memory.write((doc) => createDocument(doc, { title: 'Launch plan' })));
    await shown();
    expect(screen.queryByText(/This document has no content yet/)).toBeNull();
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
