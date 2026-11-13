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
//
// UX wave U1, UC-1 (U1a's Interfaces §B, "One holder"): this list is the one place that knows a request was answered and
// is not yet settled. The bridge publishes nothing when it takes an answer (its `settled` follows once the session has
// acted), so whoever heard its 200 tells it (`accepted`): the driver for an answer from a window of this machine, this
// machine's endpoint (`laneA.accepted`, through the driver) for one over the link. An accepted request is hidden at
// once; the bridge's settlement takes it away; if a fresh state still lists it once STREAM_GRACE_MS has passed, it waits
// again. The rules need the stream's currency, which only this machine's driver knows, so they run here and nowhere
// else. Each acceptance, state and grace's end is applied one at a time, and the list told after each is a function of
// the marks and the last fresh state (`marksAfter`, `waitingOf`, pure, the clock passed in).
import type { AppSessionId } from '@shared/graph/ids';
import type { LaneARaised } from '@shared/ipc/schema/lane-a';
import { laneAEntryOf as entryOf, type LaneAEntry } from '@shared/lane-a/attention-entry';
import type { LaneAView } from './driver';

export type { LaneAEntry };

export interface LaneAAttentionDeps {
  set(appId: AppSessionId, entries: LaneAEntry[]): void; // the session's whole list, on each change
  graceMs?: number; // how long a lost stream's requests stand before its fresh snapshot, and an accepted one stays hidden
  now?(): number; // ms
}

export const STREAM_GRACE_MS = 5000;

/** An accepted request's mark: when its grace ends (ms). */
export type Marks = ReadonlyMap<string, number>;

/** The marks that stand after a fresh state listing `listed` at `now`: a request no longer listed was settled, and one
 * whose grace has ended waits again. */
export function marksAfter(marks: Marks, listed: ReadonlySet<string>, now: number): Map<string, number> {
  return new Map([...marks].filter(([request, ends]) => listed.has(request) && ends > now));
}

/** The requests the list holds as waiting: the last fresh state's, less those accepted. */
export const waitingOf = (raised: readonly LaneARaised[], marks: Marks): LaneARaised[] => raised.filter((r) => !marks.has(r.request));

interface Session {
  raised: LaneARaised[];
  fresh: boolean; // whether the last view's stream held a current snapshot
  seen: Map<string, string>; // a request the bridge stamped no time to: when it was first seen
  told: string; // the entries last told, as JSON
  grace: ReturnType<typeof setTimeout> | null; // a lost stream's
  marks: Map<string, number>; // accepted, not settled: when each grace ends
  graces: Map<string, ReturnType<typeof setTimeout>>; // each mark's
}

export interface LaneAAttention {
  update(appId: AppSessionId, view: LaneAView | null): void;
  /** The bridge took an answer to `request` (its 200): hidden at once, if the session's list holds it. */
  accepted(appId: AppSessionId, request: string): void;
  /** How many of what the list holds as waiting stop the session: every request but an asynchronous question (its digest's). */
  stopping(appId: AppSessionId): number;
  stop(): void;
}

export function laneAAttention(deps: LaneAAttentionDeps): LaneAAttention {
  const graceMs = deps.graceMs ?? STREAM_GRACE_MS;
  const now = deps.now ?? Date.now;
  const sessions = new Map<AppSessionId, Session>();

  const tell = (appId: AppSessionId, s: Session) => {
    const entries = waitingOf(s.raised, s.marks).map((raised) => {
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
  // The marks as `next` says them; a forgotten mark's grace is let go.
  const remark = (s: Session, next: Map<string, number>) => {
    for (const [request, timer] of s.graces) {
      if (next.has(request)) continue;
      clearTimeout(timer);
      s.graces.delete(request);
    }
    s.marks = next;
  };
  const forget = (s: Session) => remark(s, new Map());
  // Applied while the stream is fresh: the last fresh state decides (a grace that ends while it is not waits for the next).
  const decide = (s: Session) => {
    if (s.fresh) remark(s, marksAfter(s.marks, new Set(s.raised.map((r) => r.request)), now()));
  };

  return {
    update(appId, view) {
      let s = sessions.get(appId);
      if (!s) sessions.set(appId, (s = { raised: [], fresh: false, seen: new Map(), told: '[]', grace: null, marks: new Map(), graces: new Map() }));
      const session = s;
      if (view === null || view.state.bridge !== 'live') {
        settle(session);
        forget(session);
        session.raised = [];
        session.fresh = false;
        session.seen.clear();
        tell(appId, session);
        if (view === null) sessions.delete(appId);
        return;
      }
      session.fresh = view.fresh;
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
      const at = new Date(now()).toISOString();
      const pending = new Set(view.state.pending.map((r) => r.request));
      for (const request of [...session.seen.keys()]) if (!pending.has(request)) session.seen.delete(request);
      for (const raised of view.state.pending) if (!session.seen.has(raised.request)) session.seen.set(raised.request, at);
      session.raised = view.state.pending;
      decide(session);
      tell(appId, session);
    },
    accepted(appId, request) {
      const s = sessions.get(appId);
      if (!s || !s.raised.some((r) => r.request === request)) return; // not listed: nothing to hide
      const prior = s.graces.get(request);
      if (prior !== undefined) clearTimeout(prior);
      s.marks = new Map(s.marks).set(request, now() + graceMs);
      s.graces.set(request, setTimeout(() => {
        s.graces.delete(request);
        decide(s);
        tell(appId, s);
      }, graceMs));
      tell(appId, s);
    },
    stopping(appId) {
      const s = sessions.get(appId);
      return s === undefined ? 0 : waitingOf(s.raised, s.marks).filter((r) => r.async !== true).length;
    },
    stop() {
      for (const s of sessions.values()) {
        settle(s);
        for (const timer of s.graces.values()) clearTimeout(timer);
        s.graces.clear();
      }
      sessions.clear();
    },
  };
}
