// UX wave U1c (the U1c document, Design 4; M4's prerequisite, Decision Log 35): what a grant out holds of its session
// while it is out, so that the record the grant ends on keeps arriving whatever is mounted, and lets go when the
// session's last grant ends or the session goes (`grants.ts`, `keep`).
//
// - The session's queue attachment: its snapshot and its events.
// - Its transcript's attachment in the store, as a holder of whatever source is attached (`hold`). A view that attaches
//   another source replaces the attachment and every count it held, so the hold is taken again at each change of the
//   store, the new one before the old is let go, and the count never falls to nothing between them.
// - For another machine's terminal session, what feeds that attachment: the page's plane transcript of the session,
//   held (`holdRemoteTranscript`, whose last release closes the machine's watch whatever the store holds), and its
//   current source, which a rebuild replaces and a mounted pane attaches again. Where the store holds no attachment, or
//   the plane has rebuilt, the hold attaches the current source itself: with the pane open that is the pane's own
//   source, counted once more; with it closed, nothing else would. The plane's module loads with the hold, as the
//   window's other readers of it load it (`lane-a/remote-agents.ts`), so the window's entry chunk does not carry it.
import type { AppSessionId } from '@shared/graph/ids';
import { isRemoteLaneA } from '../lane-a/remote-session';
import { attachQueue } from '../stores/queue';
import { useTranscriptStore } from '../stores/transcript';
import type { TranscriptSource } from '../transcript/source/types';

/** Holds the session's queue attachment and its transcript until the returned release. */
export function holdSession(appSessionId: AppSessionId): () => void {
  const queue = attachQueue(appSessionId);
  const transcript = holdTranscript(appSessionId);
  return () => {
    queue();
    transcript();
  };
}

function holdTranscript(key: AppSessionId): () => void {
  const store = () => useTranscriptStore.getState();
  let held = store().hold(key);
  let ended = false;
  let taking = false;
  let upstream: { source: () => TranscriptSource; release: () => void } | null = null;
  // The hold taken again over the attachment as it is now; first, with a source the plane gives, that source attached
  // where none is or where the plane replaced it (`rebuilt`), its own count let go once the hold counts in it.
  const take = (rebuilt: boolean) => {
    if (ended || taking) return; // the store's notices of this call's own attach
    taking = true;
    try {
      const source = upstream?.source() ?? null;
      const attaching = source !== null && (rebuilt || !store().attached(key));
      if (attaching) void store().attach(key, source);
      const next = store().hold(key);
      held();
      held = next;
      if (attaching) store().detach(key);
    } finally {
      taking = false;
    }
  };
  const offStore = useTranscriptStore.subscribe(() => take(false));
  if (isRemoteLaneA(key)) {
    void import('../lane-a/remote-source').then(({ holdRemoteTranscript, remoteTranscriptOf }) => {
      if (ended) return;
      const plane = remoteTranscriptOf(key);
      const release = holdRemoteTranscript(key, plane);
      // A rebuild's source is attached a microtask after the plane's notice, so a pane that attaches it in the same
      // tick is joined, not replaced; a pane that attaches it later replaces the hold's attachment, and the store's
      // notice of that takes the hold again.
      const offPlane = plane.state.subscribe((now, before) => {
        if (now.source !== before.source) void Promise.resolve().then(() => take(true));
      });
      upstream = {
        source: () => plane.state.getState().source,
        release: () => (offPlane(), release()),
      };
      take(false);
    });
  }
  return () => {
    ended = true;
    offStore();
    upstream?.release();
    held();
  };
}
