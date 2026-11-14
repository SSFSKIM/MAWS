// What opens the Side pane and what the comment composer sends (E3 execution document, Design §1, §6, §7, §8 and §9).
// The pane never switches the main view (the panel rule): a thread opened from the composer, or the question view a
// `/btw` opens, is shown at once only when its session is the one the window shows, and otherwise added to that
// session's panel without activation, with a toast saying where it is; a summary row's Open follows the same rule (the
// transcript it sits in may be a thread's own, drawn in its parent's pane). `side.thread.open` forks the parent with the
// anchored first message (or the promoted side questions). UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-
// comment-card.md, §D): a comment for the main conversation is main's content (`side.comment.content`, which reads the
// screenshots on this Mac) sent through the session's port as a typed message is, so it reaches a terminal session and
// a session on another machine; the window no longer calls `side.sendToMain`. A card's send is its pass's (`sendPass`):
// every comment with text, as one message, one flight, settled by §D's table.
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import { commentsMessage, promotionMessage } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { DeliveryKey } from '@shared/ipc/schema/lane-a';
import type { FirstMessage } from '@shared/sessions/intent';
import { ipc } from '../ipc/client';
import { isRemoteLaneA } from '../lane-a/remote-session';
import { panelHost, shownSession, usePanelHost } from '../panel/host';
import { screenshotRoom, sendToSession, sessionControls } from '../session/controls/controls-for';
import { adoptFork, titleOf } from '../sessions/record-ops';
import { displayTitle, listedTitle } from '../sessions/title';
import { toast } from '../stores/notices';
import { useSessions, type SessionsState } from '../stores/sessions';
import { editComment, enterThread, flightRefused, flightSettlements, flightState, flightWent, launchFlight, notePlace, passHost, toastPending, type Flight } from './card/store';
import { SIDE_COPY } from './copy';
import { promotable, setSideView, sidePaneOf, useSidePane, type SideView } from './store';

export const SIDE_TOOL_ID = 'side';

export interface SideParams {
  view?: SideView;
}

// The parent's Side pane on `view`: added (or re-targeted, one per session) and activated when asked.
function openPane(parent: AppSessionId, view: SideView, activate: boolean): void {
  setSideView(parent, view); // the pane reads its view from the store, so an inactive add shows it once selected
  if (!usePanelHost.getState().tools.has(SIDE_TOOL_ID)) return; // a build without the pane (the harness)
  panelHost.addTool<SideParams>(SIDE_TOOL_ID, { appSessionId: parent, params: { view }, activate });
}

// The parent's pane on `view`, on screen when the parent is shown; otherwise waiting in the parent's panel, with a toast
// saying where (`elsewhere`, given the parent's title).
function revealPane(parent: AppSessionId, view: SideView, elsewhere: (parentTitle: string) => string): void {
  const shown = shownSession() === parent;
  openPane(parent, view, shown);
  if (!shown) toast({ level: 'info', text: elsewhere(titleOf(parent)), actions: [], dismissible: true });
}

// The transcript's summary row: the thread in its parent's pane.
export function openSideThread(parent: AppSessionId, child: AppSessionId): void {
  revealPane(parent, { kind: 'thread', childAppSessionId: child }, SIDE_COPY.row.openElsewhere);
}

// A thread the composer just opened.
export function revealNewThread(parent: AppSessionId, child: AppSessionId): void {
  revealPane(parent, { kind: 'thread', childAppSessionId: child }, SIDE_COPY.composer.openedElsewhere);
}

// The question view, where a `/btw` just asked shows its answer (typed in a composer whose session is not the shown one,
// it waits in that session's panel; a side thread's own in its parent's pane answers under the thread instead, btw.ts).
export function revealSideQuestions(parent: AppSessionId): void {
  revealPane(parent, { kind: 'btw' }, SIDE_COPY.btw.askedElsewhere);
}

// The first message `side.thread.open` has main send the thread, as its intent retains it (`display`, the text whole),
// for C10's card to hand back to the editor if the setup is declined, as `forkSession` docks its own. Main builds the
// same text from the same input; the screenshot's image block is main's alone, and a prefill could not take it back.
const threadMessage = (text: string): FirstMessage => ({ content: text, display: text });

// "Continue as a side thread": the answered exchanges (and what the person typed beside them) open a side thread of the
// parent, adopted as C10's fork is, and the parent's pane turns to it: on screen from the parent's question view, and
// from a thread's questions under its thread view (the parent there is the thread, not the shown session) waiting in
// the thread's own panel, with a toast saying where.
export async function promoteSide(parent: AppSessionId, text: string | null, client: MawsBridge = ipc): Promise<{ ok: true } | { ok: false; error: string }> {
  const exchanges = promotable(sidePaneOf(useSidePane.getState(), parent).exchanges ?? []);
  const result = await client.invoke('side.thread.open', { appSessionId: parent, from: { kind: 'btw', exchanges, text } });
  if (!result.ok) return { ok: false, error: result.error.message };
  const adopted = await adoptFork(parent, result.value, threadMessage(promotionMessage(exchanges, text)));
  if (!adopted.ok) return adopted;
  revealNewThread(parent, adopted.appSessionId);
  return { ok: true };
}

export type CommentDestination = 'thread' | 'main';

// One comment of a send: what it is about, the words, and the producer's screenshot (its own field, never the anchor's).
export interface CommentInput {
  anchor: Anchor;
  text: string;
  screenshot: AnchorScreenshot | null;
}

// How a send ended (§D). To main, `unconfirmed` is a terminal session's hand-off whose fate is not known yet: the words
// are the pending send's under `pending` from then on (decision 8).
export type SendOutcome =
  | { ok: true; to: 'main'; disposition: 'sent' | 'steered' | 'queued' }
  | { ok: true; to: 'main'; disposition: 'unconfirmed'; pending: DeliveryKey }
  | { ok: true; to: 'thread'; child: AppSessionId }
  | { ok: false; error: string };

// Decision 10: the longest text a terminal session on another machine takes, in UTF-16 units (its endpoint's
// `SEND_TEXT_MAX`, src/endpoint/rl10/link.ts, which a test pins), checked here so its refusal is said in words.
export const REMOTE_TERMINAL_TEXT_MAX = 65_536;

const COPY = SIDE_COPY.composer;
const failed = (error: unknown): SendOutcome => ({ ok: false, error: error instanceof Error ? error.message : String(error) });

/**
 * Sends `comments` (1 to 20, oldest first) to one destination, for the card and the sheet alike. Unchecked, a side
 * thread forks the parent with all of them (the later ones as `more`), adopted as C10's fork is (its setup followed, its card docked)
 * and revealed in the parent's pane unless `reveal`, asked when the fork answers, says no (a card that still holds the
 * thread shows it itself). Ticked, main builds the content and the session's port sends it.
 */
export async function sendComments(parent: AppSessionId, comments: readonly CommentInput[], toMain: boolean, options: { reveal?: () => boolean } = {}, client: MawsBridge = ipc): Promise<SendOutcome> {
  const given = comments.map(({ anchor, text, screenshot }) => ({ anchor: withoutScreenshot(anchor), text, screenshot })); // the screenshot travels as its own field (M1's review)
  return toMain ? sendToMain(parent, given, client) : openThread(parent, given, options, client);
}

function withoutScreenshot(anchor: Anchor): Anchor {
  const copy = { ...anchor };
  delete copy.screenshot;
  return copy;
}

async function openThread(parent: AppSessionId, [first, ...more]: CommentInput[], options: { reveal?: () => boolean }, client: MawsBridge): Promise<SendOutcome> {
  const from = { kind: 'comment' as const, ...first!, ...(more.length > 0 && { more }) };
  const result = await client.invoke('side.thread.open', { appSessionId: parent, from });
  if (!result.ok) return { ok: false, error: result.error.message };
  const message = commentsMessage([first!, ...more].map(({ anchor, text, screenshot }) => ({ anchor, text, screenshot: screenshot !== null })), 'thread');
  const adopted = await adoptFork(parent, result.value, threadMessage(message));
  if (!adopted.ok) return adopted;
  if (options.reveal?.() ?? true) revealNewThread(parent, adopted.appSessionId);
  return { ok: true, to: 'thread', child: adopted.appSessionId };
}

// Decision 9: the route's room for screenshots keeps the first ones, in the comments' order; the later comments go
// without theirs (their leads then announce none), as the card said before the send.
function withinRoom(comments: CommentInput[], max: number): CommentInput[] {
  let left = max;
  return comments.map((comment) => {
    if (comment.screenshot === null) return comment;
    if (left === 0) return { ...comment, screenshot: null };
    left -= 1;
    return comment;
  });
}

async function sendToMain(parent: AppSessionId, comments: CommentInput[], client: MawsBridge): Promise<SendOutcome> {
  const room = screenshotRoom(parent, sessionControls(parent, client));
  const built = await client.invoke('side.comment.content', { comments: room === null ? comments : withinRoom(comments, room.max) });
  if (!built.ok) return { ok: false, error: built.error.message };
  const { content } = built.value;
  // a terminal session on another machine (a listed row of lane A, with no record): its endpoint's bound on the words
  const remoteTerminal = !useSessions.getState().records.has(parent) && isRemoteLaneA(parent);
  const words = content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
  if (remoteTerminal && words.length > REMOTE_TERMINAL_TEXT_MAX) return { ok: false, error: COPY.tooLongRemote };
  try {
    const result = await sendToSession(parent, content, { origin: 'comment' }, client);
    switch (result.disposition) {
      case 'sent':
      case 'steered':
      case 'queued':
        return { ok: true, to: 'main', disposition: result.disposition };
      case 'unconfirmed':
        return result.pendingKey ? { ok: true, to: 'main', disposition: 'unconfirmed', pending: result.pendingKey } : { ok: false, error: COPY.notConfirmed };
      case 'held': // not given to a comment (only the composer's message waits on a card); refused, as anything else
      case 'refused':
        return { ok: false, error: (result.disposition === 'refused' && result.reason) || COPY.notSent };
    }
  } catch (error) {
    return failed(error); // a host error the port threw
  }
}

// UX wave U5a: the receiving session's title as the card names it (§E: `displayTitle`), a listed row's for another
// machine's terminal session, which has no record.
export function receivingTitle(s: Pick<SessionsState, 'records' | 'listed'>, appSessionId: AppSessionId): string {
  const record = s.records.get(appSessionId);
  const listed = record ? undefined : s.listed.get(appSessionId);
  return listed ? listedTitle(listed) : displayTitle(record);
}

// Where a send to main went, told once it went: the place's line of `place` (a pass's key; decision 8: a hand-off that
// is not confirmed follows its pending send), in the margin entry of the document thread it was on, if any; the sheet,
// with no place, says what a place would beyond a plain delivery as a toast, a hand-off's following its pending send as
// the line would (Decision Log 27).
export function tellWhere(place: string | undefined, thread: string | undefined, parent: AppSessionId, outcome: Extract<SendOutcome, { to: 'main' }>): void {
  const title = receivingTitle(useSessions.getState(), parent);
  const on = thread !== undefined ? { thread } : {};
  if (outcome.disposition === 'unconfirmed') {
    if (place !== undefined) notePlace(place, { kind: 'pending', appSessionId: parent, key: outcome.pending, title, ...on });
    else toastPending(parent, outcome.pending, title);
    return;
  }
  const PLACE = SIDE_COPY.place;
  const text = outcome.disposition === 'steered' ? PLACE.steered(title) : outcome.disposition === 'queued' ? PLACE.queued(title) : PLACE.sent(title);
  if (place !== undefined) notePlace(place, { kind: 'sent', text, at: Date.now(), ...on });
  else if (outcome.disposition === 'queued') toast({ level: 'info', text, actions: [], dismissible: true });
}

/**
 * UX wave U5a (§D): sends every comment of the pass that has text, as one flight, and settles it by §D's table. The
 * flight owns its comments and its hosts' settlements from the moment it sets out, whatever becomes of the pass: each
 * settlement is told once whether it went. Gone, the comments leave the pass; to main the place says where they went
 * and the card on one of them closes; to a side thread the card on one of them becomes the thread, else the thread is
 * revealed in the parent's Side pane. Refused, they stand again with the reason: in the card on one of them, else in a
 * card the mounted host of the pass opens on the newest, else in a toast. A pass that ended meanwhile hears nothing of
 * a send that went (the transcript has it); its refusal is the toast.
 */
export async function sendPass(pass: string, client: MawsBridge = ipc): Promise<void> {
  const flight = launchFlight(pass);
  if (flight === null) return;
  const settlements = flightSettlements(flight);
  const comments = flight.comments.map(({ anchor, text, screenshot }) => ({ anchor, text: text.trim(), screenshot }));
  const outcome = await sendComments(flight.appSessionId, comments, flight.toMain, { reveal: () => revealsThread(flight) }, client);
  for (const settle of settlements) settle(outcome.ok);
  land(flight, outcome);
}

// A side thread the flight opened is revealed in the parent's pane unless a card on one of its comments becomes it; a
// pass that ended hears nothing.
function revealsThread(flight: Flight): boolean {
  const { alive, card } = flightState(flight);
  return alive && card === null;
}

function land(flight: Flight, outcome: SendOutcome): void {
  const { alive, card } = flightState(flight);
  if (!outcome.ok) {
    const newest = flightRefused(flight, outcome.error);
    if (card !== null) return;
    const host = alive ? passHost(flight.pass) : null;
    if (newest !== null && host !== null) editComment(flight.pass, newest.id, host);
    else toast({ level: 'warning', text: COPY.refusedAfterClose(outcome.error), actions: [], dismissible: true });
    return;
  }
  if (outcome.to === 'thread') {
    flightWent(flight, true);
    if (card !== null) enterThread(card.serial, outcome.child, flight.comments.map((comment) => comment.text.trim()).join('\n\n'));
    return;
  }
  if (alive) {
    const last = flight.comments.at(-1)!.anchor;
    tellWhere(flight.pass, last.kind === 'artifact-comment' ? last.threadId : undefined, flight.appSessionId, outcome);
  }
  flightWent(flight);
}
