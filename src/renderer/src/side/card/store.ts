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
import { parseDeliverableUrl } from '@shared/maws/deliverable';
import type { CardRect, CommentContext } from '../../tools/code/anchor/anchor';

// What the card is about, as a host recognises it. P2-E2 adds { kind: 'browser'; … }.
export type CardTarget = { kind: 'deliverable'; appSessionId: AppSessionId; deliverableId: string; version: number };
export type CardPhase = { kind: 'composing' } | { kind: 'thread'; child: AppSessionId; echo: string | null };
export type CardHostKind = 'deliverable' | 'browser';
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

export const useCommentCard = create<{ open: OpenCard | null }>()(() => ({ open: null }));

let serials = 0;

export function targetOf(anchor: Anchor): CardTarget | null {
  if (anchor.kind !== 'artifact-element' || anchor.pageUrl === undefined) return null;
  const parsed = parseDeliverableUrl(anchor.pageUrl);
  return parsed && { kind: 'deliverable', appSessionId: parsed.appSessionId, deliverableId: parsed.id, version: parsed.version };
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
    host: placement?.host ?? target?.kind ?? 'deliverable',
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
