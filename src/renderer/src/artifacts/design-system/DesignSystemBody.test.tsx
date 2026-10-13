// The Design System page's body in the app (M4, Decision Log 16 and 17): its X32 header (title, saved state, the three
// actions and the export, read from the tab's state) and its Mark-up surface, over a real replica.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentHandle, DocumentState } from '@artifacts/host';
import { newDoc } from '@artifacts/yjs';
import complete from '@artifacts/design-system/fixtures/complete.tokens.json';
import { setLaw, writeSystem } from '@artifacts/design-system/model';
import { parseTokens, serializeTokens } from '@artifacts/design-system/tokens';
import { markupSurfaceOf, resetMarkupSurfaces } from '../../markup/surface';
import { editorHostOf, EditorHostScopeContext, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { useNotices } from '../../stores/notices';
import { DesignSystemBody, savedStateOf } from './DesignSystemBody';

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
    expect(registration.closeGuard ?? null).toBeNull();
    act(() => set({ unsaved: 2 }));
    expect(editorHostOf(SCOPE)!.saved).toBe('saving');
    act(() => setLaw(doc, '# Harbor Press\n'));
    expect(editorHostOf(SCOPE)!.title).toBe('Harbor Press');
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
