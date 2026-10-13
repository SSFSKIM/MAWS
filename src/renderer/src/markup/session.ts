// P3-G (§D4.1 to §D4.4): one mark-up session at a time, over the selected panel tab's surface. Start takes the still
// before anything is drawn (so neither capture route sees the overlay) and freezes the surface; the overlay
// (MarkupLayer) draws over the still; Add to chat composites and delivers to the shown session's composer; Escape, the
// surface unmounting, a panel tab switch and the panel collapsing discard. The page or artifact is never changed.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CapturedImage } from '@shared/markup/image';
import type { EditorHostScope } from '../panel/editor-host';
import { selectedPanelTabId, shownSession } from '../panel/host';
import { prefillComposer, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import { compositeMarkup } from './composite';
import type { Mark } from './drawing';
import { markupSurfaceOf, onMarkupSurfaceRemoved, type MarkupSurface } from './surface';

export const MARKUP_COPY = {
  markUp: 'Mark up',
  noSession: 'Open a session to mark up',
  captureFailed: 'Couldn’t capture this page',
  addFailed: 'Couldn’t add the mark-up to the chat',
  layer: 'Mark-up',
  tools: 'Mark-up tool',
  inks: 'Ink colour',
  undo: 'Undo',
  nothingToUndo: 'Nothing to undo yet',
  clear: 'Clear',
  nothingToClear: 'Nothing to clear yet',
  cancel: 'Cancel',
  addToChat: 'Add to chat',
  text: 'Mark-up text',
  draft: (label: string) => `Mark-up of ${label} `,
};

export interface MarkupSession {
  id: number;
  scope: EditorHostScope;
  surface: MarkupSurface;
  still: CapturedImage;
  label: string;
  size: { width: number; height: number }; // the surface's CSS size when the still was taken: the marks' space
}

export const useMarkup = create<{ session: MarkupSession | null }>()(() => ({ session: null }));

let starting = false;
let serial = 0;
let unwatch: (() => void) | null = null;
let focusBefore: HTMLElement | null = null;

const panelScope = (): EditorHostScope | null => {
  const tabId = selectedPanelTabId();
  return tabId === null ? null : { surface: 'panel', tabId };
};

// Mark up (the header's button, the palette's `markup.start`): the selected panel tab's surface, unless another session
// runs, no session is shown (nothing to attach to), or the panel is hidden.
export async function startMarkup(scope: EditorHostScope | null = panelScope()): Promise<void> {
  if (starting || useMarkup.getState().session !== null || scope === null) return;
  if (shownSession() === null || useLayout.getState().regions.panel.collapsed) return;
  const surface = markupSurfaceOf(scope);
  const box = surface?.element()?.getBoundingClientRect();
  if (!surface || !box || box.width < 1 || box.height < 1) return;
  starting = true;
  let still: CapturedImage | null;
  try {
    still = await surface.begin();
  } catch (error) {
    console.warn('[markup] the still was not taken:', error instanceof Error ? error.message : error);
    still = null;
  } finally {
    starting = false;
  }
  if (still === null) {
    toast({ level: 'warning', text: MARKUP_COPY.captureFailed, actions: [], dismissible: true });
    return;
  }
  if (markupSurfaceOf(scope) !== surface || !current(scope)) {
    surface.end(); // the surface went (or the tab changed) while its still was taken
    return;
  }
  focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  useMarkup.setState({ session: { id: ++serial, scope, surface, still, label: surface.label(), size: { width: box.width, height: box.height } } });
  watch(scope, surface);
}

// Whether the scope is still the one on screen: the panel's selected tab, the panel shown.
function current(scope: EditorHostScope): boolean {
  if (useLayout.getState().regions.panel.collapsed) return false;
  return scope.surface !== 'panel' || selectedPanelTabId() === scope.tabId;
}

function watch(scope: EditorHostScope, surface: MarkupSurface): void {
  const offLayout = useLayout.subscribe(() => {
    if (!current(scope)) endMarkup();
  });
  const offRemoved = onMarkupSurfaceRemoved((gone) => {
    if (gone === surface) endMarkup();
  });
  unwatch = () => {
    offLayout();
    offRemoved();
  };
}

// The session ends: the surface unfrozen once. `restoreFocus` (a discard) gives the keyboard back where it was.
function finish(restoreFocus: boolean): MarkupSession | null {
  const session = useMarkup.getState().session;
  if (session === null) return null;
  unwatch?.();
  unwatch = null;
  useMarkup.setState({ session: null });
  session.surface.end();
  const before = focusBefore;
  focusBefore = null;
  if (restoreFocus && before?.isConnected) before.focus({ preventScroll: true });
  return session;
}

// Escape, Cancel, the surface going, a tab switch, the panel collapsing: everything is discarded, nothing attached.
export function endMarkup(): void {
  finish(true);
}

// Add to chat: the still and the marks as one picture, attached to the shown session's composer with the label.
export async function addMarkupToChat(marks: readonly Mark[], render: typeof compositeMarkup = compositeMarkup): Promise<void> {
  const session = useMarkup.getState().session;
  if (session === null) return;
  let picture: Blob;
  try {
    picture = await render(session.still, marks, session.size.width);
  } catch (error) {
    console.warn('[markup] the composite failed:', error instanceof Error ? error.message : error);
    if (useMarkup.getState().session === session) finish(true);
    toast({ level: 'warning', text: MARKUP_COPY.addFailed, actions: [], dismissible: true });
    return;
  }
  if (useMarkup.getState().session !== session) return; // discarded meanwhile
  finish(false);
  const target = shownSession();
  if (target !== null) await deliver(target, picture, session.label);
}

async function deliver(appSessionId: AppSessionId, picture: Blob, label: string): Promise<void> {
  const name = picture.type === 'image/jpeg' ? 'mark-up.jpg' : 'mark-up.png';
  const text = MARKUP_COPY.draft(label);
  const composer = useComposerStore.getState().focusTargets.get(appSessionId);
  if (composer?.attachFiles) {
    await composer.attachFiles([new File([picture], name, { type: picture.type })]);
    composer.insertText(text);
    composer.focusEditor();
    return;
  }
  // no composer of the session is mounted (the card closed to its pill): the composer takes it when it mounts
  prefillComposer(appSessionId, { text, images: [{ name, mediaType: picture.type, data: await base64(picture) }] });
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Tests.
export function resetMarkup(): void {
  unwatch?.();
  unwatch = null;
  starting = false;
  focusBefore = null;
  useMarkup.setState({ session: null });
}
