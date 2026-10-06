// What opens the Side pane and what the comment composer sends (E3 execution document, Design §1, §6, §8 and §9). The
// pane never switches the main view (the panel rule): a thread opened from the composer is shown at once only when its
// parent is the session the window shows, and otherwise added to the parent's panel without activation, with a toast
// saying where it is; a summary row's Open activates it (the person clicked in the parent's transcript, so the parent is
// shown). Main owns the sends: `side.thread.open` forks the parent with the anchored first message, `side.sendToMain`
// steers or sends it the comment.
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { panelHost, usePanelHost } from '../panel/host';
import { adoptFork, titleOf } from '../sessions/record-ops';
import { useLayout } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { toast } from '../stores/notices';
import { SIDE_COPY } from './copy';
import { setSideView, type SideView } from './store';

export const SIDE_TOOL_ID = 'side';

export interface SideParams {
  view?: SideView;
}

const shownSession = (): AppSessionId | null => sessionOfTab(activeTab(useLayout.getState().main));

// The parent's Side pane on `view`: added (or re-targeted, one per session) and activated when asked.
function openPane(parent: AppSessionId, view: SideView, activate: boolean): void {
  setSideView(parent, view); // the pane reads its view from the store, so an inactive add shows it once selected
  if (!usePanelHost.getState().tools.has(SIDE_TOOL_ID)) return; // a build without the pane (the harness)
  panelHost.addTool<SideParams>(SIDE_TOOL_ID, { appSessionId: parent, params: { view }, activate });
}

// The transcript's summary row: the thread in its parent's pane, on screen.
export function openSideThread(parent: AppSessionId, child: AppSessionId): void {
  openPane(parent, { kind: 'thread', childAppSessionId: child }, true);
}

// A thread the composer just opened: on screen when its parent is shown, else waiting in the parent's panel.
export function revealNewThread(parent: AppSessionId, child: AppSessionId): void {
  const shown = shownSession() === parent;
  openPane(parent, { kind: 'thread', childAppSessionId: child }, shown);
  if (!shown) toast({ level: 'info', text: SIDE_COPY.composer.openedElsewhere(titleOf(parent)), actions: [], dismissible: true });
}

export type CommentDestination = 'thread' | 'main';

export interface CommentInput {
  parent: AppSessionId;
  anchor: Anchor;
  text: string;
  screenshot: AnchorScreenshot | null;
}

// Sends a comment where the sheet said. A side thread is adopted as C10's fork is (its setup followed, its card docked)
// and revealed in the parent's pane; Send to main is main's steer-or-send. A refusal comes back in words for the sheet.
export async function sendComment(destination: CommentDestination, input: CommentInput, client: MawsBridge = ipc): Promise<{ ok: true } | { ok: false; error: string }> {
  const { parent, text, screenshot } = input;
  const anchor: Anchor = { ...input.anchor };
  delete anchor.screenshot; // the screenshot travels as its own field, the sheet's (M1's review)
  if (destination === 'main') {
    const result = await client.invoke('side.sendToMain', { appSessionId: parent, anchor, text, screenshot });
    return result.ok ? { ok: true } : { ok: false, error: result.error.message };
  }
  const result = await client.invoke('side.thread.open', { appSessionId: parent, from: { kind: 'comment', anchor, text, screenshot } });
  if (!result.ok) return { ok: false, error: result.error.message };
  const adopted = await adoptFork(parent, result.value, null);
  if (!adopted.ok) return adopted;
  revealNewThread(parent, adopted.appSessionId);
  return { ok: true };
}
