// The permission broker (charter §4.6; C3 execution document, Interfaces "Broker"): one pending table for every inbound
// request that needs a human (permissions, AskUserQuestion, plan approval, dialogs, MCP elicitations), with the states
// pending → delivered → confirmed, or retired. Delivery truth is the flushed stdin write of our answer; confirmation is
// the earliest stdout frame carrying the item's tool-use id; an item with no tool-use id retires at the main-lane
// `result` after its delivery; an engine `control_cancel_request` retires an item as `abort`; process exit retires
// everything live and reports how many approvals were lost. The broker never emits X1 events (the normaliser is the
// only source): what it has to say beyond its attention items it journals as `meta` rows the normaliser maps — the
// scope-downgrade note (`answer_note`, folded into `permission.resolved.message`) and the undeclared-dialog warning
// (`notice`). Attention items go to main as the session's whole list on every change (`session.brokerItems`).
import type { AttentionItem } from '@shared/graph/attention';
import type { AgentId, AppSessionId, AttentionId, RequestId, SessionId, ToolUseId } from '@shared/graph/ids';
import type { RequestAnswer } from '@shared/engine/answers';
import { CanUseToolRequestSchema, PermissionUpdateSchema, type PermissionUpdate } from '@shared/wire/control';
import { ControlRequestFrameSchema, type ControlRequestFrame } from '@shared/wire/frames';
import { CLEAR_AND_IMPLEMENT_MESSAGE } from './normalizer-controls';
import type { ControlClient } from './rpc';

// The dialog kinds `initialize` declares (§4.1): we render exactly these, so a request for any other kind is never
// answered on the human's behalf (SPEC 45.22.13); it stays pending with a warning.
export const DECLARED_DIALOG_KINDS: readonly string[] = Object.freeze(['auto_mode_server_fallback', 'refusal_fallback_prompt']);

export const DENY_MESSAGE = 'Denied by the user in MAWS.';
export const KEEP_PLANNING_MESSAGE = 'Keep planning.';

export type BrokerItemKind = 'permission' | 'question' | 'plan' | 'dialog' | 'elicitation';
export type RetiredReason = 'answered' | 'abort' | 'exit' | 'expired' | 'turn_ended';

export interface BrokerItem {
  attention: AttentionItem;
  request: ControlRequestFrame;
  kind: BrokerItemKind;
  toolUseId: ToolUseId | null;
  deliveredAt: string | null;
  confirmedAt: string | null;
  retiredReason: RetiredReason | null;
}

export interface BrokerDeps {
  appSessionId: AppSessionId;
  client: Pick<ControlClient, 'respond'>;
  meta: (frame: Record<string, unknown>) => void; // journals a meta row (the session's journal-then-normalise path)
  onAttention: (items: AttentionItem[]) => void; // the session's whole broker list, on every change
  onGrant?: (updatedPermissions: PermissionUpdate[]) => void; // the updatedPermissions of a delivered answer, for the grant snapshot
  sessionId?: () => SessionId | null;
  isExiting?: () => boolean;
  now?: () => string;
}

// An answer the broker refuses to write: the wrong kind for the item, or a dialog of a kind the host never declared
// (answering it would claim the human completed or dismissed a dialog MAWS cannot render). The item stays pending.
export class BrokerAnswerMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrokerAnswerMismatch';
  }
}

interface Entry extends BrokerItem {
  answering: boolean;
}

type Frame = Record<string, unknown> & { type?: unknown };

export class PermissionBroker {
  private readonly items = new Map<string, Entry>(); // live items: pending, delivered, confirmed
  private readonly tombstones = new Map<string, RetiredReason>(); // retired items keep their id and reason only (the process never exits on its own)
  private lostAtAccept = 0;
  private readonly now: () => string;

  constructor(private readonly deps: BrokerDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  // Pending items and delivered ones: what process exit would lose (`EngineSessionStatus.pendingRequests`).
  get live(): number {
    let n = 0;
    for (const item of this.items.values()) if (item.attention.state === 'pending' || item.attention.state === 'delivered') n += 1;
    return n;
  }

  // A live item (pending, delivered or confirmed); undefined once retired.
  item(requestId: RequestId): BrokerItem | undefined {
    return this.items.get(requestId);
  }

  retiredReason(requestId: RequestId): RetiredReason | null {
    return this.tombstones.get(requestId) ?? null;
  }

  // Every item not yet retired, in arrival order: the session's broker list.
  snapshot(): AttentionItem[] {
    return [...this.items.values()].map((i) => i.attention);
  }

  // An inbound request that needs a human. Hook callbacks and unknown subtypes are not broker items; a request id
  // seen before (a re-delivery) is ignored.
  accept(req: ControlRequestFrame): void {
    if (this.items.has(req.request_id) || this.tombstones.has(req.request_id)) return;
    const shaped = shapeOf(req);
    if (!shaped) return;
    const at = this.now();
    const requestId = req.request_id as RequestId;
    const agentId = typeof req.request.agent_id === 'string' ? (req.request.agent_id as AgentId) : null;
    const entry: Entry = {
      attention: {
        id: `${this.deps.appSessionId}:${requestId}` as AttentionId, appSessionId: this.deps.appSessionId, sessionId: this.deps.sessionId?.() ?? null, kind: shaped.kind,
        request: { requestId, toolUseId: shaped.toolUseId, taskId: null, agentId }, summary: shaped.summary, createdAt: at, state: 'pending', stateChangedAt: at, expiresAt: null,
      },
      request: req, kind: shaped.kind, toolUseId: shaped.toolUseId, deliveredAt: null, confirmedAt: null, retiredReason: null, answering: false,
    };
    this.items.set(requestId, entry);
    if (this.deps.isExiting?.()) {
      // the process is going away: nobody can answer this any more (C3 M3 decision); it counts among the lost
      this.retire(entry, 'exit', at);
      this.lostAtAccept += 1;
      return;
    }
    if (shaped.kind === 'dialog' && !DECLARED_DIALOG_KINDS.includes(String(req.request.dialog_kind))) {
      this.deps.meta({ event: 'notice', level: 'warning', key: `dialog:undeclared:${requestId}`, text: `The engine asked for a "${String(req.request.dialog_kind)}" dialog, which MAWS did not declare; it stays pending.` });
    }
    this.emit();
  }

  // Writes the human's answer. `delivered` once the bytes reached the process; `not_pending` for an unknown id or an
  // item that is no longer pending (or has an answer in flight); `write_failed` leaves the item pending.
  async answer(requestId: RequestId, answer: RequestAnswer): Promise<'delivered' | 'not_pending' | 'write_failed'> {
    const entry = this.items.get(requestId);
    if (!entry || entry.attention.state !== 'pending' || entry.answering) return 'not_pending';
    if (answerKindOf(entry.kind) !== answer.kind) throw new BrokerAnswerMismatch(`request ${requestId} is a ${entry.kind} request; a ${answer.kind} answer cannot resolve it`);
    if (entry.kind === 'dialog' && !DECLARED_DIALOG_KINDS.includes(String(entry.request.request.dialog_kind))) {
      throw new BrokerAnswerMismatch(`request ${requestId} asks for a "${String(entry.request.request.dialog_kind)}" dialog, which MAWS did not declare; it cannot be answered`);
    }
    const wire = toWire(entry, answer);
    entry.answering = true;
    if (wire.note) this.deps.meta({ event: 'answer_note', requestId, note: wire.note }); // before the response row it annotates
    try {
      await this.deps.client.respond(requestId, wire.response);
    } catch {
      entry.answering = false;
      return 'write_failed';
    }
    entry.answering = false;
    if (entry.attention.state === 'pending') {
      const at = this.now();
      entry.deliveredAt = at;
      this.setState(entry, 'delivered', at);
      this.emit();
    }
    if (wire.grants.length > 0) this.deps.onGrant?.(wire.grants);
    return 'delivered';
  }

  // Every stdout frame, after the session journaled it: confirmation by tool-use id, abort, elicitation completion,
  // the turn's end, and the re-delivered requests a control_response envelope may carry.
  observe(frame: unknown): void {
    const f = (frame ?? {}) as Frame;
    const at = this.now();
    let changed = false;
    switch (f.type) {
      case 'user': {
        const content = (f.message as { content?: unknown } | undefined)?.content;
        if (Array.isArray(content)) for (const block of content as { type?: unknown; tool_use_id?: unknown }[]) if (block.type === 'tool_result') changed = this.confirm(block.tool_use_id, at) || changed;
        break;
      }
      case 'tool_progress':
        changed = this.confirm(f.tool_use_id, at);
        break;
      case 'control_request': {
        const request = (f.request ?? {}) as { subtype?: unknown; tool_use_id?: unknown; input?: { tool_use_id?: unknown } };
        if (request.subtype === 'hook_callback') changed = this.confirm(request.tool_use_id ?? request.input?.tool_use_id, at);
        break;
      }
      case 'system':
        if (f.subtype === 'permission_denied') changed = this.confirm(f.tool_use_id, at);
        else if (f.subtype === 'elicitation_complete') changed = this.retireWhere((e) => e.kind === 'elicitation' && e.request.request.elicitation_id === f.elicitation_id, 'answered', at);
        break;
      case 'control_cancel_request': {
        const entry = this.items.get(String(f.request_id));
        if (entry && (entry.attention.state === 'pending' || entry.attention.state === 'delivered')) changed = this.retire(entry, 'abort', at);
        break;
      }
      case 'result': {
        for (const denial of (Array.isArray(f.permission_denials) ? f.permission_denials : []) as { tool_use_id?: unknown }[]) changed = this.confirm(denial.tool_use_id, at) || changed;
        const mainLane = typeof f.parent_tool_use_id !== 'string' || f.parent_tool_use_id.length === 0;
        const echoReceipt = f.num_turns === 0 && (f.terminal_reason === undefined || f.terminal_reason === null);
        if (mainLane && !echoReceipt) {
          changed = this.retireWhere((e) => e.attention.state === 'confirmed', 'answered', at) || changed;
          changed = this.retireWhere((e) => (e.attention.state === 'delivered' || (e.attention.state === 'pending' && e.answering)) && e.toolUseId === null, 'turn_ended', at) || changed;
        }
        break;
      }
      case 'control_response': {
        // An initialize (or any) response may carry the engine's still-open requests (SPEC 45 ControlResponseEnvelope,
        // `pending_permission_requests` / `pending_user_dialog_requests` on the envelope): re-accept what we do not hold.
        const envelope = (f.response ?? {}) as Record<string, unknown>;
        for (const key of ['pending_permission_requests', 'pending_user_dialog_requests']) {
          const list = envelope[key];
          if (!Array.isArray(list)) continue;
          for (const raw of list) {
            const parsed = ControlRequestFrameSchema.safeParse(raw);
            if (parsed.success) this.accept(parsed.data);
          }
        }
        return; // accept emitted already
      }
    }
    if (changed) this.emit();
  }

  // The process is gone: every live item retires `exit` and counts as lost (plus those that arrived while exiting);
  // confirmed items retire `answered`. The count rides on `process.exited.lostAttentionCount`.
  processExited(): { lost: number } {
    const at = this.now();
    let lost = this.lostAtAccept;
    this.lostAtAccept = 0;
    let changed = false;
    for (const entry of [...this.items.values()]) {
      if (entry.attention.state === 'pending' || entry.attention.state === 'delivered') {
        lost += 1;
        changed = this.retire(entry, 'exit', at) || changed;
      } else if (entry.attention.state === 'confirmed') {
        changed = this.retire(entry, 'answered', at) || changed;
      }
    }
    if (changed) this.emit();
    return { lost };
  }

  private confirm(toolUseId: unknown, at: string): boolean {
    if (typeof toolUseId !== 'string') return false;
    let changed = false;
    for (const entry of this.items.values()) {
      // An answer whose write has not resolved yet counts as delivered here: the engine acting on the tool use is
      // proof it read the answer, and the write continuation may run after the frame that proves it.
      const delivered = entry.attention.state === 'delivered' || (entry.attention.state === 'pending' && entry.answering);
      if (entry.toolUseId !== toolUseId || !delivered) continue;
      if (entry.attention.state === 'pending') {
        entry.deliveredAt = at; // the transition consumers see stays pending → delivered → confirmed
        this.setState(entry, 'delivered', at);
        this.emit();
      }
      entry.confirmedAt = at;
      this.setState(entry, 'confirmed', at);
      changed = true;
    }
    return changed;
  }

  private retireWhere(predicate: (entry: Entry) => boolean, reason: RetiredReason, at: string): boolean {
    let changed = false;
    for (const entry of [...this.items.values()]) if (predicate(entry)) changed = this.retire(entry, reason, at) || changed;
    return changed;
  }

  private retire(entry: Entry, reason: RetiredReason, at: string): boolean {
    if (!this.items.has(entry.attention.request.requestId!)) return false;
    entry.retiredReason = reason;
    this.setState(entry, 'retired', at);
    this.items.delete(entry.attention.request.requestId!);
    this.tombstones.set(entry.attention.request.requestId!, reason);
    return true;
  }

  private setState(entry: Entry, state: AttentionItem['state'], at: string): void {
    entry.attention = { ...entry.attention, state, stateChangedAt: at };
  }

  private emit(): void {
    this.deps.onAttention(this.snapshot());
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Request shapes and answers on the wire

function shapeOf(req: ControlRequestFrame): { kind: BrokerItemKind; toolUseId: ToolUseId | null; summary: string } | null {
  const request = req.request as Record<string, unknown> & { subtype: string };
  switch (request.subtype) {
    case 'can_use_tool': {
      const toolUseId = typeof request.tool_use_id === 'string' ? (request.tool_use_id as ToolUseId) : null;
      const input = (request.input ?? {}) as { command?: unknown; description?: unknown; questions?: { question?: unknown }[] };
      if (request.tool_name === 'AskUserQuestion') return { kind: 'question', toolUseId, summary: String(input.questions?.[0]?.question ?? 'Question') };
      if (request.tool_name === 'ExitPlanMode') return { kind: 'plan', toolUseId, summary: 'Plan ready for review' };
      const name = String(request.display_name ?? request.tool_name);
      const detail = typeof input.command === 'string' ? input.command : typeof request.description === 'string' ? request.description : typeof input.description === 'string' ? input.description : '';
      return { kind: 'permission', toolUseId, summary: detail.length > 0 ? `${name}: ${detail.slice(0, 80)}` : name };
    }
    case 'elicitation':
      return { kind: 'elicitation', toolUseId: null, summary: String(request.mcp_server_name ?? 'MCP server') };
    case 'request_user_dialog':
      return { kind: 'dialog', toolUseId: typeof request.tool_use_id === 'string' ? (request.tool_use_id as ToolUseId) : null, summary: String(request.dialog_kind) };
    default:
      return null;
  }
}

function answerKindOf(kind: BrokerItemKind): RequestAnswer['kind'] {
  return kind;
}

interface Wire {
  response: Record<string, unknown>;
  grants: PermissionUpdate[]; // the updatedPermissions sent
  note: string | null; // why the answer differs from what the human chose
}

function toWire(entry: Entry, answer: RequestAnswer): Wire {
  const request = entry.request.request as Record<string, unknown>;
  switch (answer.kind) {
    case 'permission':
      return permissionWire(request, answer);
    case 'question':
      return { response: { behavior: 'allow', updatedInput: { ...((request.input ?? {}) as object), answers: answer.answers } }, grants: [], note: null };
    case 'plan':
      if (answer.outcome === 'implement') return { response: { behavior: 'allow', updatedInput: request.input }, grants: [], note: null }; // the engine strips plan/planFilePath and restores the pre-plan mode (SPEC 21 §6.7)
      if (answer.outcome === 'keep_planning') return { response: { behavior: 'deny', message: answer.feedback ?? KEEP_PLANNING_MESSAGE }, grants: [], note: null };
      return { response: { behavior: 'deny', message: CLEAR_AND_IMPLEMENT_MESSAGE }, grants: [], note: null }; // the session runs the rest after the turn's result
    case 'dialog':
      return { response: answer.result === undefined ? { behavior: answer.behavior } : { behavior: answer.behavior, result: answer.result }, grants: [], note: null };
    case 'elicitation':
      return { response: answer.content === undefined ? { action: answer.action } : { action: answer.action, content: answer.content }, grants: [], note: null };
  }
}

function permissionWire(request: Record<string, unknown>, answer: Extract<RequestAnswer, { kind: 'permission' }>): Wire {
  if (answer.decision !== 'allow') {
    const response: Record<string, unknown> = { behavior: 'deny', message: answer.message ?? DENY_MESSAGE, decisionClassification: 'user_reject' };
    if (answer.decision === 'deny_and_stop') response.interrupt = true; // aborts the whole turn (SPEC 45.19.3)
    return { response, grants: [], note: null };
  }
  const req = CanUseToolRequestSchema.safeParse(request);
  const fields = (req.success ? req.data : request) as Record<string, unknown>;
  // An ask rule outranks any allow rule (§4.6), so a prompt it raised offers no always-allow scope. The card (C7) never
  // offers one; this is the guard, answering once and saying so.
  const guard = fields.suppress_always_allow_rule === true ? 'always-allow suppressed' : fields.decision_reason_type === 'rule' || (fields.matched_ask_rule !== undefined && fields.matched_ask_rule !== null) ? 'ask rule' : null;
  const scope = guard !== null ? 'once' : answer.scope!;
  const response: Record<string, unknown> = { behavior: 'allow', updatedInput: answer.updatedInput ?? request.input, decisionClassification: scope === 'once' ? 'user_temporary' : 'user_permanent' };
  const note = guard !== null && answer.scope !== 'once' ? `scope downgraded: ${guard}` : null;
  if (scope === 'once') return { response, grants: [], note };
  const update = scope === 'session' ? sessionRule(request) : localSettingsRule(request);
  response.updatedPermissions = [update];
  return { response, grants: [update], note };
}

function addRulesSuggestions(request: Record<string, unknown>): Extract<PermissionUpdate, { rules: unknown }>[] {
  const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [];
  const out: Extract<PermissionUpdate, { rules: unknown }>[] = [];
  for (const raw of suggestions) {
    const parsed = PermissionUpdateSchema.safeParse(raw);
    if (parsed.success && parsed.data.type === 'addRules') out.push(parsed.data as Extract<PermissionUpdate, { rules: unknown }>);
  }
  return out;
}

// The rule the request itself names when the engine suggested none: the Bash command, or the whole tool otherwise
// (the pass-2 grant fixtures' shape, `grant-reapply-start` seq 32).
function ruleFromRequest(request: Record<string, unknown>, destination: string): PermissionUpdate {
  const toolName = String(request.tool_name);
  const command = (request.input as { command?: unknown } | undefined)?.command;
  const rule = toolName === 'Bash' && typeof command === 'string' ? { toolName, ruleContent: command } : { toolName };
  return { type: 'addRules', rules: [rule], behavior: 'allow', destination };
}

function sessionRule(request: Record<string, unknown>): PermissionUpdate {
  const [first] = addRulesSuggestions(request);
  return first ? { ...first, destination: 'session' } : ruleFromRequest(request, 'session');
}

function localSettingsRule(request: Record<string, unknown>): PermissionUpdate {
  const suggestions = addRulesSuggestions(request);
  const local = suggestions.find((s) => s.destination === 'localSettings');
  if (local) return local; // the suggestion as the engine sent it
  return suggestions[0] ? { ...suggestions[0], destination: 'localSettings' } : ruleFromRequest(request, 'localSettings');
}
