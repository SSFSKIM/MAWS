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

// A session's history arrives after its tab mounts; past this, a jump still waiting is dropped (the tab stays open).
const ANCHOR_WAIT_MS = 10_000;
let waiting: (() => void) | null = null; // the latest open wins: an earlier one still waiting is dropped

// The session's tab in the focused pane, as navigation opens it (the caller may open it its own way: the Needs-you row's).
const inFocusedPane = (appSessionId: AppSessionId) => {
  const layout = useLayout.getState();
  layout.setPanel({ maximized: false });
  layout.openTab({ kind: 'session', appSessionId }, { pane: 'focused' });
};

export function openAnchor(appSessionId: AppSessionId, anchor: Pick<ItemAnchor, 'messageUuid' | 'blockIndex'>, open: (appSessionId: AppSessionId) => void = inFocusedPane): void {
  waiting?.();
  open(appSessionId);
  const key = appSessionId; // the session transcript's store key (`ipcSource`)
  let done = false;
  // Once the transcript has its history: the report, then the jump (which opens the turn's record if it holds the text).
  const settle = (): boolean => {
    if (done) return true;
    const entry = useTranscriptStore.getState().entries[key];
    if (!entry || entry.phase === 'hydrating') return false;
    done = true;
    useTranscriptStore.getState().setView(key, 'report');
    useTranscriptStore.getState().jumpToMessage(key, anchor);
    return true;
  };
  if (settle()) return;
  const off = useTranscriptStore.subscribe(() => void (settle() && stop()));
  const timer = setTimeout(() => stop(), ANCHOR_WAIT_MS);
  function stop() {
    done = true;
    off();
    clearTimeout(timer);
    if (waiting === stop) waiting = null;
  }
  waiting = stop;
}
