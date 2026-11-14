// UX wave U5a (X-216; docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M4, Interfaces §B.4 and §G): a
// tab's page keeps the element its comment card is on in view only while the card is open, so it is told, through main
// (`browser.comment.card`), when the card opens and when it closes, rather than guessing from its viewport's height.
//
// One owner tells both, from the card store, once for the window (`watchPageCard`, connected with the rest of the comment
// code): whenever the window's card shows a composing comment of a browser tab's pass, or moves to another, that tab's
// page is told the comment's css; and every opening it told is retired by its own close, sent on the store's transition
// the moment that card is no longer the window's open card (closed, sent, replaced, or replaced by another tab's card).
// A move to another comment of the same tab is told as the new opening only. The card turning into its side thread is the
// same card, still open in the strip, so the page keeps the element (the owner's ruling: in view while the strip is
// open). Nothing waits on a committed host's effect, so an opening and a close in one React batch, or a card replaced by
// another tab's before it was drawn, still leave each page told last that its card closed. A call that fails (the tab
// closed meanwhile) is ignored: a word that never reaches the page costs at most the pick's grace.
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { composingOf, useCommentCard } from '../../../side/card/store';

type CardState = ReturnType<typeof useCommentCard.getState>;

// The window's card as a browser page sees it: the tab whose pass it composes on, the card, and its comment's css.
function pageCard(state: CardState): { tabId: string; serial: number; css: string } | null {
  const composing = composingOf(state.open, state);
  const css = composing?.comment.anchor.css;
  if (state.open === null || composing?.pass.host !== 'browser' || css === undefined) return null;
  return { tabId: composing.pass.subject, serial: state.open.serial, css };
}

const tell = (client: MawsBridge, tabId: string, open: { css: string } | null) => void client.invoke('browser.comment.card', { tabId, open });

/** Tells a tab's page each opening of its card (the comment's css) and, for each opening told, its close. */
export function watchPageCard(client: MawsBridge = ipc): () => void {
  let told: { tabId: string; serial: number } | null = null; // the opening last told, not yet closed
  return useCommentCard.subscribe((state) => {
    const card = pageCard(state);
    if (told !== null && card?.tabId !== told.tabId && state.open?.serial !== told.serial) {
      tell(client, told.tabId, null);
      told = null;
    }
    if (card !== null && card.serial !== told?.serial) {
      tell(client, card.tabId, { css: card.css });
      told = { tabId: card.tabId, serial: card.serial };
    }
  });
}
