// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §E `showWaiting`;
// decision 19): the one way to a waiting request from outside its transcript: the column's card, a notification's
// open, ⇧⌘J, the compact composer's line. It goes through each mounted transcript's `show` (`waitingViewsOf`), so the
// request is selected where it is drawn and the keyboard lands on its row; a session whose transcript is not mounted
// yet has the request remembered once and shown at the mount, where `show` checks it again. It never brings the session
// to the front (its callers do), and never shows another request in place of one that is gone: it says so.
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import { selectWaitingRequests, useAttention } from '../stores/attention';
import { useNotices } from '../stores/notices';
import { waitingViewsOf, whenWaitingViewMounts } from '../transcript/view/waiting-view';

const GONE_COPY = 'That request is no longer waiting';

const sayGone = () => useNotices.getState().toast({ level: 'info', text: GONE_COPY, actions: [], dismissible: true });

/** `attentionId` null: the session's oldest waiting request, resolved to its id now. A session's transcript store key is its id. */
export function showWaiting(appSessionId: AppSessionId, attentionId: AttentionId | null): void {
  const id = attentionId ?? selectWaitingRequests(useAttention.getState(), appSessionId)[0]?.id ?? null;
  if (id === null) return; // nothing waits: nothing to show, and nothing was named that could be gone
  const views = waitingViewsOf(appSessionId);
  if (views.length === 0) {
    whenWaitingViewMounts(appSessionId, (view) => {
      if (view.show(id) === 'gone') sayGone();
    });
    return;
  }
  // Every mounted transcript of the session shows it (two views of one session are rare: a split showing it twice);
  // it is gone only when no transcript placed it.
  const answers = views.map((view) => view.show(id));
  if (!answers.includes('shown')) sayGone();
}
