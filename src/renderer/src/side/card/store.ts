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
import type { CardRect, CommentContext } from '../../tools/code/anchor/anchor';

// What the card is about, as a host recognises it: (P2-E2) a browser page by its URL, or (P3-L M5b, Decision Log 10) an
// HTML artifact's page on the store's scheme at a revision, whose host is the artifact viewer's. P3-L M6b: E2's
// `deliverable` target is gone; an anchor stored before the cutover names its page `maws-deliverable://<id>/<app>/<n>`,
// whose record id is the artifact's and whose n is X12's version number, kept at import as the imported version's label
// (fix wave 1, Decision Log 39c), never revision n and never a place a thinned history could move. Its target carries n
// as `version`, with `revision` null: only a read of the artifact's versions names the revision (`placeOfNumber`).
export type CardTarget =
  | { kind: 'browser'; pageUrl: string }
  | { kind: 'artifact-page'; artifactId: string; revision: ArtifactUrlRevision | null; version?: number };
export type CardPhase = { kind: 'composing' } | { kind: 'thread'; child: AppSessionId; echo: string | null };
export type CardHostKind = 'browser' | 'artifact-page';
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
export const useCommentCard = create<{ open: OpenCard | null; shownThread: ShownThread | null }>()(() => ({ open: null, shownThread: null }));

let serials = 0;

export function targetOf(anchor: Anchor): CardTarget | null {
  if (anchor.pageUrl === undefined) return null;
  if (anchor.kind === 'browser-element') return { kind: 'browser', pageUrl: anchor.pageUrl }; // P2-E2
  if (anchor.kind !== 'artifact-element') return null;
  const page = parseArtifactUrl(anchor.pageUrl); // P3-L (M5b)
  if (page) return { kind: 'artifact-page', artifactId: page.artifactId, revision: page.revision };
  const legacy = parseDeliverableUrl(anchor.pageUrl); // P3-L (M6b)
  return legacy && { kind: 'artifact-page', artifactId: legacy.id, revision: null, version: legacy.version };
}

// The seam's opener for a card placement (`register.ts`), and the re-dock's (no `hostId`, a `claimMode`). Without a
// card placement the host is the target's kind.
export function openCard(anchor: Anchor, context: CommentContext & { phase?: CardPhase; claimMode?: CardHostMode }): void {
  const placement = context.placement?.kind === 'card' ? context.placement : null;
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
    phase: context.phase ?? { kind: 'composing' },
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
