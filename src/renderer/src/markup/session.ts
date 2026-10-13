// P3-G (§D4.1 to §D4.4): one mark-up session at a time, over the selected panel tab's surface. Start takes the still
// before anything is drawn (so neither capture route sees the overlay) and freezes the surface; the overlay
// (MarkupLayer) draws over the still; Add to chat composites and adds it to the shown session's draft (never replacing
// it), ending the session only once the composer took it; Escape, the surface unmounting, a panel tab switch and the
// panel collapsing discard. The page or artifact is never changed.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CapturedImage } from '@shared/markup/image';
import type { EditorHostScope } from '../panel/editor-host';
import { selectedPanelTabId, shownSession } from '../panel/host';
import { queueComposerAttachment, useComposerStore } from '../stores/composer';
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
  composerBusy: 'The composer is busy — try again in a moment',
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

// Add to chat: the still and the marks as one picture, added to the shown session's draft with the label. The session
// ends once the picture is delivered; a composer that refuses it (busy) leaves the overlay and its drawing, with a toast.
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
  const target = shownSession();
  if (target !== null && !(await deliver(target, picture, session.label))) {
    toast({ level: 'warning', text: MARKUP_COPY.composerBusy, actions: [], dismissible: true });
    return;
  }
  if (useMarkup.getState().session === session) finish(false);
}

// Whether the picture was delivered: to the session's mounted composer, which adds it to its draft and takes the label at
// the caret, or (none mounted, or it went while it was asked) to the composer store's queue, which the session's next
// composer drains. False only when a composer still mounted refused it (a send in flight).
async function deliver(appSessionId: AppSessionId, picture: Blob, label: string): Promise<boolean> {
  const name = picture.type === 'image/jpeg' ? 'mark-up.jpg' : 'mark-up.png';
  const file = new File([picture], name, { type: picture.type });
  const text = MARKUP_COPY.draft(label);
  const composer = useComposerStore.getState().focusTargets.get(appSessionId);
  if (composer?.attachFiles) {
    if (await composer.attachFiles([file])) {
      composer.insertText(text);
      composer.focusEditor();
      return true;
    }
    if (useComposerStore.getState().focusTargets.get(appSessionId) === composer) return false;
  }
  queueComposerAttachment(appSessionId, { files: [file], text });
  return true;
}

// Tests.
export function resetMarkup(): void {
  unwatch?.();
  unwatch = null;
  starting = false;
  focusBefore = null;
  useMarkup.setState({ session: null });
}
