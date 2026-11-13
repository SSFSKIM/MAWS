// The comment card's store (P2-E1 document, D3; X21): at most one open card per window, the latest open winning, as the
// sheet's latest anchor wins (a replaced composing card loses its draft, as the sheet's does). A card opened with a
// `hostId` is drawn by that host alone; one opened without (the re-dock) carries the host mode that may claim it and is
// claimed by the first mounted host that accepts it, in one store update, so two viewers never both draw it. A card
// still unclaimed CLAIM_DEADLINE_MS after it opened is closed: its record turned out gone, or the person went elsewhere
// before the viewer mounted, and a stale card must never pop up later in some other viewer of the record. Closing a
// card never touches its thread, which the Side pane lists.
import { create } from 'zustand';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { parseDeliverableUrl } from '@shared/maws/deliverable'; // P3-L (M6b): a legacy anchor's page URL
import { parseArtifactUrl, type ArtifactUrlRevision } from '@shared/artifacts/scheme'; // P3-L (M5b)
import type { CardRect, CommentContext, CommentPlacement /* P4-B1 */ } from '../../tools/code/anchor/anchor';
import type { DeliveryKey } from '@shared/ipc/schema/lane-a';
import { sameKey, useLaneA, type LaneAStore } from '../../stores/lane-a'; // UX wave U5a: a pending line follows its send
import { useLayout } from '../../stores/layout';
import { toast, useNotices } from '../../stores/notices';
import { pendingWords, SIDE_COPY } from '../copy';

// What the card is about, as a host recognises it: (P2-E2) a browser page by its URL, or (P3-L M5b, Decision Log 10) an
// HTML artifact's page on the store's scheme at a revision, whose host is the artifact viewer's. P3-L M6b: E2's
// `deliverable` target is gone; an anchor stored before the cutover names its page `maws-deliverable://<id>/<app>/<n>`,
// whose record id is the artifact's and whose n is X12's version number, kept at import as the imported version's label
// (fix wave 1, Decision Log 39c), never revision n and never a place a thinned history could move. Its target carries n
// as `version`, with `revision` null: only a read of the artifact's versions names the revision (`placeOfNumber`).
export type CardTarget =
  | { kind: 'browser'; pageUrl: string }
  | { kind: 'artifact-page'; artifactId: string; revision: ArtifactUrlRevision | null; version?: number }
  | { kind: 'artifact'; artifactId: string; threadId: string }; // P3-B (docs/doperpowers/plans/2026-10-12-p3-b-documents.md D9): a comment thread of a document artifact
export type CardPhase = { kind: 'composing'; destination?: 'thread' | 'main' /* P3-F1: CommentContext's */ } | { kind: 'thread'; child: AppSessionId; echo: string | null };
export type CardHostKind = 'browser' | 'artifact-page' | 'artifact' /* P3-B */;
export type CardHostMode = 'panel' | 'tab';

export interface OpenCard {
  serial: number; // a new open is a new card
  parent: AppSessionId; // the producer's appSessionId: the session the comment is about
  anchor: Anchor;
  host: CardHostKind;
  hostId: string | null; // null until claimed (re-dock)
  claimMode: CardHostMode | null; // for an unclaimed card: the host mode that may claim it
  openedAt: number; // for CLAIM_DEADLINE_MS
  target: CardTarget | null; // targetOf(anchor); null when the anchor names none
  rect: CardRect | null; // null: locate, else the corner
  phase: CardPhase;
}

export const CLAIM_DEADLINE_MS = 5_000;

// `shownThread`: the thread a thread-phase card draws while its host is on screen (P2-E1 document, D6), read by the
// unread rule (`session/visibility.ts`) and attention navigation (`attention/navigation.ts`) as the Side pane's shown
// child is; kept apart from the Side store's `shownChild`, which also means "hosted in the Side pane".
export interface ShownThread {
  parent: AppSessionId;
  child: AppSessionId;
}
// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, §C, decision 8): the line a host draws in
// its card's place after a send to the main conversation. `sent` is said only for a confirmed delivery and leaves after
// SENT_NOTE_MS; `pending` follows the pending send a terminal session's unconfirmed hand-off made under `key` and never
// leaves by itself: it becomes the sent line when that send's delivery entered, and leaves with the send when the
// person dismisses it or sends it again from the strip. Keyed by the place it belongs to: in M2 the host id of the card
// that sent (each card holds one comment); M3 keys it by the pass. `thread`: the document thread the card was on, whose
// margin entry draws the line (§C's table) for as long as the note lasts, whatever the note is keyed by.
export type PlaceNote = { kind: 'sent'; text: string; at: number; thread?: string } | { kind: 'pending'; appSessionId: AppSessionId; key: DeliveryKey; title: string; thread?: string };
export const SENT_NOTE_MS = 4_000;

export const useCommentCard = create<{ open: OpenCard | null; shownThread: ShownThread | null; notes: ReadonlyMap<string, PlaceNote> }>()(() => ({ open: null, shownThread: null, notes: new Map() }));

let serials = 0;

export function targetOf(anchor: Anchor): CardTarget | null {
  // P3-B: a document comment names its artifact and thread, no page
  if (anchor.kind === 'artifact-comment') return anchor.artifactId !== undefined && anchor.threadId !== undefined ? { kind: 'artifact', artifactId: anchor.artifactId, threadId: anchor.threadId } : null;
  if (anchor.pageUrl === undefined) return null;
  if (anchor.kind === 'browser-element') return { kind: 'browser', pageUrl: anchor.pageUrl }; // P2-E2
  if (anchor.kind !== 'artifact-element') return null;
  const page = parseArtifactUrl(anchor.pageUrl); // P3-L (M5b)
  if (page) return { kind: 'artifact-page', artifactId: page.artifactId, revision: page.revision };
  const legacy = parseDeliverableUrl(anchor.pageUrl); // P3-L (M6b)
  return legacy && { kind: 'artifact-page', artifactId: legacy.id, revision: null, version: legacy.version };
}

// The seam's opener for a card placement (`register.ts`), and the re-dock's (no `hostId`, a `claimMode`). Without a
// card placement the host is the target's kind. P4-B1 (M4): a document's margin placement is its artifact card host's.
export function openCard(anchor: Anchor, context: CommentContext & { phase?: CardPhase; claimMode?: CardHostMode }): void {
  const given = context.placement;
  const placement: Extract<CommentPlacement, { kind: 'card' }> | null = given?.kind === 'card' ? given : given?.kind === 'margin' ? { kind: 'card', host: 'artifact', hostId: given.hostId } /* P4-B1 */ : null;
  const target = targetOf(anchor);
  const serial = ++serials;
  const card: OpenCard = {
    serial,
    parent: context.appSessionId,
    anchor,
    host: placement?.host ?? target?.kind ?? 'artifact-page',
    hostId: placement?.hostId ?? null,
    claimMode: context.claimMode ?? null,
    openedAt: Date.now(),
    target,
    rect: placement?.rect ?? null,
    phase: context.phase ?? { kind: 'composing', ...(context.destination && { destination: context.destination }) /* P3-F1 */ },
  };
  useCommentCard.setState({ open: card });
  if (card.hostId === null) {
    setTimeout(() => {
      if (useCommentCard.getState().open?.hostId === null) closeCard(serial);
    }, CLAIM_DEADLINE_MS);
  }
}

// The card was closed or replaced (a send answered after it went asks this).
export const cardGone = (serial: number): boolean => useCommentCard.getState().open?.serial !== serial;

// First claimer wins; a host's own claim again (StrictMode's effect replay) still answers true.
export function claimCard(serial: number, hostId: string): boolean {
  const { open } = useCommentCard.getState();
  if (open?.serial !== serial) return false;
  if (open.hostId !== null) return open.hostId === hostId;
  useCommentCard.setState({ open: { ...open, hostId } });
  return true;
}

// P4-B3 (its Decision Log 39): the card drawn by another host of the same record from now on (a move that activates
// another view of a document hands its card there before its own view closes).
export function handCardTo(serial: number, hostId: string): void {
  const { open } = useCommentCard.getState();
  if (open?.serial === serial && open.hostId !== hostId) useCommentCard.setState({ open: { ...open, hostId } });
}

// The open card, or only that card when a serial is given.
export function closeCard(serial?: number): void {
  const { open } = useCommentCard.getState();
  if (open === null || (serial !== undefined && open.serial !== serial)) return;
  useCommentCard.setState({ open: null });
}

// The card's Side thread answered: the card becomes that thread, the comment as typed echoed until the thread's own
// anchored prompt arrives. Nothing when the card was closed or replaced meanwhile.
export function enterThread(serial: number, child: AppSessionId, echo: string): void {
  const { open } = useCommentCard.getState();
  if (open?.serial !== serial) return;
  useCommentCard.setState({ open: { ...open, phase: { kind: 'thread', child, echo } } });
}

// Published by a thread-phase card while its host is on screen; withdrawn (only if it is still the one shown) when not.
export function showCardThread(parent: AppSessionId, child: AppSessionId): void {
  const shown = useCommentCard.getState().shownThread;
  if (shown?.parent !== parent || shown.child !== child) useCommentCard.setState({ shownThread: { parent, child } });
}
export function hideCardThread(child: AppSessionId): void {
  if (useCommentCard.getState().shownThread?.child === child) useCommentCard.setState({ shownThread: null });
}

// UX wave U5a: the place's line, replacing whatever it showed. A sent line leaves after SENT_NOTE_MS unless replaced
// meanwhile; a pending one is followed in the lane A store from now on, and read against it at once, since its words
// may have entered between the hand-off and this call.
export function notePlace(place: string, note: PlaceNote): void {
  useCommentCard.setState((s) => ({ notes: new Map(s.notes).set(place, note) }));
  if (note.kind === 'sent') expireSoon(place, note);
  else {
    followPending();
    settlePending(useLaneA.getState());
  }
}

/** The thread whose margin entry draws `place`'s line, while the line lasts; null when none. */
export const noteThreadOf = (place: string): string | null => useCommentCard.getState().notes.get(place)?.thread ?? null;

// Decision Log 27 (the architect's ruling): the sheet's hand-off, which has no place, is a keyed toast that follows its
// pending send as a place's pending line does, by the same follower: it stays while the send is held (pending or
// refused), its words following the send's state; it becomes "Sent to <title>" at the ordinary toast time once the
// delivery entered; it leaves with the strip's entry otherwise (dismissed, or sent again). `text` is the words posted,
// null before the first; a toast the person closed (or acted on: Show) is followed no further.
interface HandOffToast {
  appSessionId: AppSessionId;
  key: DeliveryKey;
  title: string;
  text: string | null;
}
const handOffToasts = new Map<string, HandOffToast>();

export function toastPending(appSessionId: AppSessionId, key: DeliveryKey, title: string): void {
  handOffToasts.set(`hand-off:${appSessionId}:${key.writer}:${key.seq}`, { appSessionId, key, title, text: null });
  followPending();
  settlePending(useLaneA.getState());
}

const sentNote = (text: string, thread: string | undefined): PlaceNote => ({ kind: 'sent', text, at: Date.now(), ...(thread !== undefined && { thread }) });

function expireSoon(place: string, note: PlaceNote): void {
  setTimeout(() => {
    const { notes } = useCommentCard.getState();
    if (notes.get(place) !== note) return;
    const next = new Map(notes);
    next.delete(place);
    useCommentCard.setState({ notes: next });
  }, SENT_NOTE_MS);
}

let offPending: (() => void) | null = null;
function followPending(): void {
  offPending ??= useLaneA.subscribe(settlePending);
}

const enteredIn = (lane: LaneAStore, appSessionId: AppSessionId, key: DeliveryKey): boolean => lane.states.get(appSessionId)?.deliveries.find((d) => sameKey(d.key, key))?.state === 'entered';

// Each pending line and hand-off toast against the strip's entries: one whose send is still held stays (a line's words
// follow the send's state where it is drawn, a toast's here); one whose send left becomes the sent line, or the sent
// toast, if its delivery entered, and leaves otherwise. The subscription ends with the last one followed.
function settlePending(lane: LaneAStore): void {
  const { notes } = useCommentCard.getState();
  let next: Map<string, PlaceNote> | null = null;
  const entered: [string, PlaceNote][] = [];
  let following = false;
  for (const [place, note] of notes) {
    if (note.kind !== 'pending') continue;
    if (lane.pendingSends.get(note.appSessionId)?.some((send) => sameKey(send.key, note.key))) {
      following = true;
      continue;
    }
    next ??= new Map(notes);
    if (enteredIn(lane, note.appSessionId, note.key)) {
      const sent = sentNote(SIDE_COPY.place.sent(note.title), note.thread);
      next.set(place, sent);
      entered.push([place, sent]);
    } else next.delete(place);
  }
  if (settleToasts(lane)) following = true;
  if (!following) {
    offPending?.();
    offPending = null;
  }
  if (next === null) return;
  useCommentCard.setState({ notes: next });
  for (const [place, sent] of entered) expireSoon(place, sent);
}

// The hand-off toasts' part of the follower; whether one is still followed.
function settleToasts(lane: LaneAStore): boolean {
  let following = false;
  for (const [id, followed] of handOffToasts) {
    const posted = followed.text !== null;
    if (posted && !useNotices.getState().notices.some((n) => n.id === id)) {
      handOffToasts.delete(id); // closed by the person, or acted on
      continue;
    }
    const held = lane.pendingSends.get(followed.appSessionId)?.find((send) => sameKey(send.key, followed.key));
    if (held) {
      following = true;
      const text = pendingWords(held, followed.title);
      if (text === followed.text) continue;
      followed.text = text;
      const { appSessionId } = followed;
      toast({ id, level: held.state === 'refused' ? 'warning' : 'info', text, actions: [{ label: SIDE_COPY.place.show, run: () => useLayout.getState().openSession(appSessionId) }], dismissible: true, durationMs: Infinity });
      continue;
    }
    handOffToasts.delete(id);
    if (!posted) continue; // entered before it was said: a plain delivery, which the sheet does not say
    if (enteredIn(lane, followed.appSessionId, followed.key)) toast({ id, level: 'info', text: SIDE_COPY.place.sent(followed.title), actions: [], dismissible: true });
    else useNotices.getState().dismiss(id);
  }
  return following;
}

/** Every place's line gone, and nothing followed (a test's reset). */
export function resetPlaceNotes(): void {
  offPending?.();
  offPending = null;
  handOffToasts.clear();
  useCommentCard.setState({ notes: new Map() });
}
