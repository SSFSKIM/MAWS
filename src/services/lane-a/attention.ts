// A local terminal session's requests as attention items (P5 O9 M6, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md,
// "The item"): the fourth list beside the broker's, the derived and the owner channel's in main's attention service, so
// Needs you, the sidebar glyph, the Overview card, the hover preview and the dock badge show them as they show a MAWS
// session's. One item per pending `raised` of a live bridge, of the kind the bridge's own rule names (`requestKind`:
// `AskUserQuestion` or an async question is a question, `ExitPlanMode` a plan, any other tool a permission); it leaves at
// its `settled`, and all of a session's leave when its state stream ends without a fresh snapshot within 5 s, when its
// bridge stops being live, or when it leaves lane A. Each item carries the request view `attention.request` answers for
// it, built from the raised record (tool, input, questions, suggestions) in the shape of the engine's own request event,
// so the card, the hover preview and the docked swap read it as they read a broker item's (src/shared/lane-a/attention-entry.ts,
// which the remote pane shares).
import type { AppSessionId } from '@shared/graph/ids';
import type { LaneARaised } from '@shared/ipc/schema/lane-a';
import { laneAEntryOf as entryOf, type LaneAEntry } from '@shared/lane-a/attention-entry';
import type { LaneAView } from './driver';

export type { LaneAEntry };

export interface LaneAAttentionDeps {
  set(appId: AppSessionId, entries: LaneAEntry[]): void; // the session's whole list, on each change
  graceMs?: number; // how long a lost stream's requests stand before its fresh snapshot
}

export const STREAM_GRACE_MS = 5000;

interface Session {
  raised: LaneARaised[];
  seen: Map<string, string>; // a request the bridge stamped no time to: when it was first seen
  told: string; // the entries last told, as JSON
  grace: ReturnType<typeof setTimeout> | null;
}

export function laneAAttention(deps: LaneAAttentionDeps): { update(appId: AppSessionId, view: LaneAView | null): void; stop(): void } {
  const graceMs = deps.graceMs ?? STREAM_GRACE_MS;
  const sessions = new Map<AppSessionId, Session>();

  const tell = (appId: AppSessionId, s: Session) => {
    const entries = s.raised.map((raised) => {
      const at = typeof raised.t === 'number' && Number.isFinite(raised.t) ? new Date(raised.t).toISOString() : s.seen.get(raised.request)!;
      return entryOf(appId, raised, at);
    });
    const told = JSON.stringify(entries);
    if (told === s.told) return;
    s.told = told;
    deps.set(appId, entries);
  };
  const settle = (s: Session) => {
    if (s.grace !== null) clearTimeout(s.grace);
    s.grace = null;
  };

  return {
    update(appId, view) {
      let s = sessions.get(appId);
      if (!s) sessions.set(appId, (s = { raised: [], seen: new Map(), told: '[]', grace: null }));
      const session = s;
      if (view === null || view.state.bridge !== 'live') {
        settle(session);
        session.raised = [];
        session.seen.clear();
        tell(appId, session);
        if (view === null) sessions.delete(appId);
        return;
      }
      if (!view.fresh) {
        // what the stream said stands until its fresh snapshot, for so long
        if (session.grace === null && session.raised.length > 0) {
          session.grace = setTimeout(() => {
            session.grace = null;
            session.raised = [];
            tell(appId, session);
          }, graceMs);
        }
        return;
      }
      settle(session);
      const now = new Date().toISOString();
      const pending = new Set(view.state.pending.map((r) => r.request));
      for (const request of [...session.seen.keys()]) if (!pending.has(request)) session.seen.delete(request);
      for (const raised of view.state.pending) if (!session.seen.has(raised.request)) session.seen.set(raised.request, now);
      session.raised = view.state.pending;
      tell(appId, session);
    },
    stop() {
      for (const s of sessions.values()) settle(s);
      sessions.clear();
    },
  };
}
