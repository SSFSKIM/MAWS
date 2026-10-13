// The Design System page as the `design_system` kind's editor in L's registry (P3-D M6; Decision Log 18, 25): the tab
// owns the replica (createState opens it, dispose closes it), the body mounts once it has synced, `onShown` fires once
// the content is on screen and the body visible, and the header's app actions: Set as my default (settings 14), Delete
// with its in-use refusal and "Move them to…", and the adopt request for a system with no law.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { newDoc, type Doc } from '@artifacts/yjs';
import complete from '@artifacts/design-system/fixtures/complete.tokens.json';
import { writeSystem } from '@artifacts/design-system/model';
import { parseTokens, serializeTokens } from '@artifacts/design-system/tokens';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { SETTINGS_DEFAULTS_V14 } from '@shared/settings/defaults';
import { resetLibrary } from '../../library/store';
import { resetMarkupSurfaces } from '../../markup/surface';
import { editorHostOf, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { resetComposerStore, useComposerStore } from '../../stores/composer';
import { useLayout } from '../../stores/layout';
import { useNotices } from '../../stores/notices';
import { useSettings } from '../../stores/settings';
import { installFakeMain, ok } from '../../test-support/code';
import { A, mainShowing } from '../../test-support/panel';
import { resetShellStores } from '../../test-support/shell-stores';
import { artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors, type RegisteredArtifactEditor } from '../registry';
import { createDesignSystemEditor, registerDesignSystemEditor, type OpenedSystem } from './editor';

const DS = '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71';
const OTHER = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
const DOC = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SCOPE: EditorHostScope = { surface: 'main', tabId: 'artifact:ds' };
const TOKENS = serializeTokens(parseTokens(complete).tokens!);

function systemDoc(law = '# Harbor\n'): Doc {
  const doc = newDoc();
  writeSystem(doc, { ...(law ? { 'DESIGN.md': law } : {}), 'tokens.tokens.json': TOKENS }, { route: law ? 'derived' : 'imported', at: 0 }, { name: 'Imported Harbor' });
  return doc;
}
function handleOf(doc: Doc) {
  const state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false };
  const close = vi.fn<() => void>();
  const handle: DocumentHandle = { doc, awareness: null as never, state: () => state, subscribe: () => () => {}, onRestored: () => () => {}, holdRemote: () => {}, close };
  return Object.assign(handle, { close });
}
function fakeHost(open: () => Promise<DocumentHandle>) {
  return {
    open: vi.fn(open),
    assetUrl: (id: string, ref: string) => `maws-artifact://${id}/live/${ref}`,
    export: vi.fn(async () => ({ path: '/tmp/x' })),
  } as unknown as ArtifactHost & { open: ReturnType<typeof vi.fn> };
}
const row = (id: string, title: string, kind: LibraryRow['kind'], designSystemId?: string): LibraryRow => ({
  id, kind, title, createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
  revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [], ...(designSystemId ? { designSystemId } : {}),
});
const counts = Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0]));
const ROWS = [row(DS, 'Harbor', 'design_system'), row(OTHER, 'Classroom', 'design_system'), row(DOC, 'Handout', 'document', DS)];
// main's `library.list` over ROWS, by its kind filter
const listed = (input: Record<string, unknown>) => {
  const kind = (input.filter as { kind?: string } | undefined)?.kind;
  return ok({ rows: ROWS.filter((r) => kind === undefined || r.kind === kind), counts });
};

function mount(editor: RegisteredArtifactEditor, state: OpenedSystem, props: { visible?: boolean; onShown?: () => void } = {}) {
  const Body = editor.Panel;
  const onShown = props.onShown ?? vi.fn();
  const view = render(<Body artifactId={DS} state={state} scope={SCOPE} visible={props.visible ?? true} onShown={onShown} />);
  return { view, onShown, rerender: (visible: boolean) => view.rerender(<Body artifactId={DS} state={state} scope={SCOPE} visible={visible} onShown={onShown} />) };
}
const action = (label: string) => editorHostOf(SCOPE)!.actions!.find((a) => a.label === label)!;

beforeEach(() => {
  resetShellStores();
  resetArtifactEditors();
  resetEditorHosts();
  resetMarkupSurfaces();
  resetComposerStore();
  useSettings.setState({ state: { settings: SETTINGS_DEFAULTS_V14, resolvedTheme: 'light' } });
  useNotices.setState({ notices: [] });
});
afterEach(() => {
  cleanup();
  resetLibrary();
  useSettings.setState({ state: null });
});

describe('the design system’s editor in L’s registry', () => {
  it('registers for design_system, and unregisters', () => {
    const off = registerDesignSystemEditor({ host: () => fakeHost(async () => handleOf(systemDoc())) });
    expect(artifactEditorFor('design_system')).not.toBeNull();
    off();
    expect(artifactEditorFor('design_system')).toBeNull();
  });

  it('opens the system for the tab, shows it once synced, and closes it when the tab lets go (even one still opening)', async () => {
    const handle = handleOf(systemDoc());
    let arrive!: (h: DocumentHandle) => void;
    const host = fakeHost(() => new Promise<DocumentHandle>((resolve) => (arrive = resolve)));
    const editor = { ...createDesignSystemEditor({ host: () => host }), Main: createDesignSystemEditor({ host: () => host }).Panel } as RegisteredArtifactEditor<OpenedSystem>;
    const state = editor.createState!({ artifactId: DS, kind: 'design_system', surface: 'main' });
    expect(host.open).toHaveBeenCalledWith(DS);
    const { view } = mount(editor as RegisteredArtifactEditor, state);
    expect(view.container.textContent).toContain('Opening the design system…');
    await act(async () => arrive(handle));
    expect(view.container.querySelector('[data-ds-page]')).not.toBeNull();
    expect(editorHostOf(SCOPE)!.title).toBe('Harbor');
    editor.dispose!(state);
    expect(handle.close).toHaveBeenCalledTimes(1);

    const late = handleOf(systemDoc());
    let arriveLate!: (h: DocumentHandle) => void;
    const slow = fakeHost(() => new Promise<DocumentHandle>((resolve) => (arriveLate = resolve)));
    const gone = createDesignSystemEditor({ host: () => slow }).createState!({ artifactId: DS, kind: 'design_system', surface: 'panel' });
    gone.dispose();
    await act(async () => arriveLate(late));
    expect(late.close).toHaveBeenCalledTimes(1);
  });

  it('says so when the system cannot be opened', async () => {
    const editor = createDesignSystemEditor({ host: () => fakeHost(async () => Promise.reject(new Error('no artifact'))) });
    const state = editor.createState!({ artifactId: DS, kind: 'design_system', surface: 'main' });
    const { view } = mount(editor as RegisteredArtifactEditor, state);
    await act(async () => {});
    expect(view.container.textContent).toBe('Could not open this design system · no artifact');
  });

  it('calls onShown once the system is on screen and the body visible, not while hidden', async () => {
    const editor = createDesignSystemEditor({ host: () => fakeHost(async () => handleOf(systemDoc())) });
    const state = editor.createState!({ artifactId: DS, kind: 'design_system', surface: 'main' });
    const { onShown, rerender } = mount(editor as RegisteredArtifactEditor, state, { visible: false });
    await act(async () => {});
    expect(onShown).not.toHaveBeenCalled();
    rerender(true);
    expect(onShown).toHaveBeenCalled();
  });
});

describe('the header’s app actions', () => {
  async function opened(doc = systemDoc()) {
    const editor = createDesignSystemEditor({ host: () => fakeHost(async () => handleOf(doc)) });
    const state = editor.createState!({ artifactId: DS, kind: 'design_system', surface: 'main' });
    const mounted = mount(editor as RegisteredArtifactEditor, state);
    await act(async () => {});
    return mounted;
  }

  it('Set as my default writes settings 14, and is disabled once it is the default', async () => {
    const main = installFakeMain((name, input) => (name === 'settings.set' ? ok({ settings: { ...SETTINGS_DEFAULTS_V14, artifacts: { defaultDesignSystem: (input as { artifacts: { defaultDesignSystem: string } }).artifacts.defaultDesignSystem, spaceDesignSystems: {} } }, resolvedTheme: 'light' }) : listed(input)));
    await opened();
    expect(action('Set as my default').disabled).toBe(false);
    await act(async () => action('Set as my default').onSelect());
    expect(main.callsOf('settings.set')).toEqual([{ artifacts: { defaultDesignSystem: DS } }]);
    act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V14, artifacts: { defaultDesignSystem: DS, spaceDesignSystems: {} } }, resolvedTheme: 'light' } }));
    expect(action('Set as my default').disabled).toBe(true);
  });

  it('Delete asks first; refused while an artifact uses the system, it lists it and moves it before deleting', async () => {
    let deletes = 0;
    const main = installFakeMain((name, input) => {
      if (name === 'library.list') return listed(input);
      if (name === 'artifacts.update') {
        const { id, kind, title, createdBy, createdAt, updatedAt, lastViewedAt, pinned, agentEditsAsSuggestions, revision } = ROWS[2]!;
        return ok({ artifact: { id, kind, title, createdBy, createdAt, updatedAt, lastViewedAt, pinned, agentEditsAsSuggestions, revision, designSystemId: OTHER } });
      }
      if (name === 'artifacts.delete') {
        deletes += 1;
        return deletes === 1 ? { ok: false, error: { code: 'invalid_input', message: 'in use', issues: { reason: 'designSystemInUse', data: { artifactIds: [DOC] } } } } : ok();
      }
      return ok();
    });
    await opened();
    act(() => action('Delete design system…').onSelect());
    const confirm = screen.getByRole('dialog', { name: 'Delete “Harbor”?' });
    await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' })));
    const inUse = screen.getByRole('dialog', { name: 'Still in use' });
    expect(within(inUse).getByRole('list', { name: 'Artifacts styled by this system' }).textContent).toBe('Handout');
    const target = within(inUse).getByRole('combobox', { name: 'Move them to…' }) as HTMLSelectElement;
    expect([...target.options].map((o) => o.text)).toEqual(['Their defaults (the Space’s, else yours)', 'Classroom']);
    fireEvent.change(target, { target: { value: OTHER } });
    await act(async () => fireEvent.click(within(inUse).getByRole('button', { name: 'Move and delete' })));
    expect(main.callsOf('artifacts.update')).toEqual([{ artifactId: DOC, designSystemId: OTHER }]);
    expect(main.callsOf('artifacts.delete')).toEqual([{ artifactId: DS }, { artifactId: DS }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // M7's e2e: a copy of a system keeps its law's title, so the sheet names the library's row the owner chose to delete
  it('the delete sheet names the system by its library title, not its law’s title', async () => {
    installFakeMain((_, input) => listed(input));
    await opened(systemDoc('# Classroom\n'));
    act(() => action('Delete design system…').onSelect());
    await act(async () => {});
    expect(screen.getByRole('dialog', { name: 'Delete “Harbor”?' })).toBeTruthy();
  });

  it('a system with no law asks the agent to adopt it through the shown session’s message box, without replacing its draft', async () => {
    installFakeMain((_, input) => listed(input));
    useLayout.setState({ main: mainShowing() });
    await opened(systemDoc(''));
    const ask = screen.getByRole('button', { name: 'Ask the agent to adopt it' }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    expect(screen.getByText('Open a session to ask the agent.')).toBeTruthy();
    act(() => useLayout.setState({ main: mainShowing(A) }));
    expect(ask.disabled).toBe(false);
    act(() => fireEvent.click(ask));
    const queued = useComposerStore.getState().attachmentQueue.get(A)!;
    expect(queued).toHaveLength(1);
    expect(queued[0]!.files).toEqual([]);
    expect(queued[0]!.text).toContain(`Adopt a law for the design system “Imported Harbor” (artifact ${DS})`);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['The request is in the chat’s message box; send it when it reads right.']);
  });
});

// M6 fix wave 1, I3 (the review's probe): the delete request belongs to one showing of one system (the tab's
// `OpenedSystem`), so a panel re-targeted to another system through L's registry, or a showing disposed, ends it.
describe('the delete request’s lifetime', () => {
  const PANEL: EditorHostScope = { surface: 'panel', tabId: 'artifacts:ds-retarget' };
  const named = (title: string) => fakeHost(async () => handleOf(systemDoc(`# ${title}\n`)));
  afterEach(() => releaseArtifactEditorState(PANEL));

  it('a re-target to another system in the same panel tab does not carry the first system’s delete sheet', async () => {
    installFakeMain((_, input) => listed(input));
    const hosts: Record<string, ArtifactHost> = { first: named('First'), second: named('Second') };
    let next = 'first';
    const editor = { ...createDesignSystemEditor({ host: () => hosts[next]! }) };
    const Panel = editor.Panel;
    const first = holdArtifactEditorState(PANEL, 'first', 'design_system', editor).state;
    const view = render(<Panel artifactId="first" state={first} scope={PANEL} visible onShown={() => {}} />);
    await act(async () => {});
    act(() => editorHostOf(PANEL)!.actions!.find((a) => a.id === 'design-system.delete')!.onSelect());
    expect(screen.getByRole('dialog', { name: 'Delete “First”?' })).toBeTruthy();
    view.unmount();
    next = 'second';
    const second = holdArtifactEditorState(PANEL, 'second', 'design_system', editor).state; // the registry disposes the first
    expect(second).not.toBe(first);
    render(<Panel artifactId="second" state={second} scope={PANEL} visible onShown={() => {}} />);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editorHostOf(PANEL)!.title).toBe('Second');
  });

  it('a disposed showing’s request is gone; a request made while hidden waits for the showing to be visible', async () => {
    installFakeMain((_, input) => listed(input));
    const editor = createDesignSystemEditor({ host: () => named('First') });
    const state = holdArtifactEditorState(PANEL, 'first', 'design_system', editor).state;
    const Panel = editor.Panel;
    const view = render(<Panel artifactId="first" state={state} scope={PANEL} visible={false} onShown={() => {}} />);
    await act(async () => {});
    act(() => state.requestDelete());
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<Panel artifactId="first" state={state} scope={PANEL} visible onShown={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Delete “First”?' })).toBeTruthy();
    act(() => releaseArtifactEditorState(PANEL));
    expect(state.deleting()).toBe(false);
  });
});
