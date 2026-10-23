// WR 49: documents and dashboards count only open conversations whose passage or block still lives.
import { commentCountStore } from '../comments/counts';
import type { Doc } from '../yjs';
import { listThreads, liveThreadIds, observeThreads } from './threads';

export function documentCommentCounts(doc: Doc) {
  return commentCountStore(doc, () => {
    const counts = new Map<string, number>();
    const threads = listThreads(doc);
    if (!threads.some((thread) => thread.status === 'open')) return counts;
    const live = liveThreadIds(doc);
    for (const thread of threads) {
      if (thread.status === 'open' && live.has(thread.id)) counts.set(thread.tabId, (counts.get(thread.tabId) ?? 0) + 1);
    }
    return counts;
  }, observeThreads);
}
