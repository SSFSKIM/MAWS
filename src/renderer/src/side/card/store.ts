// The comment card's store (P2-E1 document, D3; X21): at most one open card per window, the latest open winning. A card opened with a
// `hostId` is drawn by that host alone; one opened without (the re-dock) carries the host mode that may claim it and is
// claimed by the first mounted host that accepts it, in one store update, so two viewers never both draw it. A card
// still unclaimed CLAIM_DEADLINE_MS after it opened is closed: its record turned out gone, or the person went elsewhere
// before the viewer mounted, and a stale card must never pop up later in some other viewer of the record. Closing a
// card never touches its thread, which the Side pane lists.
//
// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M3; §C, §D, decisions 4, 5, 17 and 18): the
// *pass*, every unsent comment one surface holds for one receiving session, oldest first, keyed by `passKey(host,
// subject, session)`. A composing card edits one comment of one pass, and the comment's text lives here, never in the
// mounted card: a card that goes for any reason but the person's own discard leaves its comment in the pass (one with
// nothing typed goes with it), so a host that unmounts, a surface that hides and a second comment being opened keep what
// was typed. A host registers its kind, subject and `holds` while mounted, which is how the seam's opener finds the pass
// from a placement's host id. A send is a *flight*: from the moment it sets out it owns its comments (`flight` set),
// independently of the pass, which may end meanwhile (its subject closed); it settles through `landFlight`.
import { create } from 'zustand';
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import { MESSAGE_COMMENTS_MAX } from '@shared/anchor/message'; // Decision Log 52: the most a pass holds
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
// UX wave U5a: a composing card names the comment it edits and its pass; the checkbox is the pass's (`toMain`)
export type CardPhase = { kind: 'composing'; pass: string; comment: string } | { kind: 'thread'; child: AppSessionId; echo: string | null };
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
  limit?: true; // Decision Log 52: opened by a pick its pass had no room for (the card says the limit)
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
// person dismisses it or sends it again from the strip. Keyed by the pass that sent (M3), so every host of that pass's
// subject draws it. `thread`: the document thread the comment was on, whose margin entry draws the line (§C's table) for
// as long as the note lasts.
export type PlaceNote = { kind: 'sent'; text: string; at: number; thread?: string } | { kind: 'pending'; appSessionId: AppSessionId; key: DeliveryKey; title: string; thread?: string };
export const SENT_NOTE_MS = 4_000;

// UX wave U5a (§C): one unsent comment, and the pass that holds it
export interface PassComment {
  id: string; // stable for the comment's life
  anchor: Anchor; // without its screenshot
  text: string;
  screenshot: AnchorScreenshot | null;
  rect: CardRect | null; // the pick's rect, for an anchored card
  flight: number | null; // the send it is part of, else null
  refused: { toMain: boolean; error: string } | null;
}
export interface CommentPass {
  host: CardHostKind;
  subject: string;
  appSessionId: AppSessionId;
  comments: PassComment[]; // oldest first
  toMain: boolean; // the checkbox
}
export const passKey = (host: CardHostKind, subject: string, appSessionId: AppSessionId): string => `${host}\u0000${subject}\u0000${appSessionId}`;
const subjectPrefix = (host: CardHostKind, subject: string) => `${host}\u0000${subject}\u0000`;

interface CardState {
  open: OpenCard | null;
  shownThread: ShownThread | null;
  notes: ReadonlyMap<string, PlaceNote>; // the line a host draws in the card's place, by pass key
  passes: ReadonlyMap<string, CommentPass>;
}
export const useCommentCard = create<CardState>()(() => ({ open: null, shownThread: null, notes: new Map(), passes: new Map() }));

let serials = 0;
let comments = 0;

// ---- the hosts ---------------------------------------------------------------------------------------------------------

// UX wave U5a (§C, §F): what a mounted host is to the store: the pass's subject it shows and how many unsent comments it
// keeps, and its frame's callbacks for a comment of its pass (a send setting out, the person's discard), which a send or
// a discard asks whatever host of the pass is mounted then.
export interface CardHostEntry {
  kind: CardHostKind;
  subject: string;
  holds: 'one' | 'many';
  sending?(comment: PassComment, sending: { text: string; destination: 'thread' | 'main' }): (went: boolean) => void;
  discarded?(comment: PassComment): void;
}
const hosts = new Map<string, CardHostEntry>();

/** Registers a mounted host (its own entry: a later registration under the same id replaces it, and only its own disposer removes it). */
export function registerCardHost(hostId: string, entry: CardHostEntry): () => void {
  hosts.set(hostId, entry);
  return () => {
    if (hosts.get(hostId) === entry) hosts.delete(hostId);
  };
}
export const cardHostEntry = (hostId: string): CardHostEntry | null => hosts.get(hostId) ?? null;

// The mounted hosts of a pass's subject, the latest registered last.
function hostsOf(pass: Pick<CommentPass, 'host' | 'subject'>): [string, CardHostEntry][] {
  return [...hosts].filter(([, entry]) => entry.kind === pass.host && entry.subject === pass.subject);
}
// A mounted host of the pass's subject: the one the open card is on when it is one, else the latest; null when none.
function passHostOf(pass: Pick<CommentPass, 'host' | 'subject'>): string | null {
  const mounted = hostsOf(pass);
  const open = useCommentCard.getState().open;
  if (open?.hostId && mounted.some(([id]) => id === open.hostId)) return open.hostId;
  return mounted.at(-1)?.[0] ?? null;
}
export function passHost(key: string): string | null {
  const pass = useCommentCard.getState().passes.get(key);
  return pass ? passHostOf(pass) : null;
}
// The person dropped a comment: the host of its pass is told (a document withdraws the comment's thread).
function tellDiscarded(pass: CommentPass, dropped: readonly PassComment[]): void {
  const id = passHostOf(pass);
  const entry = id === null ? undefined : hosts.get(id);
  for (const comment of dropped) entry?.discarded?.(comment);
}

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

// The seam's opener for a card placement (`register.ts`), and the re-dock's (no `hostId`, a `claimMode`, a thread
// phase). Without a card placement the host is the target's kind. P4-B1 (M4): a document's margin placement is its
// artifact card host's. UX wave U5a (§C): a composing open adds a comment to the pass of the placement's host (made with
// the checkbox at the surface's default) and opens the card on it; where the host keeps one unsent comment and its pass
// holds one with text, the card opens on that one instead and nothing is added. The card it replaces leaves its comment
// in its pass. Decision Log 52 (2): a pass holds at most the comments one message carries (MESSAGE_COMMENTS_MAX, which
// both destinations take at most), every comment counted, with text or without; a pick on a full pass adds nothing and
// opens the card on its newest comment, marked `limit`, so a refused send never restores a pass no Retry could send.
export function openCard(anchor: Anchor, context: CommentContext & { phase?: CardPhase; claimMode?: CardHostMode }): void {
  const given = context.placement;
  const placement: Extract<CommentPlacement, { kind: 'card' }> | null = given?.kind === 'card' ? given : given?.kind === 'margin' ? { kind: 'card', host: 'artifact', hostId: given.hostId } /* P4-B1 */ : null;
  const target = targetOf(anchor);
  const host = placement?.host ?? target?.kind ?? 'artifact-page';
  const hostId = placement?.hostId ?? null;
  if (context.phase?.kind === 'thread') {
    const serial = ++serials;
    show({ serial, parent: context.appSessionId, anchor, host, hostId, claimMode: context.claimMode ?? null, openedAt: Date.now(), target, rect: placement?.rect ?? null, phase: context.phase });
    claimBy(serial, hostId);
    return;
  }
  const entry = hostId === null ? undefined : hosts.get(hostId);
  const subject = entry?.subject ?? subjectOf(target) ?? hostId ?? '';
  const key = passKey(host, subject, context.appSessionId);
  const left = leaving(useCommentCard.getState());
  const passes = new Map(left.passes);
  let pass = passes.get(key) ?? { host, subject, appSessionId: context.appSessionId, comments: [], toMain: context.destination === 'main' };
  if (entry?.holds === 'one') {
    const kept = pass.comments.find((comment) => comment.flight === null);
    if (kept && kept.text.trim() !== '') {
      useCommentCard.setState({ passes, open: cardOn(key, pass, kept, hostId) });
      left.told();
      return;
    }
    if (kept) {
      // nothing typed in it: the new passage takes its place, as a replaced empty card always did
      left.dropped.push([pass, kept]);
      pass = { ...pass, comments: pass.comments.filter((comment) => comment !== kept) };
    }
  }
  if (pass.comments.length >= MESSAGE_COMMENTS_MAX) {
    const newest = { ...cardOn(key, pass, pass.comments.at(-1)!, hostId), claimMode: context.claimMode ?? null, limit: true as const };
    useCommentCard.setState({ passes, open: newest });
    left.told();
    claimBy(newest.serial, hostId);
    return;
  }
  const comment: PassComment = { id: String(++comments), anchor: withoutScreenshot(anchor), text: '', screenshot: anchor.screenshot ?? null, rect: placement?.rect ?? null, flight: null, refused: null };
  const next = { ...pass, comments: [...pass.comments, comment] };
  passes.set(key, next);
  const card = { ...cardOn(key, next, comment, hostId), claimMode: context.claimMode ?? null };
  useCommentCard.setState({ passes, open: card });
  left.told();
  claimBy(card.serial, hostId);
}

// An unhosted card still unclaimed after CLAIM_DEADLINE_MS closes.
function claimBy(serial: number, hostId: string | null): void {
  if (hostId !== null) return;
  setTimeout(() => {
    if (useCommentCard.getState().open?.hostId === null) closeCard(serial);
  }, CLAIM_DEADLINE_MS);
}

const show = (card: OpenCard) => {
  const left = leaving(useCommentCard.getState());
  useCommentCard.setState({ passes: left.passes, open: card });
  left.told();
};

function withoutScreenshot(anchor: Anchor): Anchor {
  if (anchor.screenshot === undefined) return anchor;
  const copy = { ...anchor };
  delete copy.screenshot;
  return copy;
}

// A pass's subject when no mounted host names it (an opener ahead of its host): the artifact a target names.
const subjectOf = (target: CardTarget | null): string | null => (target?.kind === 'artifact' || target?.kind === 'artifact-page' ? target.artifactId : null);

function cardOn(key: string, pass: CommentPass, comment: PassComment, hostId: string | null): OpenCard {
  return { serial: ++serials, parent: pass.appSessionId, anchor: comment.anchor, host: pass.host, hostId, claimMode: null, openedAt: Date.now(), target: targetOf(comment.anchor), rect: comment.rect, phase: { kind: 'composing', pass: key, comment: comment.id } };
}

// The open card going: its comment stays in its pass unless nothing is typed in it (and it is not in flight), when it
// goes with the card. The passes as they will be, the dropped comments, and the call that tells their hosts once the
// store holds the result.
function leaving(state: CardState): { passes: Map<string, CommentPass>; dropped: [CommentPass, PassComment][]; told(): void } {
  const passes = new Map(state.passes);
  const dropped: [CommentPass, PassComment][] = [];
  const phase = state.open?.phase;
  if (phase?.kind === 'composing') {
    const pass = passes.get(phase.pass);
    const comment = pass?.comments.find((each) => each.id === phase.comment);
    if (pass && comment && comment.flight === null && comment.text.trim() === '') {
      const rest = pass.comments.filter((each) => each !== comment);
      if (rest.length === 0) passes.delete(phase.pass);
      else passes.set(phase.pass, { ...pass, comments: rest });
      dropped.push([pass, comment]);
    }
  }
  return { passes, dropped, told: () => dropped.forEach(([pass, comment]) => tellDiscarded(pass, [comment])) };
}

/** The pass and the comment a composing card edits, or null. */
export function composingOf(card: OpenCard | null, state: Pick<CardState, 'passes'> = useCommentCard.getState()): { key: string; pass: CommentPass; comment: PassComment } | null {
  if (card?.phase.kind !== 'composing') return null;
  const { pass: key, comment: id } = card.phase;
  const pass = state.passes.get(key);
  const comment = pass?.comments.find((each) => each.id === id);
  return pass && comment ? { key, pass, comment } : null;
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

// The open card, or only that card when a serial is given. UX wave U5a: for a composing card it is `leaveCard`: its
// comment stays in its pass.
export function closeCard(serial?: number): void {
  const { open } = useCommentCard.getState();
  if (open === null || (serial !== undefined && open.serial !== serial)) return;
  const left = leaving(useCommentCard.getState());
  useCommentCard.setState({ open: null, passes: left.passes });
  left.told();
}

/** UX wave U5a: the card goes, its comment staying in its pass (unless nothing is typed in it). */
export const leaveCard = (serial?: number): void => closeCard(serial);

// ---- the pass ----------------------------------------------------------------------------------------------------------

// One comment of a pass changed (nothing when either is gone).
function patchComment(key: string, id: string, patch: (comment: PassComment) => PassComment | null): void {
  const pass = useCommentCard.getState().passes.get(key);
  const comment = pass?.comments.find((each) => each.id === id);
  if (!pass || !comment) return;
  const next = patch(comment);
  if (next === null || next === comment) return;
  useCommentCard.setState((s) => ({ passes: new Map(s.passes).set(key, { ...pass, comments: pass.comments.map((each) => (each === comment ? next : each)) }) }));
}

/** The person's words in a comment not in flight. */
export const setCommentText = (pass: string, comment: string, text: string): void => patchComment(pass, comment, (c) => (c.flight !== null || c.text === text ? null : { ...c, text }));
export function setPassToMain(pass: string, toMain: boolean): void {
  const held = useCommentCard.getState().passes.get(pass);
  if (held && held.toMain !== toMain) useCommentCard.setState((s) => ({ passes: new Map(s.passes).set(pass, { ...held, toMain }) }));
}
export const removeScreenshot = (pass: string, comment: string): void => patchComment(pass, comment, (c) => (c.flight !== null || c.screenshot === null ? null : { ...c, screenshot: null }));

/** The person dropped a comment (Close, Remove, a blur with an empty field): gone from its pass, its card closed; never one in flight. */
export function discardComment(pass: string, comment: string): void {
  const state = useCommentCard.getState();
  const held = state.passes.get(pass);
  const dropped = held?.comments.find((each) => each.id === comment);
  if (!held || !dropped || dropped.flight !== null) return;
  const passes = new Map(state.passes);
  const rest = held.comments.filter((each) => each !== dropped);
  if (rest.length === 0) passes.delete(pass);
  else passes.set(pass, { ...held, comments: rest });
  const onIt = state.open?.phase.kind === 'composing' && state.open.phase.pass === pass && state.open.phase.comment === comment;
  tellDiscarded(held, [dropped]); // told while its host is known: before the card that names it goes
  useCommentCard.setState({ passes, ...(onIt && { open: null }) });
}

/** The open card moves to a comment of a pass, on `hostId` (else the host of the pass that is mounted); nothing without one. */
export function editComment(pass: string, comment: string, hostId?: string): void {
  const state = useCommentCard.getState();
  const held = state.passes.get(pass);
  const target = held?.comments.find((each) => each.id === comment);
  const on = hostId ?? (held ? passHostOf(held) : null);
  if (!held || !target || on === null) return;
  const open = state.open;
  if (open?.phase.kind === 'composing' && open.phase.pass === pass && open.phase.comment === comment && open.hostId === on) return;
  const left = leaving(state);
  const next = left.passes.get(pass);
  if (!next?.comments.includes(target)) return;
  useCommentCard.setState({ passes: left.passes, open: cardOn(pass, next, target, on) });
  left.told();
}

// The passes `ends` names end: their comments not in flight go at once (a document withdraws their threads, reading
// the passes), and the card on any of them closes; a flight keeps its own comments and settles as it would have.
function endPasses(ends: (pass: CommentPass) => boolean): void {
  const state = useCommentCard.getState();
  const gone = [...state.passes].filter(([, pass]) => ends(pass)).map(([key]) => key);
  if (gone.length === 0) return;
  const passes = new Map(state.passes);
  for (const key of gone) passes.delete(key);
  const onGone = state.open?.phase.kind === 'composing' && gone.includes(state.open.phase.pass);
  useCommentCard.setState({ passes, ...(onGone && { open: null }) });
}
/** The subject closed (the browser tab, the artifact's last view): its passes end. */
export const dropSubject = (host: CardHostKind, subject: string): void => endPasses((pass) => pass.host === host && pass.subject === subject);
/** The session left the window: its passes end. */
export const dropSession = (appSessionId: AppSessionId): void => endPasses((pass) => pass.appSessionId === appSessionId);

/** What a host draws when no card of its own is open: the unsent comments of its subject's passes, and the newest. */
export function unsentOf(passes: ReadonlyMap<string, CommentPass>, host: CardHostKind, subject: string): { count: number; newest: { pass: string; comment: string } } | null {
  let count = 0;
  let newest: { pass: string; comment: string; at: number } | null = null;
  for (const [key, pass] of passes) {
    if (pass.host !== host || pass.subject !== subject) continue;
    count += pass.comments.length;
    for (const comment of pass.comments) if (newest === null || Number(comment.id) > newest.at) newest = { pass: key, comment: comment.id, at: Number(comment.id) };
  }
  return newest === null ? null : { count, newest: { pass: newest.pass, comment: newest.comment } };
}

// The notes with `place`'s set as the newest: a Map keeps a key's first position on a re-set, so it is moved to the end.
function latestLast(notes: ReadonlyMap<string, PlaceNote>, place: string, note: PlaceNote): Map<string, PlaceNote> {
  const next = new Map(notes);
  next.delete(place);
  return next.set(place, note);
}

/** The line a host of `(host, subject)` draws in its place: the newest set (`latestLast`); null when none. */
export function placeNoteOf(notes: ReadonlyMap<string, PlaceNote>, host: CardHostKind, subject: string): PlaceNote | null {
  const prefix = subjectPrefix(host, subject);
  let found: PlaceNote | null = null;
  for (const [key, note] of notes) if (key.startsWith(prefix)) found = note; // the latest set is last (`latestLast`)
  return found;
}

// ---- the flight (§D) ---------------------------------------------------------------------------------------------------

export interface Flight {
  id: number;
  pass: string;
  appSessionId: AppSessionId;
  toMain: boolean;
  comments: PassComment[]; // what it carries, oldest first, as they set out
}
let flights = 0;
const flightsToMain = new Map<number, boolean>();
/** Whether a flight on its way goes to the main conversation (its button's words). */
export const flightToMain = (id: number): boolean => flightsToMain.get(id) ?? false;

/**
 * §D's first row: a pass with no comment in flight and at least one with text sets out with every comment that has text,
 * to the checkbox's destination as it is now; its comments with none are discarded. Null when it cannot.
 */
export function launchFlight(key: string): Flight | null {
  const state = useCommentCard.getState();
  const pass = state.passes.get(key);
  if (!pass || pass.comments.some((comment) => comment.flight !== null)) return null;
  const carried = pass.comments.filter((comment) => comment.text.trim() !== '');
  if (carried.length === 0) return null;
  const id = ++flights;
  flightsToMain.set(id, pass.toMain);
  const empty = pass.comments.filter((comment) => comment.text.trim() === '');
  const flying = carried.map((comment) => ({ ...comment, flight: id, refused: null }));
  const passes = new Map(state.passes).set(key, { ...pass, comments: flying });
  const onEmpty = state.open?.phase.kind === 'composing' && state.open.phase.pass === key && empty.some((comment) => state.open?.phase.kind === 'composing' && comment.id === state.open.phase.comment);
  if (empty.length > 0) tellDiscarded(pass, empty);
  useCommentCard.setState({ passes, ...(onEmpty && { open: null }) });
  return { id, pass: key, appSessionId: pass.appSessionId, toMain: pass.toMain, comments: flying };
}

/** The host callbacks of a flight's comments as it sets out (a document's settlement), each told once whether it went. */
export function flightSettlements(flight: Flight): ((went: boolean) => void)[] {
  const pass = useCommentCard.getState().passes.get(flight.pass);
  const id = pass ? passHostOf(pass) : null;
  const entry = id === null ? undefined : hosts.get(id);
  const destination = flight.toMain ? 'main' : 'thread';
  return flight.comments.map((comment) => entry?.sending?.(comment, { text: comment.text.trim(), destination }) ?? (() => {}));
}

/** The flight's comments still in its pass (none once the pass ended), and the open card when it is on one of them. */
export function flightState(flight: Flight): { alive: boolean; card: OpenCard | null } {
  const { passes, open } = useCommentCard.getState();
  const ids = new Set(flight.comments.map((comment) => comment.id));
  const alive = passes.get(flight.pass)?.comments.some((comment) => ids.has(comment.id) && comment.flight === flight.id) ?? false;
  const card = open?.phase.kind === 'composing' && open.phase.pass === flight.pass && ids.has(open.phase.comment) ? open : null;
  return { alive, card };
}

/** The flight went: its comments leave their pass (a pass left empty ends); the card on one of them closes unless `keepCard`. */
export function flightWent(flight: Flight, keepCard = false): void {
  flightsToMain.delete(flight.id);
  const state = useCommentCard.getState();
  const pass = state.passes.get(flight.pass);
  const { card } = flightState(flight);
  const passes = new Map(state.passes);
  if (pass) {
    const rest = pass.comments.filter((comment) => comment.flight !== flight.id);
    if (rest.length === 0) passes.delete(flight.pass);
    else passes.set(flight.pass, { ...pass, comments: rest });
  }
  useCommentCard.setState({ passes, ...(card && !keepCard && { open: null }) });
}

/** The flight was refused: its comments still in the pass stand again, each with the reason. The newest of them, or null. */
export function flightRefused(flight: Flight, error: string): PassComment | null {
  flightsToMain.delete(flight.id);
  const pass = useCommentCard.getState().passes.get(flight.pass);
  if (!pass) return null;
  const refused = { toMain: flight.toMain, error };
  const comments = pass.comments.map((comment) => (comment.flight === flight.id ? { ...comment, flight: null, refused } : comment));
  useCommentCard.setState((s) => ({ passes: new Map(s.passes).set(flight.pass, { ...pass, comments }) }));
  return comments.filter((comment) => comment.refused === refused).at(-1) ?? null;
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
  useCommentCard.setState((s) => ({ notes: latestLast(s.notes, place, note) }));
  if (note.kind === 'sent') expireSoon(place, note);
  else {
    followPending();
    settlePending(useLaneA.getState());
  }
}

/** The thread whose margin entry draws the line of `(host, subject)`'s place, while the line lasts; null when none. */
export const noteThreadOf = (host: CardHostKind, subject: string): string | null => placeNoteOf(useCommentCard.getState().notes, host, subject)?.thread ?? null;

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
      next.delete(place); // the receipt is the place's newest line
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

/** Every place's line and every pass gone, and nothing followed (a test's reset). */
export function resetPlaceNotes(): void {
  offPending?.();
  offPending = null;
  handOffToasts.clear();
  flightsToMain.clear();
  useCommentCard.setState({ notes: new Map(), passes: new Map() });
}
