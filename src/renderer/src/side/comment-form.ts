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
// once it went, the host's place is told where it went (`place`, and the document thread its line is drawn in; the sheet,
// with none, says what is not a plain delivery as a toast).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { ARCHIVED, STARTS } from '../composer/submit/submit-state'; // P2-A
import { ipc } from '../ipc/client';
import { useIsRemoteLaneB } from '../lane-b/remote-session';
import { heldWords, screenshotRoom, useSessionControls } from '../session/controls/controls-for';
import { displayTitle, listedTitle } from '../sessions/title';
import { useAvailability } from '../sessions/availability'; // P2-A
import { useMachines } from '../stores/machines';
import { toast } from '../stores/notices';
import { machineName } from '../stores/org-projects';
import { useSessions, type SessionsState } from '../stores/sessions';
import { sendComments, type CommentDestination, type SendOutcome } from './actions';
import { notePlace, toastPending } from './card/store';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable'; // P5 O7 M8
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.composer;
const PLACE = SIDE_COPY.place;

export type CommentFormPhase =
  | { kind: 'editing' }
  | { kind: 'sending'; destination: CommentDestination }
  | { kind: 'refused'; destination: CommentDestination; error: string };

export interface CommentFormInput {
  anchor: Anchor;
  parent: AppSessionId;
  gone(): boolean; // the presentation was closed or replaced while the send was on its way
  onSent(sent: { child?: AppSessionId; text: string }): void; // a send that went (the side thread it opened, the text sent)
  // asked when a side thread's fork answers: whether to reveal it in the parent's Side pane (the sheet: always; the card:
  // only once it is gone, since it shows the thread itself)
  reveal?: () => boolean;
  // P3-B (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9): told as a send sets out; the call it returns is told
  // whether the send went, whether or not the presentation is still there (a document keeps the thread the comment names)
  onSending?: (sending: { text: string; destination: CommentDestination }) => (went: boolean) => void;
  destination?: CommentDestination; // P3-F1: the one the form starts on (CommentContext's), unchecked when absent
  text?: string; // P4-B1: the text the form starts with (a remounted card's kept draft), empty when absent
  /**
   * P4-B3 (its Decision Log 37): what the form's send belongs to beyond this mount (a card's serial). A presentation can
   * remount while its send is on its way (a document moved to another pane or surface keeps its card); the send is then
   * kept here, so a form mounting under the same key starts sending (disabled: no second send), and the answer reaches
   * the form mounted when it arrives. Without one, the send is the mount's own, as before.
   */
  sendKey?: string;
  place?: string; // UX wave U5a: the place whose host draws where a send to main went (the card's host); the sheet has none
}

// UX wave U5a: the receiving session's title as the card names it (§E: `displayTitle`), a listed row's for another
// machine's terminal session, which has no record.
export function receivingTitle(s: Pick<SessionsState, 'records' | 'listed'>, appSessionId: AppSessionId): string {
  const record = s.records.get(appSessionId);
  const listed = record ? undefined : s.listed.get(appSessionId);
  return listed ? listedTitle(listed) : displayTitle(record);
}

// Where a send to main went, told once it went whether or not the presentation is still there: the host's place shows
// the line (decision 8: a hand-off that is not confirmed follows its pending send), in the margin entry of the document
// thread the card was on, if any; the sheet, with no place, says what a place would beyond a plain delivery as a toast,
// a hand-off's following its pending send as the line would (Decision Log 27).
function tellWhere(place: string | undefined, thread: string | undefined, parent: AppSessionId, outcome: Extract<SendOutcome, { to: 'main' }>): void {
  const title = receivingTitle(useSessions.getState(), parent);
  const on = thread !== undefined ? { thread } : {};
  if (outcome.disposition === 'unconfirmed') {
    if (place !== undefined) notePlace(place, { kind: 'pending', appSessionId: parent, key: outcome.pending, title, ...on });
    else toastPending(parent, outcome.pending, title);
    return;
  }
  const text = outcome.disposition === 'steered' ? PLACE.steered(title) : outcome.disposition === 'queued' ? PLACE.queued(title) : PLACE.sent(title);
  if (place !== undefined) notePlace(place, { kind: 'sent', text, at: Date.now(), ...on });
  else if (outcome.disposition === 'queued') toast({ level: 'info', text, actions: [], dismissible: true });
}

// P4-B3: the sends on their way by `sendKey`, and their answers until a mounted form takes them.
type Answer = { ok: true; sent: { child?: AppSessionId; text: string } } | { ok: false; destination: CommentDestination; error: string };
interface Flight {
  destination: CommentDestination;
  answer: Answer | null;
}
const flights = new Map<string, Flight>();
const flightListeners = new Set<() => void>();
const changed = () => {
  for (const listener of flightListeners) listener();
};
const subscribeFlights = (listener: () => void) => {
  flightListeners.add(listener);
  return () => void flightListeners.delete(listener);
};
/** Whether a send under `key` is on its way (no answer yet). */
export const sendingUnder = (key: string): boolean => flights.get(key)?.answer === null;

export function useCommentForm({ anchor, parent, gone, onSent, reveal, onSending, destination: initial, text: initialText, sendKey /* P4-B3 */, place /* UX wave U5a */ }: CommentFormInput) { // P3-F1: initial; P4-B1: initialText
  const status = useSessions((s) => s.engine.get(parent) ?? null);
  const [text, setText] = useState(initialText ?? ''); // P4-B1: initialText
  const [wantsMain, setWantsMain] = useState(initial === 'main'); // P3-F1: initial; UX wave U5a: the checkbox as the person set it
  const [screenshot, setScreenshot] = useState<AnchorScreenshot | null>(anchor.screenshot ?? null);
  const [local, setPhase] = useState<CommentFormPhase>({ kind: 'editing' });
  // P4-B3: a send kept by key outlives this mount: while it is on its way the form is sending, and its answer is taken
  // by whichever form is mounted under the key when it arrives
  const flight = useSyncExternalStore(subscribeFlights, () => (sendKey === undefined ? undefined : flights.get(sendKey)));
  const phase: CommentFormPhase = flight && flight.answer === null ? { kind: 'sending', destination: flight.destination } : local;
  const sentRef = useRef(onSent);
  useLayoutEffect(() => {
    sentRef.current = onSent;
  });
  useEffect(() => {
    if (sendKey === undefined) return;
    // the answer, once, by the form mounted when it is there (one that came while none was mounted, at the next mount)
    const take = () => {
      const kept = flights.get(sendKey);
      if (!kept?.answer) return;
      flights.delete(sendKey);
      changed();
      const { answer } = kept;
      if (answer.ok) sentRef.current(answer.sent);
      else setPhase({ kind: 'refused', destination: answer.destination, error: answer.error });
    };
    const off = subscribeFlights(take);
    queueMicrotask(take);
    return off;
  }, [sendKey]);

  // UX wave U5a start (decisions 6, 7, 9): what each state of the checkbox can do now
  const controls = useSessionControls(parent);
  const remoteLaneB = useIsRemoteLaneB(parent);
  const availability = useAvailability(parent);
  const forkable = useSessions((s) => s.records.get(parent)?.engineSessionId !== null); // no record: the machine side says
  const threadRemote = useRemoteUnavailable(parent, 'side.thread.open'); // P5 O7 M8: not on another machine yet
  const machine = useMachines((s) => (isAddress(parent) ? machineName(s.machines, machineOf(parent), ipc.localMachine) : ''));
  const sendable = controls ? controls.capability('send') : { available: false as const, reason: heldWords(parent) };
  // archived refuses main too, whatever the port allows a ready process: the composer's own answer (decision 6)
  const mainRefusal = availability === 'archived' ? ARCHIVED : sendable.available ? null : sendable.reason;
  const threadRefusal = threadRemote !== null ? COPY.threadRemote(machine) : availability === 'archived' ? ARCHIVED : forkable ? null : COPY.noConversation;
  const refusalOf = (to: CommentDestination) => (to === 'main' ? mainRefusal : threadRefusal);
  // ticked and locked for another machine's session (no side thread there yet, whatever its port says meanwhile);
  // otherwise the person's choice, which cannot be moved into a state that can't send
  const toMain = threadRemote !== null || wantsMain;
  const destination: CommentDestination = toMain ? 'main' : 'thread';
  const otherRefusal = refusalOf(toMain ? 'thread' : 'main');
  const ready = status?.process === 'ready';
  const turn = controls?.turn() ?? null; // a bridged session's own turn; null where the status says it (lane B)
  const running = turn ? turn.running : ready && Boolean(status?.turn);
  const starts = turn === null && !remoteLaneB && !ready; // the send acquires it first (lane B on this Mac)
  const room = toMain ? screenshotRoom(parent, controls) : null;
  // UX wave U5a end
  const sending = phase.kind === 'sending';
  const canSend = (to: CommentDestination) => text.trim() !== '' && !sending && refusalOf(to) === null;

  const send = async (to: CommentDestination) => {
    if (!canSend(to)) return;
    setWantsMain(to === 'main');
    setPhase({ kind: 'sending', destination: to });
    const sent = text.trim();
    const settled = onSending?.({ text: sent, destination: to }); // P3-B
    // P4-B3: kept by key, the answer goes to the form mounted when it comes (never to this mount's state once it went)
    const kept = sendKey === undefined ? null : { destination: to, answer: null as Answer | null };
    if (kept && sendKey !== undefined) {
      flights.set(sendKey, kept);
      changed();
    }
    const answer = (value: Answer) => {
      if (!kept || sendKey === undefined || flights.get(sendKey) !== kept) return false;
      kept.answer = value;
      flights.set(sendKey, { ...kept }); // a new object: the forms' snapshots see the change
      changed();
      return true;
    };
    const result = await sendComments(parent, [{ anchor, text: sent, screenshot }], to === 'main', reveal ? { reveal } : {}); // UX wave U5a
    settled?.(result.ok); // P3-B
    if (result.ok && result.to === 'main') tellWhere(place, anchor.kind === 'artifact-comment' ? anchor.threadId : undefined, parent, result); // UX wave U5a: whether or not the form is still there
    if (gone()) {
      // P4-B3
      if (kept && sendKey !== undefined && flights.get(sendKey) === kept) {
        flights.delete(sendKey);
        changed();
      }
      if (!result.ok) toast({ level: 'warning', text: COPY.refusedAfterClose(result.error), actions: [], dismissible: true });
      return;
    }
    const sentAs = { ...(result.ok && result.to === 'thread' && { child: result.child }), text: sent };
    if (answer(result.ok ? { ok: true, sent: sentAs } : { ok: false, destination: to, error: result.error })) return; // P4-B3
    if (result.ok) onSent(sentAs);
    else setPhase({ kind: 'refused', destination: to, error: result.error });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // P4-B1 (C3): ⌘Enter (Ctrl+Enter) posts beside Enter, a Shift held with it or not
    if (event.key !== 'Enter' || (event.shiftKey && !event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(destination);
  };

  return {
    text,
    setText,
    destination,
    toMain,
    setToMain: setWantsMain,
    // UX wave U5a: the box is off while a send is on its way, and where the state it would move to can't send
    toMainFixed: sending || otherRefusal !== null,
    // its title: why a tick can't send, or why it can't be left, else what a tick does now (the composer's words)
    toMainTitle: (threadRemote !== null ? threadRefusal : null) ?? mainRefusal ?? (toMain ? threadRefusal : null) ?? (starts ? STARTS : running ? COPY.mainBusy : COPY.mainIdle),
    unsendable: refusalOf(destination), // the line under the field when the state it is in can't send
    mainEnabled: mainRefusal === null,
    screenshot,
    // decision 9: a screenshot the route can never carry is not drawn, and the ones past its room are said before the send
    showScreenshot: screenshot !== null && room?.max !== 0,
    leftOut: room !== null && screenshot !== null && room.max < 1 ? { count: 1, reason: room.reason } : null,
    removeScreenshot: () => setScreenshot(null),
    phase,
    ready,
    sending,
    canSend,
    send,
    onKeyDown,
    // P2-A: a send that starts its session (a side thread, or main on a session that is not running) reads Starting…
    submitLabel: sending ? (phase.destination === 'thread' || starts ? COPY.starting : COPY.sending) : COPY.send,
  };
}

export type CommentForm = ReturnType<typeof useCommentForm>;
