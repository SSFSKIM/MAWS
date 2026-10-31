// P2-C (2026-10-10; the P2-C document, M6): where an owner-channel item points. A question an agent left or a must-read
// (`async_input`, `essential_unread`) carries the anchor of its mark (the message uuid, the text block, the span); opening
// it opens the session in the focused pane, in the report view, and jumps to the assistant text the anchor names once
// the tab's transcript holds its history. Every other item opens its session as before (navigation.ts).
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { useLayout } from '../stores/layout';
import { useTranscriptStore } from '../stores/transcript';

export type ItemAnchor = NonNullable<AttentionItem['anchor']>;

// The item's anchor when it is one of the owner channel's two kinds, else null.
export const ownerAnchorOf = (item: AttentionItem): ItemAnchor | null =>
  (item.kind === 'async_input' || item.kind === 'essential_unread') && item.anchor !== undefined ? item.anchor : null;

// A session's history arrives after its tab mounts; past this, a jump still waiting for it is dropped (the tab stays
// open, in the report). Once the history is in, the jump is the store's (`reachMessage`): it loads the pages back to
// the text when it is older than the window a long session opens on, and says so in the transcript while it does, and
// when the text is in none of the history.
const ANCHOR_WAIT_MS = 10_000;
let waiting: (() => void) | null = null; // the latest open wins: an earlier one still waiting, or still loading its pages, is dropped

// The session's tab in the focused pane, as navigation opens it (the caller may open it its own way: the Needs-you row's).
const inFocusedPane = (appSessionId: AppSessionId) => {
  const layout = useLayout.getState();
  layout.revealMain(); // P3-G: a maximized or floating panel docks
  layout.openTab({ kind: 'session', appSessionId }, { pane: 'focused' });
};

export function openAnchor(appSessionId: AppSessionId, anchor: Pick<ItemAnchor, 'messageUuid' | 'blockIndex'>, open: (appSessionId: AppSessionId) => void = inFocusedPane): void {
  waiting?.();
  open(appSessionId);
  const key = appSessionId; // the session transcript's store key (`ipcSource`)
  let done = false;
  let reaching = false;
  // Once the tab's source has given the transcript its history: the report, then the jump (which opens the turn's
  // record if it holds the text). A transcript kept from an earlier tab, with no source attached, is live before its
  // fresh history arrives, and the text may be newer than it: the jump waits for the tab's own.
  const settle = (): boolean => {
    if (done) return true;
    const store = useTranscriptStore.getState();
    const entry = store.entries[key];
    if (!entry || entry.phase === 'hydrating' || !store.attached(key)) return false;
    done = true; // the view's and the jump's own store changes re-enter here
    store.setView(key, 'report');
    reaching = true;
    void store.reachMessage(key, anchor).finally(() => {
      reaching = false;
      if (waiting === stop) waiting = null;
    });
    return true;
  };
  const off = useTranscriptStore.subscribe(() => void (settle() && quiet()));
  const timer = setTimeout(() => !done && stop(), ANCHOR_WAIT_MS);
  // The wait is over; the jump, if it started, runs on in the store.
  function quiet() {
    off();
    clearTimeout(timer);
  }
  function stop() {
    done = true;
    quiet();
    if (reaching) useTranscriptStore.getState().stopReach(key);
    if (waiting === stop) waiting = null;
  }
  waiting = stop;
  if (settle()) quiet();
}
