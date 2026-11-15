// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §E `showWaiting`;
// decision 19): the one way to a waiting request from outside its transcript: the column's card, a Needs-you row, a
// notification's open, ⇧⌘J, the compact composer's line. It goes through each mounted transcript's `show`
// (`waitingViewsOf`), so the request is selected where it is drawn and the keyboard lands on its row. It never brings the
// session to the front (its callers do), and never shows another request in place of one that is gone: it says so.
// A session whose transcript is not mounted yet (or still reads its history) has the request remembered, and shown by the
// first transcript of the session to become ready, where `show` checks it again. The remembered request belongs to the
// navigation that asked for it: the person moving to another session lets it go, and so does any later call.
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import { openCardSession, useFloatingCard } from '../shell/floating';
import { selectWaitingRequests, useAttention } from '../stores/attention';
import { tabOnScreen, useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { waitingViewsOf, whenWaitingViewMounts } from '../transcript/view/waiting-view';

const GONE_COPY = 'That request is no longer waiting';

const sayGone = () => useNotices.getState().toast({ level: 'info', text: GONE_COPY, actions: [], dismissible: true });

// The sessions in front of the person: the one the tab on screen shows, and the one the open floating card draws.
function inFront(): AppSessionId[] {
  const layout = useLayout.getState();
  const tab = tabOnScreen(layout);
  return [tab?.kind === 'session' ? tab.appSessionId : null, openCardSession(layout)].filter((id): id is AppSessionId => id !== null);
}

let remembered: (() => void) | null = null; // lets the remembered request go
const forget = () => remembered?.();

/** `attentionId` null: the session's oldest waiting request, resolved to its id now. A session's transcript store key is its id. */
export function showWaiting(appSessionId: AppSessionId, attentionId: AttentionId | null): void {
  forget(); // any later call replaces what an earlier one left remembered, whatever it finds
  const id = attentionId ?? selectWaitingRequests(useAttention.getState(), appSessionId)[0]?.id ?? null;
  if (id === null) return; // nothing waits: nothing to show, and nothing was named that could be gone
  const views = waitingViewsOf(appSessionId);
  if (views.length > 0) {
    // Every mounted transcript of the session shows it (two views of one session are rare: a split showing it twice);
    // it is gone only when no transcript placed it.
    const answers = views.map((view) => view.show(id));
    if (!answers.includes('shown')) sayGone();
    return;
  }
  let seen = inFront().join('\n');
  const watch = () => {
    const now = inFront();
    if (now.join('\n') === seen) return;
    seen = now.join('\n');
    if (now.length > 0 && !now.includes(appSessionId)) forget(); // the person moved to another session
  };
  const offs = [
    whenWaitingViewMounts(appSessionId, (view) => {
      forget();
      if (view.show(id) === 'gone') sayGone();
    }),
    useLayout.subscribe(watch),
    useFloatingCard.subscribe(watch),
  ];
  const release = () => {
    offs.forEach((off) => off());
    if (remembered === release) remembered = null;
  };
  remembered = release;
}
