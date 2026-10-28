// A local terminal session's requests as attention items (P5 O9 M6, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md,
// "The item"): the fourth list beside the broker's, the derived and the owner channel's in main's attention service, so
// Needs you, the sidebar glyph, the Overview card, the hover preview and the dock badge show them as they show a MAWS
// session's. One item per pending `raised` of a live bridge, of the kind the bridge's own rule names (`requestKind`:
// `AskUserQuestion` or an async question is a question, `ExitPlanMode` a plan, any other tool a permission); it leaves at
// its `settled`, and all of a session's leave when its state stream ends without a fresh snapshot within 5 s, when its
// bridge stops being live, or when it leaves lane A. Each item carries the request view `attention.request` answers for
// it, built from the raised record (tool, input, questions, suggestions) in the shape of the engine's own request event,
// so the card, the hover preview and the docked swap read it as they read a broker item's.
import type { AttentionItem } from '@shared/graph/attention';
import type { Question, SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, AttentionId, EventId, RequestId, SessionId, ToolUseId } from '@shared/graph/ids';
import type { LaneARaised } from '@shared/ipc/schema/lane-a';
import { requestKind } from './decisions';
import type { LaneAView } from './driver';

export interface LaneAEntry {
  item: AttentionItem;
  request: SessionEvent;
}

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

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

// The engine's question shape (`QuestionSchema`), as the engine host reads a `can_use_tool` request's.
const questionsOf = (input: Record<string, unknown>): Question[] =>
  (Array.isArray(input.questions) ? input.questions : []).map((raw) => {
    const q = record(raw);
    return {
      question: String(q.question ?? ''),
      header: String(q.header ?? ''),
      options: (Array.isArray(q.options) ? q.options : []).map((o) => ({ label: String(record(o).label ?? ''), description: str(record(o).description), preview: str(record(o).preview) })),
      multiSelect: q.multiSelect === true,
    };
  });

// The one line Needs you shows, in the broker's words (`engine-host/broker.ts` `shapeOf`).
function summaryOf(raised: LaneARaised, kind: AttentionItem['kind']): string {
  if (kind === 'question') return questionsOf(raised.input)[0]?.question || 'Question';
  if (kind === 'plan') return 'Plan ready for review';
  const detail = str(raised.input.command) ?? str(raised.input.description) ?? '';
  return detail.length > 0 ? `${raised.tool}: ${detail.slice(0, 80)}` : raised.tool;
}

function entryOf(appId: AppSessionId, raised: LaneARaised, createdAt: string): LaneAEntry {
  const kind = requestKind(raised);
  const requestId = raised.request as RequestId;
  const toolUseId = (raised.toolUseId ?? raised.request) as ToolUseId;
  const agentId = (raised.agentId ?? null) as AgentId | null;
  const id = `lane-a:${raised.session}:${raised.request}`;
  const item: AttentionItem = {
    id: id as AttentionId,
    appSessionId: appId,
    sessionId: raised.session as SessionId,
    kind,
    request: { requestId, toolUseId, taskId: null, agentId },
    summary: summaryOf(raised, kind),
    createdAt,
    state: 'pending',
    stateChangedAt: createdAt,
    expiresAt: raised.deadline ?? null,
  };
  const base = { id: id as EventId, sessionId: raised.session as SessionId, at: createdAt, seq: null, agentId, parentToolUseId: null };
  const request: SessionEvent =
    kind === 'question'
      ? { ...base, kind: 'question.requested', requestId, toolUseId, questions: questionsOf(raised.input) }
      : kind === 'plan'
        ? { ...base, kind: 'plan.requested', requestId, toolUseId, plan: str(raised.input.plan) ?? '', input: raised.input }
        : {
            ...base, kind: 'permission.requested', requestId, toolUseId, toolName: raised.tool, displayName: null, input: raised.input,
            description: null, decisionReasonType: null, suggestions: raised.suggestions ?? [], blockedPath: null,
          };
  return { item, request };
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
