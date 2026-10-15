// A fold of the working record opens unfolded (the `transcript` slot): each finished turn it holds is opened once, as
// it is first seen finished. A turn the reader folds is left folded, then and after. MAWS's store forgets every
// disclosure when a key is reset (a reconnect, a hub restart), so after one the fold's turns are opened again — all but
// those the reader folded.
import type { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';

type Store = Pick<ReturnType<typeof createTranscriptStore>, 'getState' | 'subscribe'>;

export function unfoldFinishedTurns(store: Store, key: string): () => void {
  const opened = new Set<string>();
  const foldedByReader = new Set<string>();
  const unfold = () => {
    const entry = store.getState().entries[key];
    if (entry?.phase !== 'live') {
      opened.clear(); // a reset empties the key and its disclosure; what was opened is opened again once it is back
      return;
    }
    const { ui, turns } = entry.state;
    for (const id of ui.collapsedTurns) foldedByReader.add(id);
    for (const [id, turn] of turns) {
      if (opened.has(id) || foldedByReader.has(id) || turn.state !== 'closed') continue;
      opened.add(id);
      if (!ui.expandedTurns.has(id)) store.getState().toggleTurn(key, id);
    }
  };
  unfold();
  return store.subscribe(unfold);
}
