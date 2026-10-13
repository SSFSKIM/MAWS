// P3-G (§D4.1 to §D4.4): a mark-up session over the selected panel tab's surface: the still taken before anything is
// drawn, a refused capture's toast, the endings (Escape, the surface going, a tab switch, the panel collapsing), and Add
// to chat's delivery to the shown session's composer (its focus target when mounted, else a prefill).
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CapturedImage } from '@shared/markup/image';
import { registerFocusTarget, resetComposerStore, useComposerStore, type FocusTarget } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { mainShowing } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import type { Mark } from './drawing';
import { addMarkupToChat, endMarkup, MARKUP_COPY, resetMarkup, startMarkup, useMarkup } from './session';
import { registerMarkupSurface, resetMarkupSurfaces, type MarkupSurface } from './surface';

const A = 'app-a' as AppSessionId;
const TAB = 'browser:1';
const scope = { surface: 'panel', tabId: TAB } as const;
const still: CapturedImage = { mediaType: 'image/png', data: 'c3RpbGw=', width: 1600, height: 1000 };

function surface(answer: CapturedImage | null = still): MarkupSurface & { begin: Mock<() => Promise<CapturedImage | null>>; end: Mock<() => void> } {
  const element = document.body.appendChild(document.createElement('div'));
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 300, top: 120, width: 800, height: 500, x: 300, y: 120, right: 1100, bottom: 620, toJSON: () => ({}) } as DOMRect);
  return { element: () => element, label: () => '"Page A" — http://127.0.0.1/a.html', begin: vi.fn(async () => answer), end: vi.fn<() => void>() };
}

function showSessionWithTab(): void {
  useLayout.setState({ main: mainShowing(A), panelBySession: new Map([[A, { tabs: [{ id: TAB, toolId: 'browser', pinned: false }, { id: 'deliverables', toolId: 'deliverables', pinned: false }], activeTabId: TAB }]]) });
}

const toasts = () => useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => n.text);

beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  resetMarkup();
  resetMarkupSurfaces();
  useNotices.setState({ notices: [] });
  showSessionWithTab();
});
afterEach(() => {
  resetMarkup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('startMarkup', () => {
  it('takes the still of the selected panel tab’s surface and opens the session at the surface’s size', async () => {
    const s = surface();
    registerMarkupSurface(scope, s);
    await startMarkup();
    expect(s.begin).toHaveBeenCalledTimes(1);
    expect(useMarkup.getState().session).toMatchObject({ scope, still, label: '"Page A" — http://127.0.0.1/a.html', size: { width: 800, height: 500 } });
    await startMarkup(); // one session at a time
    expect(s.begin).toHaveBeenCalledTimes(1);
  });

  it('shows the toast and enters nothing when the capture answers null', async () => {
    const s = surface(null);
    registerMarkupSurface(scope, s);
    await startMarkup();
    expect(useMarkup.getState().session).toBeNull();
    expect(toasts()).toEqual([MARKUP_COPY.captureFailed]);
    expect(MARKUP_COPY.captureFailed).toBe('Couldn’t capture this page');
  });

  it('does nothing with no surface, no shown session or a collapsed panel', async () => {
    await startMarkup();
    expect(useMarkup.getState().session).toBeNull();
    const s = surface();
    registerMarkupSurface(scope, s);
    useLayout.getState().setPanel({ collapsed: true });
    await startMarkup();
    useLayout.getState().setPanel({ collapsed: false });
    useLayout.setState({ main: mainShowing() });
    await startMarkup(scope);
    expect(s.begin).not.toHaveBeenCalled();
  });

  it('lets the frozen surface go when the surface went away while its still was being taken', async () => {
    let answer: (image: CapturedImage) => void = () => {};
    const s = surface();
    s.begin.mockImplementation(() => new Promise<CapturedImage>((resolve) => (answer = resolve)));
    const off = registerMarkupSurface(scope, s);
    const started = startMarkup();
    off();
    answer(still);
    await started;
    expect(useMarkup.getState().session).toBeNull();
    expect(s.end).toHaveBeenCalledTimes(1);
  });
});

describe('the session’s endings', () => {
  async function started() {
    const s = surface();
    const off = registerMarkupSurface(scope, s);
    await startMarkup();
    expect(useMarkup.getState().session).not.toBeNull();
    return { s, off };
  }

  it('Escape (endMarkup) unfreezes the surface once and attaches nothing', async () => {
    const { s } = await started();
    endMarkup();
    endMarkup();
    expect(s.end).toHaveBeenCalledTimes(1);
    expect(useMarkup.getState().session).toBeNull();
    expect(useComposerStore.getState().prefills.size).toBe(0);
  });

  it('ends when the surface unregisters (it unmounted)', async () => {
    const { s, off } = await started();
    off();
    expect(useMarkup.getState().session).toBeNull();
    expect(s.end).toHaveBeenCalledTimes(1);
  });

  it('ends on a panel tab switch and on the panel collapsing', async () => {
    const first = await started();
    useLayout.setState((st) => ({ panelBySession: new Map(st.panelBySession).set(A, { ...st.panelBySession.get(A)!, activeTabId: 'deliverables' }) }));
    expect(useMarkup.getState().session).toBeNull();
    expect(first.s.end).toHaveBeenCalledTimes(1);
    first.off();
    showSessionWithTab();
    const second = await started();
    useLayout.getState().setPanel({ collapsed: true });
    expect(useMarkup.getState().session).toBeNull();
    expect(second.s.end).toHaveBeenCalledTimes(1);
  });
});

describe('addMarkupToChat', () => {
  const marks: Mark[] = [{ tool: 'box', ink: 'red', from: { x: 1, y: 1 }, to: { x: 9, y: 9 } }];
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

  it('composites at the session’s size, attaches mark-up.png to the mounted composer, puts the label in the draft and focuses it', async () => {
    const s = surface();
    registerMarkupSurface(scope, s);
    const calls: string[] = [];
    const files: File[] = [];
    registerFocusTarget(A, {
      focusEditor: () => calls.push('focus'),
      focusFrame: () => {},
      insertText: (text) => calls.push(`insert ${text}`),
      attachFiles: async (attached) => {
        files.push(...attached);
        calls.push('attach');
      },
    } as FocusTarget);
    await startMarkup();
    const render = vi.fn(async () => png);
    await addMarkupToChat(marks, render);
    expect(render).toHaveBeenCalledWith(still, marks, 800);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: 'mark-up.png', type: 'image/png', size: 4 });
    expect(calls).toEqual(['attach', 'insert Mark-up of "Page A" — http://127.0.0.1/a.html ', 'focus']);
    expect(s.end).toHaveBeenCalledTimes(1);
    expect(useMarkup.getState().session).toBeNull();
  });

  it('prefills the session’s composer when none is mounted (the card closed to its pill), the image by name, type and base64', async () => {
    registerMarkupSurface(scope, surface());
    await startMarkup();
    await addMarkupToChat(marks, async () => png);
    expect(useComposerStore.getState().prefills.get(A)).toEqual({
      text: 'Mark-up of "Page A" — http://127.0.0.1/a.html ',
      images: [{ name: 'mark-up.png', mediaType: 'image/png', data: 'iVBORw==' }],
    });
  });

  it('names a JPEG fallback mark-up.jpg', async () => {
    registerMarkupSurface(scope, surface());
    await startMarkup();
    await addMarkupToChat([], async () => new Blob([new Uint8Array([255, 216])], { type: 'image/jpeg' }));
    expect(useComposerStore.getState().prefills.get(A)?.images).toEqual([{ name: 'mark-up.jpg', mediaType: 'image/jpeg', data: '/9g=' }]);
  });
});
