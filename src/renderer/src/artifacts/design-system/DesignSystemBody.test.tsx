// The Design System page's body in the app (M4, Decision Log 16 and 17): its X32 header (title, saved state, the three
// actions and the export, read from the tab's state) and its Mark-up surface, over a real replica.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { PortProvider } from '@artifacts/provider/port';
import { applyV2, newDoc, stateV2 } from '@artifacts/yjs';
import complete from '@artifacts/design-system/fixtures/complete.tokens.json';
import { setLaw, setToken, writeSystem } from '@artifacts/design-system/model';
import { parseTokens, serializeTokens } from '@artifacts/design-system/tokens';
import { markupSurfaceOf, resetMarkupSurfaces } from '../../markup/surface';
import { askEditorHostClose, editorHostOf, EditorHostScopeContext, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { closeDialog, useDialogs } from '../../sessions/dialogs';
import { useNotices } from '../../stores/notices';
import { DesignSystemBody, savedStateOf } from './DesignSystemBody';
import { OpenedSystem } from './editor';

const SCOPE: EditorHostScope = { surface: 'main', tabId: 'artifact:ds1' };

function fakeHandle() {
  const doc = newDoc();
  writeSystem(doc, { 'DESIGN.md': '# Harbor\n', 'tokens.tokens.json': serializeTokens(parseTokens(complete).tokens!) }, { route: 'derived', at: 0 });
  let state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false };
  const listeners = new Set<(state: DocumentState) => void>();
  const handle: DocumentHandle = {
    doc,
    awareness: null as never,
    state: () => state,
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onRestored: () => () => {},
    holdRemote: () => {},
    close: () => {},
  };
  const set = (next: Partial<DocumentState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  };
  return { doc, handle, set };
}

const host = { assetUrl: (id: string, ref: string) => `maws-artifact://${id}/live/${ref}`, export: vi.fn(async () => ({ path: '/tmp/harbor-claude' })) };

beforeEach(() => {
  resetEditorHosts();
  resetMarkupSurfaces();
  useNotices.setState({ notices: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount(props: Partial<Parameters<typeof DesignSystemBody>[0]> = {}) {
  const { doc, handle, set } = fakeHandle();
  const view = render(
    <EditorHostScopeContext.Provider value={SCOPE}>
      <DesignSystemBody artifactId="ds1" handle={handle} host={host} {...props} />
    </EditorHostScopeContext.Provider>,
  );
  return { doc, handle, set, view };
}

describe('the Design System body (X32, Mark-up)', () => {
  it('registers the header: the system’s name, the saved state, Check against law, Set as my default (disabled without a handler), Export for Claude', () => {
    const { doc, set } = mount();
    const registration = editorHostOf(SCOPE)!;
    expect(registration.title).toBe('Harbor');
    expect(registration.saved).toBe('saved');
    expect(registration.actions!.map((a) => [a.label, a.disabled ?? false])).toEqual([
      ['Check against law', false],
      ['Set as my default', true],
    ]);
    expect(registration.exports!.map((e) => e.label)).toEqual(['Export for Claude']);
    act(() => set({ unsaved: 2 }));
    expect(editorHostOf(SCOPE)!.saved).toBe('saving');
    act(() => setLaw(doc, '# Harbor Press\n'));
    expect(editorHostOf(SCOPE)!.title).toBe('Harbor Press');
  });

  // Decision Log 29: the page and the header show the artifact's title; the law's title stays in the rendered law
  it('shows the artifact’s title in the header, the Mark-up surface and the page; the law keeps its own', () => {
    const { view } = mount({ title: 'Copy of Harbor' });
    expect(editorHostOf(SCOPE)!.title).toBe('Copy of Harbor');
    expect(markupSurfaceOf(SCOPE)!.label()).toBe('Copy of Harbor');
    expect(view.container.querySelector('.dsp-title')!.textContent).toBe('Copy of Harbor');
    expect(view.container.querySelector('[data-ds-section="law"]')!.textContent).toContain('Harbor');
  });

  it('Check against law brings the page’s check into view, from the registration even after the body has gone', () => {
    const { view } = mount();
    const check = view.container.querySelector('[data-ds-section="check"]');
    act(() => editorHostOf(SCOPE)!.actions![0]!.onSelect());
    expect(document.activeElement).toBe(check);
    view.unmount();
    expect(() => editorHostOf(SCOPE)!.actions![0]!.onSelect()).not.toThrow(); // the tab's store, not the body
  });

  it('Set as my default calls the given handler; Export for Claude exports through the host and says where', async () => {
    const onSetDefault = vi.fn();
    mount({ onSetDefault });
    const registration = editorHostOf(SCOPE)!;
    expect(registration.actions![1]!.disabled).toBe(false);
    registration.actions![1]!.onSelect();
    expect(onSetDefault).toHaveBeenCalledTimes(1);
    await act(async () => registration.exports![0]!.onSelect());
    expect(host.export).toHaveBeenCalledWith('ds1', 'claude');
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Exported for Claude to /tmp/harbor-claude']);
    host.export.mockRejectedValueOnce(new Error('exporting an artifact is not available yet'));
    await act(async () => registration.exports![0]!.onSelect());
    expect(useNotices.getState().notices.at(-1)).toMatchObject({ level: 'danger', text: 'Could not export for Claude: exporting an artifact is not available yet' });
  });

  it('registers its Mark-up surface and calls onShown once the system is on screen', () => {
    const onShown = vi.fn();
    const { view } = mount({ onShown });
    expect(markupSurfaceOf(SCOPE)!.element()).toBe(view.container.firstElementChild);
    expect(markupSurfaceOf(SCOPE)!.label()).toBe('Harbor');
    expect(onShown).toHaveBeenCalled();
  });

  it('maps the replica’s state onto the header’s', () => {
    const base: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false };
    expect(savedStateOf(base)).toBe('saved');
    expect(savedStateOf({ ...base, unsaved: 1 })).toBe('saving');
    expect(savedStateOf({ ...base, phase: 'handshake' })).toBe('reconnecting');
    expect(savedStateOf({ ...base, phase: 'off' })).toBe('reconnecting');
    expect(savedStateOf({ ...base, readOnly: true })).toBe('readonly');
  });
});

// Whole-branch review F-I1: a showing ends only once its edits are saved or the owner discards them. The guard is the
// tab's (it reads the showing's replica, X32's lifetime rule), asked by a close, Back or a re-target alike.
describe('the close guard (F-I1)', () => {
  afterEach(() => closeDialog());

  it('lets a saved system close at once, asking nothing', async () => {
    mount();
    expect(await askEditorHostClose(SCOPE)).toBe(true);
    expect(useDialogs.getState().open).toBeNull();
  });

  it('waits for a live replica’s edits to be acknowledged, and asks once it loses the host instead', async () => {
    const { set } = mount();
    act(() => set({ unsaved: 1 }));
    const acked = askEditorHostClose(SCOPE)!;
    act(() => set({ unsaved: 0 }));
    expect(await acked).toBe(true);
    expect(useDialogs.getState().open).toBeNull();
    act(() => set({ unsaved: 1 }));
    const lost = askEditorHostClose(SCOPE)!;
    act(() => set({ phase: 'off' }));
    await act(async () => {});
    expect(useDialogs.getState().open?.kind).toBe('confirm');
    closeDialog();
    expect(await lost).toBe(false);
  });

  it('keeps an offline replica’s edits until the owner discards them, even with the body gone', async () => {
    const persisted = newDoc();
    writeSystem(persisted, { 'DESIGN.md': '# Harbor\n', 'tokens.tokens.json': serializeTokens(parseTokens(complete).tokens!) }, { route: 'derived', at: 0 });
    // The real provider with no port: an open replica that has lost its host (phase off).
    const replica = (): DocumentHandle => {
      const doc = newDoc();
      applyV2(doc, stateV2(persisted));
      const provider = new PortProvider(doc);
      return {
        doc,
        awareness: provider.awareness,
        state: () => ({ ...provider.state, readOnly: false }),
        subscribe: (listener) => provider.subscribe((s) => listener({ ...s, readOnly: false })),
        onRestored: (listener) => provider.onRestored(listener),
        holdRemote: (on) => provider.holdRemote(on),
        close: () => provider.destroy(),
      };
    };
    const opened = new OpenedSystem('ds1', { ...host, open: async () => replica() } as unknown as ArtifactHost);
    await act(async () => {});
    const state = opened.get();
    if (state.status !== 'open') throw new Error('not open');
    const view = render(
      <EditorHostScopeContext.Provider value={SCOPE}>
        <DesignSystemBody artifactId="ds1" handle={state.handle} host={host} />
      </EditorHostScopeContext.Provider>,
    );
    act(() => setToken(state.handle.doc, 'color.accent.$root', { $type: 'color', $value: '#112233' }));
    expect(state.handle.state().unsaved).toBeGreaterThan(0);
    expect(editorHostOf(SCOPE)!.saved).toBe('reconnecting');
    view.unmount(); // a tab switch: the registration and its guard stay with the tab

    const kept = askEditorHostClose(SCOPE);
    expect(kept).not.toBeNull();
    await act(async () => {});
    const dialog = useDialogs.getState().open;
    expect(dialog).toMatchObject({ kind: 'confirm', title: 'Discard unsaved changes to “Harbor”?', confirmLabel: 'Discard changes', destructive: true });
    closeDialog(); // Cancel: the tab stays open with its edits
    expect(await kept).toBe(false);

    const discarded = askEditorHostClose(SCOPE)!;
    await act(async () => {});
    const confirmDialog = useDialogs.getState().open;
    if (confirmDialog?.kind !== 'confirm') throw new Error('no confirmation');
    confirmDialog.answer(true);
    expect(await discarded).toBe(true);
    opened.dispose();
    persisted.destroy();
  });
});
