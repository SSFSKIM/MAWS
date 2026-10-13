// P3-G (§D2.3, X32): the editor host registrations: one per scope, a replaced registration's handle a no-op, the hook's
// mount and update, its registration kept through an unmount (it lives as long as its tab), the scope from context, and the close guard as both close paths ask it.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  askEditorHostClose,
  clearEditorHost,
  editorHostOf,
  EditorHostScopeContext,
  registerEditorHost,
  resetEditorHosts,
  useEditorHost,
  useEditorHostScope,
  type EditorHostRegistration,
  type EditorHostScope,
} from './editor-host';

const PANEL: EditorHostScope = { surface: 'panel', tabId: 'tool:aaaaaaaa' };
const MAIN: EditorHostScope = { surface: 'main', tabId: 'tool:aaaaaaaa' }; // the same id on the other surface is another scope

beforeEach(() => resetEditorHosts());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('registerEditorHost', () => {
  it('holds the registration under its scope; update patches it; dispose removes it', () => {
    const handle = registerEditorHost(PANEL, { title: 'Brief', saved: 'saving' });
    expect(editorHostOf(PANEL)).toEqual({ title: 'Brief', saved: 'saving' });
    expect(editorHostOf(MAIN)).toBeNull();
    handle.update({ saved: 'saved', unresolved: 2 });
    expect(editorHostOf(PANEL)).toEqual({ title: 'Brief', saved: 'saved', unresolved: 2 });
    handle.dispose();
    expect(editorHostOf(PANEL)).toBeNull();
  });

  it('a second registration for a scope replaces the first, with a dev warning, and the first handle becomes a no-op', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = registerEditorHost(PANEL, { title: 'First' });
    const second = registerEditorHost(PANEL, { title: 'Second' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('panel:tool:aaaaaaaa');
    expect(editorHostOf(PANEL)?.title).toBe('Second');
    first.update({ title: 'Stale' });
    first.dispose(); // a remounting editor's old handle never clears its successor
    expect(editorHostOf(PANEL)?.title).toBe('Second');
    second.dispose();
    expect(editorHostOf(PANEL)).toBeNull();
  });

  it('registering again after a dispose is not a replacement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerEditorHost(PANEL, { title: 'One' }).dispose();
    registerEditorHost(PANEL, { title: 'Two' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('clearEditorHost (a disposed panel instance) removes the registration and retires its handle', () => {
    const handle = registerEditorHost(PANEL, { title: 'Brief' });
    clearEditorHost(PANEL);
    expect(editorHostOf(PANEL)).toBeNull();
    handle.update({ title: 'After' });
    expect(editorHostOf(PANEL)).toBeNull();
  });
});

describe('askEditorHostClose', () => {
  it('asks nothing without a registration or a guard; otherwise answers the guard, a throwing guard keeping the tab', async () => {
    expect(askEditorHostClose(PANEL)).toBeNull();
    const handle = registerEditorHost(PANEL, { title: 'Brief' });
    expect(askEditorHostClose(PANEL), 'no tick added for a registration without a guard').toBeNull();
    let answer = false;
    handle.update({ closeGuard: async () => answer });
    expect(await askEditorHostClose(PANEL)).toBe(false);
    answer = true;
    expect(await askEditorHostClose(PANEL)).toBe(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    handle.update({ closeGuard: async () => Promise.reject(new Error('boom')) });
    expect(await askEditorHostClose(PANEL)).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('useEditorHost and useEditorHostScope', () => {
  function Editor({ host }: { host: EditorHostRegistration }) {
    useEditorHost(useEditorHostScope(), host);
    return null;
  }
  const inScope = (scope: EditorHostScope | null, host: EditorHostRegistration) => (
    <EditorHostScopeContext.Provider value={scope}>
      <Editor host={host} />
    </EditorHostScopeContext.Provider>
  );

  it('registers on mount under the context’s scope and follows each render’s fields (a dropped field goes)', () => {
    const view = render(inScope(PANEL, { title: 'Brief', saved: 'saving', unresolved: 3 }));
    expect(editorHostOf(PANEL)).toMatchObject({ title: 'Brief', saved: 'saving', unresolved: 3 });
    view.rerender(inScope(PANEL, { title: 'Brief', saved: 'saved' }));
    expect(editorHostOf(PANEL)).toMatchObject({ title: 'Brief', saved: 'saved' });
    expect(editorHostOf(PANEL)?.unresolved).toBeUndefined();
  });

  it('keeps the registration through an unmount (it lives as long as its tab); a remount replaces it without a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const guard = async () => false;
    const first = render(inScope(PANEL, { title: 'Brief', closeGuard: guard }));
    first.unmount(); // a tab switch: only the active body is mounted
    expect(editorHostOf(PANEL)?.title).toBe('Brief');
    expect(await askEditorHostClose(PANEL), 'an inactive tab’s guard still vetoes').toBe(false);
    render(inScope(PANEL, { title: 'Brief, again' }));
    expect(editorHostOf(PANEL)?.title).toBe('Brief, again');
    expect(editorHostOf(PANEL)?.closeGuard).toBeUndefined();
    expect(warn, 'the tab’s own body remounting is not a second editor').not.toHaveBeenCalled();
  });

  it('warns when a second registration replaces one whose body is still mounted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(inScope(PANEL, { title: 'Mounted' }));
    registerEditorHost(PANEL, { title: 'Intruder' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('moves its registration when the scope changes, and registers nothing outside a scope', () => {
    const view = render(inScope(PANEL, { title: 'Brief' }));
    view.rerender(inScope(MAIN, { title: 'Brief' }));
    expect(editorHostOf(PANEL)).toBeNull();
    expect(editorHostOf(MAIN)?.title).toBe('Brief');
    view.rerender(inScope(null, { title: 'Brief' }));
    expect(editorHostOf(MAIN)).toBeNull();
  });

  it('useEditorHostScope is null outside a provider', () => {
    let seen: EditorHostScope | null | undefined;
    function Probe() {
      seen = useEditorHostScope();
      return null;
    }
    render(<Probe />);
    expect(seen).toBeNull();
  });

  it('a re-render with unchanged fields does not notify readers', () => {
    const host: EditorHostRegistration = { title: 'Brief', breadcrumb: ['Docs'] };
    const view = render(inScope(PANEL, host));
    const before = editorHostOf(PANEL);
    act(() => view.rerender(inScope(PANEL, host)));
    expect(editorHostOf(PANEL)).toBe(before);
  });
});
