// UX wave U5a (X-216; docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M4, Interfaces §B.4 and §G): a
// tab's page keeps the element its comment card is on in view only while the card is open, so it is told, through main
// (`browser.comment.card`), when the card opens and when it closes, rather than guessing from its viewport's height.
//
// The opening is read from the card store, once for the window (`watchPageCard`, connected with the rest of the comment
// code): whenever the window's card shows a composing comment of a browser tab's pass, or moves to another, that tab's
// page is told the comment's css. The closing is the dock's `onClosed` (`tellPageCardClosed`), told once per loss of its
// card; a card moving to another comment is such a loss too, and is told a microtask after the store moved, so the close
// says nothing while the window's card still composes on that tab's page on a mounted host. A call that fails (the tab
// closed meanwhile) is ignored: a word that never reaches the page costs at most the pick's grace.
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { cardHostEntry, composingOf, useCommentCard } from '../../../side/card/store';

// The window's card as a browser page sees it: the tab whose pass it composes on, the card, and its comment's css.
function pageCard(): { tabId: string; serial: number; css: string; hosted: boolean } | null {
  const state = useCommentCard.getState();
  const composing = composingOf(state.open, state);
  const css = composing?.comment.anchor.css;
  if (state.open === null || composing?.pass.host !== 'browser' || css === undefined) return null;
  return { tabId: composing.pass.subject, serial: state.open.serial, css, hosted: state.open.hostId !== null && cardHostEntry(state.open.hostId) !== null };
}

const tell = (client: MawsBridge, tabId: string, open: { css: string } | null) => void client.invoke('browser.comment.card', { tabId, open });

/** Tells a tab's page the css of the comment its card opens on, each time the card opens or moves to another. */
export function watchPageCard(client: MawsBridge = ipc): () => void {
  let told: number | null = null; // the card last told, by its serial
  return useCommentCard.subscribe(() => {
    const card = pageCard();
    if (card !== null && card.serial !== told) tell(client, card.tabId, { css: card.css });
    told = card?.serial ?? null;
  });
}

/** The dock's `onClosed`: tells the tab's page its card closed, unless the window's card still composes on that page. */
export function tellPageCardClosed(tabId: string, client: MawsBridge = ipc): void {
  const card = pageCard();
  if (card?.tabId === tabId && card.hosted) return;
  tell(client, tabId, null);
}
