// D's apply API bound into B's document page (the P3 spec's Decision Log 61, part 2): with the binding the app provides,
// B's editor draws its page inside D's scope, in the system that governs the document as the chain resolves it from the
// owner's and the Spaces' defaults (settings 14), the house system the window follows and the library's live systems;
// and the page moves when any of those does. Mounted as L's record view mounts B's editor, under the app's provider.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { colorToCss, type ColorValue } from '@artifacts/design-system/color';
import complete from '@artifacts/design-system/fixtures/complete.tokens.json';
import { setToken, writeSystem } from '@artifacts/design-system/model';
import { parseTokens, serializeTokens } from '@artifacts/design-system/tokens';
import { builtinView } from '@artifacts/design-system/view';
import type { HouseDesignSystem } from '@artifacts/design-system/apply';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { createDocument } from '@artifacts/document/tabs';
import type { ArtifactHost, DocumentHandle } from '@artifacts/host';
import { newDoc, type Doc } from '@artifacts/yjs';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';
import { connectLibrary, resetLibrary } from '../../library/store';
import { resetMarkupSurfaces } from '../../markup/surface';
import { EditorHostScopeContext, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { useSettings } from '../../stores/settings';
import { installFakeMain, ok } from '../../test-support/code';
import { resetShellStores } from '../../test-support/shell-stores';
import { provideDocumentDesignSystem } from '../../tools/document/design-system';
import { registerDocumentEditor } from '../../tools/document/index';
import type { DocumentTabDeps, DocumentTabState } from '../../tools/document/tab-state';
import { artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors } from '../registry';
import { DOCUMENT_DESIGN_SYSTEM } from './documents';
import { DesignSystemHostProvider } from './provider';

const DOC = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const SPACE = '5a5a5a5a-4b5a-4968-8778-695a4b3c2d1e';
const HARBOR = '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71';
const HOUSE = '11111111-1111-4111-8111-111111111111';
const OWNERS = '22222222-2222-4222-8222-222222222222';
const SCOPE: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-1' };
const TOKENS = serializeTokens(parseTokens(complete).tokens!);
// Each system's accent as a token value (the guard keeps colour literals to tokens.css), and the CSS its stylesheet draws.
const srgb = (...components: number[]): ColorValue => ({ colorSpace: 'srgb', components });
const ACCENT_VALUE = { [HARBOR]: srgb(0.18, 0.42, 0.31), [HOUSE]: srgb(0.48, 0.25, 0.69), [OWNERS]: srgb(0.11, 0.3, 0.85) };
const ACCENT = Object.fromEntries(Object.entries(ACCENT_VALUE).map(([id, value]) => [id, colorToCss(value)]));
const FLOOR_ACCENT = /--ds-color-accent: ([^;]+);/.exec(builtinView().css(':root', 'document'))![1]!;

function systemDoc(accent: ColorValue): Doc {
  const doc = newDoc();
  writeSystem(doc, { 'tokens.tokens.json': TOKENS }, { route: 'derived', at: 0 }, { name: 'System' });
  setToken(doc, 'color.accent.$root', { $value: accent });
  return doc;
}

/** The store's design systems as the app's ArtifactHost opens them: replicas synced at once. */
function systemHost(): ArtifactHost {
  const docs = new Map(Object.entries(ACCENT_VALUE).map(([id, accent]) => [id, systemDoc(accent)]));
  const open = async (id: string): Promise<DocumentHandle> => {
    const doc = docs.get(id);
    if (!doc) throw new Error(`no artifact ${id}`);
    return { doc, awareness: null as never, state: () => ({ phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false }), subscribe: () => () => {}, onRestored: () => () => {}, onProvisional: () => () => {}, holdRemote: () => {}, close: () => {} };
  };
  return { open, assetUrl: (id: string, ref: string) => `maws-artifact://${id}/live/${ref}` } as unknown as ArtifactHost;
}

/** The window's followed house system, as a test moves it. */
function houseSource(initial: string | null): HouseDesignSystem & { set(id: string | null): void } {
  let id = initial;
  const listeners = new Set<() => void>();
  return {
    current: () => id,
    subscribe: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    set: (next) => {
      id = next;
      for (const listener of listeners) listener();
    },
  };
}

const row = (id: string): LibraryRow => ({
  id, kind: 'design_system', title: id, createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
  revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [],
});
const counts = Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0]));

let memory: MemoryDocumentHost;
let librarySystems: string[];
let main: ReturnType<typeof installFakeMain>;
let offs: (() => void)[] = [];

beforeEach(() => {
  resetShellStores();
  resetEditorHosts();
  resetMarkupSurfaces();
  resetArtifactEditors();
  useSettings.setState({ state: { settings: SETTINGS_DEFAULTS_V19, resolvedTheme: 'light' } });
  librarySystems = [HARBOR, HOUSE, OWNERS];
  // main's library, which the binding reads for the live systems; read again at each `library.changed`
  main = installFakeMain((name: CommandName) => (name === 'library.list' ? ok({ rows: librarySystems.map(row), counts }) : ok(null)));
  memory = new MemoryDocumentHost();
  memory.write((doc) => createDocument(doc, { title: 'Syllabus' }));
  offs = [provideDocumentDesignSystem(DOCUMENT_DESIGN_SYSTEM), connectLibrary()]; // the app's provision (App.tsx, at module load) and its library feed
});
afterEach(() => {
  cleanup();
  releaseArtifactEditorState(SCOPE);
  for (const off of offs) off();
  memory.destroy();
  resetLibrary();
  useSettings.setState({ state: null });
  delete (window as { maws?: unknown }).maws;
});

const until = async (check: () => boolean, what: string) => {
  const give = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
};

/** B's tab deps, its row placing the document as `placement` says. */
function deps(placement: { designSystemId?: string; spaceId?: string }): () => DocumentTabDeps {
  return () => {
    const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
      invoke: (async (name: CommandName) => ({ ok: true, value: name === 'artifacts.get' ? { artifact: { id: DOC, kind: 'document', title: 'Syllabus', lastViewedAt: null, revision: 1, ...placement } } : name === 'artifacts.versions' ? { versions: [] } : undefined })) as MawsBridge['invoke'],
      on: (() => () => {}) as MawsBridge['on'],
    };
    const host = {
      ...memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' }),
      open: async () => {
        const handle = openMemoryHandle(memory, { log: () => {} });
        await whenSynced(handle);
        return handle;
      },
    } as unknown as ArtifactHost;
    return { host, ipc, log: () => {}, confirm: () => false, sessionTitle: () => undefined, sessions: () => [] };
  };
}

/** B's editor as L's record view mounts it, under the app's design-system provider. */
function mount(placement: { designSystemId?: string; spaceId?: string }, house: HouseDesignSystem) {
  offs.push(registerDocumentEditor(deps(placement)));
  const editor = artifactEditorFor('document')!;
  const hold = holdArtifactEditorState<DocumentTabState>(SCOPE, DOC, 'document', editor as never);
  const Panel = editor.Panel;
  render(
    <DesignSystemHostProvider host={systemHost()} house={house}>
      <EditorHostScopeContext.Provider value={SCOPE}>
        <Panel artifactId={DOC} state={hold.state} scope={SCOPE} visible onShown={() => {}} />
      </EditorHostScopeContext.Provider>
    </DesignSystemHostProvider>,
  );
}

const page = () => document.querySelector<HTMLElement>('.ds-doc');
/** The accent the page draws: the `--ds-color-accent` set by the stylesheet of the scope the page sits in (null: none). */
function pageAccent(): string | null {
  const scope = page()!.closest('[data-ds-scope]')?.getAttribute('data-ds-scope');
  const sheet = scope && document.querySelector(`style[data-ds-scope-style="${scope}"]`)?.textContent;
  return (sheet && /--ds-color-accent: ([^;]+);/.exec(sheet)?.[1]) ?? null;
}
const drawn = (accent: string, what: string) => until(() => page() !== null && pageAccent() === accent, what);
const setDefaults = (artifacts: { defaultDesignSystem: string | null; spaceDesignSystems: Record<string, string>; commentsView: 'expand' | 'minimize' | 'hide' /* P4-B1 */ }) =>
  act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V19, artifacts }, resolvedTheme: 'light' } }));

describe('B’s document page under D’s scope', () => {
  it('draws the page in its own system’s tokens, the page element inside D’s scope', async () => {
    mount({ designSystemId: HARBOR }, houseSource(HOUSE));
    await drawn(ACCENT[HARBOR], 'the document’s own system');
    expect(page()!.closest('[data-ds-scope]')!.contains(page()!.querySelector('.ProseMirror'))).toBe(true); // the editor's page, not its chrome
  });

  it('re-resolves as the Space’s and the owner’s defaults change, as a default leaves the library, and as the house moves', async () => {
    const house = houseSource(HOUSE);
    mount({ spaceId: SPACE }, house);
    await drawn(ACCENT[HOUSE], 'the house system, with no default');
    setDefaults({ defaultDesignSystem: OWNERS, spaceDesignSystems: {}, commentsView: 'expand' /* P4-B1 */ });
    await drawn(ACCENT[OWNERS], 'the owner’s default');
    setDefaults({ defaultDesignSystem: OWNERS, spaceDesignSystems: { [SPACE]: HARBOR }, commentsView: 'expand' /* P4-B1 */ });
    await drawn(ACCENT[HARBOR], 'the Space’s default, before the owner’s');
    // the Space's system deleted: the library no longer lists it, and the chain skips it to the owner's default
    librarySystems = [HOUSE, OWNERS];
    act(() => main.emit('library.changed', { revision: 2 }));
    await drawn(ACCENT[OWNERS], 'the owner’s default once the Space’s system is gone');
    setDefaults({ defaultDesignSystem: null, spaceDesignSystems: { [SPACE]: HARBOR }, commentsView: 'expand' /* P4-B1 */ });
    await drawn(ACCENT[HOUSE], 'the house system once no default is live');
    // the house system deleted with none to follow it: the bundled floor
    act(() => house.set(null));
    await drawn(FLOOR_ACCENT, 'the floor');
    act(() => house.set(OWNERS)); // another system became the house
    await drawn(ACCENT[OWNERS], 'the new house system');
  });
});
