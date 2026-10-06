// What opens the Side pane and what the comment composer sends (E3 execution document, Design §1, §6, §7, §8 and §9).
// The pane never switches the main view (the panel rule): a thread opened from the composer, or the question view a
// `/btw` opens, is shown at once only when its session is the one the window shows, and otherwise added to that
// session's panel without activation, with a toast saying where it is; a summary row's Open activates it (the person
// clicked in the parent's transcript, so the parent is shown). Main owns the sends: `side.thread.open` forks the parent
// with the anchored first message (or the promoted side questions), `side.sendToMain` steers or sends it the comment.
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
import { promotable, setSideView, sidePaneOf, useSidePane, type SideView } from './store';

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

// The parent's pane on `view`, on screen when the parent is shown; otherwise waiting in the parent's panel, with a toast
// saying where (`elsewhere`, given the parent's title).
function revealPane(parent: AppSessionId, view: SideView, elsewhere: (parentTitle: string) => string): void {
  const shown = shownSession() === parent;
  openPane(parent, view, shown);
  if (!shown) toast({ level: 'info', text: elsewhere(titleOf(parent)), actions: [], dismissible: true });
}

// A thread the composer just opened.
export function revealNewThread(parent: AppSessionId, child: AppSessionId): void {
  revealPane(parent, { kind: 'thread', childAppSessionId: child }, SIDE_COPY.composer.openedElsewhere);
}

// The question view, where a `/btw` just asked shows its answer (typed in a composer whose session is not the shown one,
// a side thread's own in the pane among them, it waits in that session's panel).
export function revealSideQuestions(parent: AppSessionId): void {
  revealPane(parent, { kind: 'btw' }, SIDE_COPY.btw.askedElsewhere);
}

// "Continue as a side thread": the answered exchanges (and what the person typed beside them) open a side thread of the
// parent, adopted as C10's fork is, and the pane turns to it.
export async function promoteSide(parent: AppSessionId, text: string | null, client: MawsBridge = ipc): Promise<{ ok: true } | { ok: false; error: string }> {
  const exchanges = promotable(sidePaneOf(useSidePane.getState(), parent).exchanges ?? []);
  const result = await client.invoke('side.thread.open', { appSessionId: parent, from: { kind: 'btw', exchanges, text } });
  if (!result.ok) return { ok: false, error: result.error.message };
  const adopted = await adoptFork(parent, result.value, null);
  if (!adopted.ok) return adopted;
  setSideView(parent, { kind: 'thread', childAppSessionId: adopted.appSessionId });
  return { ok: true };
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
    if (!result.ok) return { ok: false, error: result.error.message };
    // held by a paused or held app queue: it is not lost, and not sent yet either (M3's review)
    if (result.value.disposition === 'queued') toast({ level: 'info', text: SIDE_COPY.composer.queued, actions: [], dismissible: true });
    return { ok: true };
  }
  const result = await client.invoke('side.thread.open', { appSessionId: parent, from: { kind: 'comment', anchor, text, screenshot } });
  if (!result.ok) return { ok: false, error: result.error.message };
  const adopted = await adoptFork(parent, result.value, null);
  if (!adopted.ok) return adopted;
  revealNewThread(parent, adopted.appSessionId);
  return { ok: true };
}
