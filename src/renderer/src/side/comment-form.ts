// The comment form's logic, shared by its two presentations (P2-E1 document, D5): E3's sheet and P2-E1's card call this
// one hook, so their phases and sends cannot drift. The form takes a comment, where it goes and a producer's screenshot
// the person may remove; Enter sends (P4-B1: ⌘Enter too), Shift+Enter breaks a line, an input method's composition keeps
// its Enter. While a send is on its way the form is disabled; a refusal stays in the form with Retry and, while a send to
// main is offered, Send to main instead; a refusal arriving after the presentation went (closed or replaced: `gone`) is
// a toast, so the comment is never lost unseen.
//
// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M2; decisions 6 to 10): where it goes is one
// checkbox, "Send to main", unchecked unless the surface asked for main. Whether a tick can send is the session's port's
// answer (`capability('send')`), the composer's own, so one rule covers a session MAWS runs, a terminal session and one
// on another machine; whether unchecked can is known here for an archived session, one with no conversation to fork,
// and one on another machine (where the box is ticked and locked). The box cannot be moved into a state that can't
// send, its reason the box's title; a state it is in that can't send says why in a line under the field. A tick sends
// through `sendComments`, which starts a session that is not running itself (the button reads Starting… meanwhile);
// the sheet says what is not a plain delivery as a toast.
//
// UX wave U5a (M3; §C, §D, decision 4): the card's form is its pass's (`usePassForm`): the comment's text, its
// screenshot, the checkbox and the send's state live in the card's store, and Send is the pass's (`sendPass`), so
// nothing typed or sent depends on what is mounted. The sheet keeps its own state, as before.
import { useState, type KeyboardEvent } from 'react';
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import { MESSAGE_COMMENTS_MAX } from '@shared/anchor/message'; // Decision Log 52
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { isAddress, machineOf } from '@shared/machine/address';
import { ARCHIVED, STARTS, submitState, type SubmitInput } from '../composer/submit/submit-state'; // P2-A; UX wave U5a: submitState
import { ipc } from '../ipc/client';
import { useIsRemoteLaneB } from '../lane-b/remote-session';
import { heldWords, screenshotRoom, useSessionControls } from '../session/controls/controls-for';
import { useAvailability } from '../sessions/availability'; // P2-A
import { holderWords } from '../sessions/holder-words';
import { useReaderClosed } from '../sessions/share/reader';
import { useMachines } from '../stores/machines';
import { toast } from '../stores/notices';
import { machineName } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { sendComments, sendPass, tellWhere, type CommentDestination } from './actions';
import { flightToMain, removeScreenshot, setCommentText, setPassToMain, useCommentCard, type PassComment } from './card/store';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable'; // P5 O7 M8
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.composer;

export type CommentFormPhase =
  | { kind: 'editing' }
  | { kind: 'sending'; destination: CommentDestination }
  | { kind: 'refused'; destination: CommentDestination; error: string };

export interface CommentFormInput {
  anchor: Anchor;
  parent: AppSessionId;
  gone(): boolean; // the presentation was closed or replaced while the send was on its way
  onSent(sent: { child?: AppSessionId; text: string }): void; // a send that went (the side thread it opened, the text sent)
  destination?: CommentDestination; // P3-F1: the one the form starts on (CommentContext's), unchecked when absent
}

// UX wave U5a (decision 6): the composer's submit table asked for a typed message (Send, the box not empty, no setup
// intent: a card's session has its record), its reason when it may not go.
function refusalOfTable(i: { status: SubmitInput['status']; availability: SubmitInput['availability']; holder: SessionRecord['holder'] | null; closed: string | null; driven: SubmitInput['driven'] }): string | null {
  const heldBy = i.holder !== null && (i.holder.kind === 'terminal' || i.holder.kind === 'background_job') ? holderWords(i.holder) : null;
  const decision = submitState({ status: i.status, intent: null, queue: { entries: [], paused: false }, empty: false, mode: 'send', availability: i.availability, heldBy, driven: i.driven ?? null, closed: i.closed });
  return decision.enabled ? null : (decision.reason ?? COPY.notSent);
}

// UX wave U5a start (decisions 6, 7, 9): what each state of the checkbox can do now for `parent`, shared by the sheet and
// the card.
function useRoute(parent: AppSessionId) {
  const status = useSessions((s) => s.engine.get(parent) ?? null);
  const controls = useSessionControls(parent);
  const remoteLaneB = useIsRemoteLaneB(parent);
  const availability = useAvailability(parent);
  const forkable = useSessions((s) => s.records.get(parent)?.engineSessionId !== null); // no record: the machine side says
  const threadRemote = useRemoteUnavailable(parent, 'side.thread.open'); // P5 O7 M8: not on another machine yet
  const machine = useMachines((s) => (isAddress(parent) ? machineName(s.machines, machineOf(parent), ipc.localMachine) : ''));
  const holder = useSessions((s) => s.records.get(parent)?.holder ?? null);
  const closed = useReaderClosed(parent); // board 525: another member's session that refused the member's words
  const turn = controls?.turn() ?? null; // a bridged session's own turn; null where the status says it (lane B)
  // decision 6: whether a tick can send is the composer's own decision, its submit table over the inputs the composer
  // reads (a session another process drives first, then the availability of one with no ready process), for a typed
  // message; with no port, nothing sends, as the composer's Enter does nothing
  const mainRefusal = controls ? refusalOfTable({ status, availability, holder, closed, driven: turn && { running: turn.running, send: controls.capability('send'), stop: controls.capability('interrupt') } }) : heldWords(parent);
  const threadRefusal = threadRemote !== null ? COPY.threadRemote(machine) : availability === 'archived' ? ARCHIVED : forkable ? null : COPY.noConversation;
  const ready = status?.process === 'ready';
  return {
    threadRemote,
    mainRefusal,
    threadRefusal,
    refusalOf: (to: CommentDestination) => (to === 'main' ? mainRefusal : threadRefusal),
    ready,
    running: turn ? turn.running : ready && Boolean(status?.turn),
    starts: turn === null && !remoteLaneB && !ready, // the send acquires it first (lane B on this Mac)
    room: (toMain: boolean) => (toMain ? screenshotRoom(parent, controls) : null),
  };
}

// What the form draws, from the route and the state it is in (one shape for the sheet and the card).
function formOf(route: ReturnType<typeof useRoute>, state: { wantsMain: boolean; screenshot: AnchorScreenshot | null; screenshots: number; flightTo: CommentDestination | null; withText: number; boxHeld: boolean }) {
  const { threadRemote, mainRefusal, threadRefusal, refusalOf, starts, running } = route;
  // ticked and locked for another machine's session (no side thread there yet, whatever its port says meanwhile);
  // otherwise the person's choice, which cannot be moved into a state that can't send
  const toMain = threadRemote !== null || state.wantsMain;
  const destination: CommentDestination = toMain ? 'main' : 'thread';
  const otherRefusal = refusalOf(toMain ? 'thread' : 'main');
  const room = route.room(toMain);
  const busy = state.flightTo !== null; // a send is on its way
  return {
    destination,
    toMain,
    // UX wave U5a: the box is off where the state it would move to can't send, and while the sheet's send is on its way
    // (`boxHeld`); a card's pass may change it during a flight (§D), which keeps the destination it set out with
    toMainFixed: state.boxHeld || otherRefusal !== null,
    // its title: why a tick can't send, or why it can't be left, else what a tick does now (the composer's words)
    toMainTitle: (threadRemote !== null ? threadRefusal : null) ?? mainRefusal ?? (toMain ? threadRefusal : null) ?? (starts ? STARTS : running ? COPY.mainBusy : COPY.mainIdle),
    unsendable: refusalOf(destination), // the line under the field when the state it is in can't send
    mainEnabled: mainRefusal === null,
    // decision 9: a screenshot the route can never carry is not drawn, and the ones past its room are said before the send
    showScreenshot: state.screenshot !== null && room?.max !== 0,
    leftOut: room !== null && state.screenshots > room.max ? { count: state.screenshots - room.max, reason: room.reason } : null,
    ready: route.ready,
    // Decision Log 52 (2): never more comments than a message carries, which both destinations would refuse
    canSend: (to: CommentDestination) => state.withText > 0 && state.withText <= MESSAGE_COMMENTS_MAX && !busy && refusalOf(to) === null,
    // P2-A: a send that starts its session (a side thread, or main on a session that is not running) reads Starting…;
    // UX wave U5a: a pass of several comments with text reads how many go
    submitLabel: busy ? (state.flightTo === 'thread' || starts ? COPY.starting : COPY.sending) : state.withText > 1 ? COPY.sendMany(state.withText) : COPY.send,
  };
}
// UX wave U5a end

// Enter sends (P4-B1 C3: ⌘Enter, Ctrl+Enter too, a Shift held with it or not), Shift+Enter breaks a line, an input
// method's composition keeps its Enter.
const sendsOnEnter = (send: () => void) => (event: KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key !== 'Enter' || (event.shiftKey && !event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing) return;
  event.preventDefault();
  send();
};

/** The sheet's form: its own state, one comment, sent as it stands. */
export function useCommentForm({ anchor, parent, gone, onSent, destination: initial }: CommentFormInput) { // P3-F1: initial
  const [text, setText] = useState('');
  const [wantsMain, setWantsMain] = useState(initial === 'main'); // P3-F1: initial; UX wave U5a: the checkbox as the person set it
  const [screenshot, setScreenshot] = useState<AnchorScreenshot | null>(anchor.screenshot ?? null);
  const [phase, setPhase] = useState<CommentFormPhase>({ kind: 'editing' });
  const route = useRoute(parent);
  const sending = phase.kind === 'sending';
  const form = formOf(route, { wantsMain, screenshot, screenshots: screenshot === null ? 0 : 1, flightTo: phase.kind === 'sending' ? phase.destination : null, withText: text.trim() === '' ? 0 : 1, boxHeld: sending });

  const send = async (to: CommentDestination) => {
    if (!form.canSend(to)) return;
    setWantsMain(to === 'main');
    setPhase({ kind: 'sending', destination: to });
    const sent = text.trim();
    const result = await sendComments(parent, [{ anchor, text: sent, screenshot }], to === 'main'); // UX wave U5a
    if (result.ok && result.to === 'main') tellWhere(undefined, undefined, parent, result); // UX wave U5a: whether or not the sheet is still there
    if (gone()) {
      if (!result.ok) toast({ level: 'warning', text: COPY.refusedAfterClose(result.error), actions: [], dismissible: true });
      return;
    }
    if (result.ok) onSent({ ...(result.to === 'thread' && { child: result.child }), text: sent });
    else setPhase({ kind: 'refused', destination: to, error: result.error });
  };

  return {
    ...form,
    text,
    setText: (value: string) => setText(value),
    setToMain: (toMain: boolean) => setWantsMain(toMain),
    screenshot,
    removeScreenshot: () => setScreenshot(null),
    phase,
    sending,
    send,
    onKeyDown: sendsOnEnter(() => void send(form.destination)),
  };
}

export type CommentForm = ReturnType<typeof useCommentForm>;

/**
 * UX wave U5a (§C, §D): the card's form over one comment of a pass. The text, the screenshot and the checkbox are the
 * store's; Send sends the pass (every comment with text), and is off while any comment of it is in flight. The phase is
 * the comment's own: sending while it is in flight, refused with the reason of its last flight.
 */
export function usePassForm(passKey: string, commentId: string): CommentForm & { comment: PassComment | null; others: PassComment[] } {
  const pass = useCommentCard((s) => s.passes.get(passKey) ?? null);
  const comment = pass?.comments.find((each) => each.id === commentId) ?? null;
  const parent = pass?.appSessionId ?? ('' as AppSessionId);
  const route = useRoute(parent);
  const flying = pass?.comments.find((each) => each.flight !== null)?.flight ?? null;
  const flightTo: CommentDestination | null = flying === null ? null : flightToMain(flying) ? 'main' : 'thread';
  const phase: CommentFormPhase =
    comment?.flight != null ? { kind: 'sending', destination: flightTo ?? 'thread' } : comment?.refused && flying === null ? { kind: 'refused', destination: comment.refused.toMain ? 'main' : 'thread', error: comment.refused.error } : { kind: 'editing' };
  const comments = pass?.comments ?? [];
  const form = formOf(route, {
    wantsMain: pass?.toMain ?? false,
    screenshot: comment?.screenshot ?? null,
    screenshots: comments.filter((each) => each.screenshot !== null).length,
    flightTo,
    withText: comments.filter((each) => each.text.trim() !== '').length,
    boxHeld: false, // §D: the next send's destination, never the flight's
  });
  const send = async (to: CommentDestination) => {
    if (!form.canSend(to)) return;
    setPassToMain(passKey, to === 'main');
    await sendPass(passKey);
  };
  return {
    ...form,
    text: comment?.text ?? '',
    setText: (value: string) => setCommentText(passKey, commentId, value),
    setToMain: (toMain: boolean) => setPassToMain(passKey, toMain),
    screenshot: comment?.screenshot ?? null,
    removeScreenshot: () => removeScreenshot(passKey, commentId),
    phase,
    sending: comment?.flight != null, // this comment's field, Remove and screenshot are off while it is in flight
    send,
    onKeyDown: sendsOnEnter(() => void send(form.destination)),
    comment,
    others: comments.filter((each) => each.id !== commentId),
  };
}
