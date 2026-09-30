import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { AttentionItemSchema, type AttentionItem } from './attention';
import {
  ATTENTION_KINDS,
  ATTENTION_STATES,
  AUTO_MODE_REFUSAL_CODES,
  COMMAND_LIFECYCLE_STATES,
  DENIAL_KINDS,
  PERMISSION_MODES,
  PLAN_OUTCOMES,
  SAFEGUARD_VERDICTS,
  SESSION_STATES,
  TITLE_SOURCES,
} from './enums';
import { EVENT_KINDS, SessionEventSchema, type SessionEvent } from './events';
import { SessionRecordSchema, type SessionRecord } from './session';

const base = {
  id: 'e1',
  sessionId: 's1',
  at: '2026-09-28T10:00:00.000Z',
  seq: 12,
  agentId: null,
  parentToolUseId: null,
};

const toolResult = (overrides: Record<string, unknown>) => ({
  ...base,
  kind: 'tool.result',
  toolUseId: 'toolu_1',
  content: 'ok',
  isError: false,
  structured: null,
  spillPath: null,
  denial: null,
  safeguard: 'not_evaluated',
  messageUuid: null,
  ...overrides,
});

const record = (): SessionRecord =>
  SessionRecordSchema.parse({
    appId: 'app-1',
    engineSessionId: 's1',
    projectId: null,
    directory: '/Users/new/Developer/GitHub/MAWS',
    additionalDirectories: [],
    worktree: null,
    branch: 'main',
    title: { text: 'Untitled', source: 'none' },
    pinned: false,
    archived: false,
    holder: { kind: 'self' },
    lastSeen: { messageUuid: null, at: null },
    unread: false,
    engineVersion: '2.1.283',
    gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' }, // C3: the X1 gateway extension
    model: { requested: null, resolved: 'claude-sonnet-5' },
    effort: null,
    permissionMode: { requested: 'default', effective: 'default', refusal: null },
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
  });

describe('graph schemas accept and reject', () => {
  describe('enums', () => {
    it('carry the X1 values verbatim', () => {
      expect(PERMISSION_MODES).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk']);
      expect(AUTO_MODE_REFUSAL_CODES).toEqual(['auto_mode_settings', 'auto_mode_circuit_breaker', 'auto_mode_fast_mode', 'auto_mode_model', 'auto_mode_unavailable']);
      expect(DENIAL_KINDS).toEqual(['user-rejected', 'permission-rule', 'automode-blocked', 'automode-unavailable', 'automode-parsing-error', 'interrupted', 'cancelled']);
      expect(ATTENTION_KINDS).toEqual(['permission', 'question', 'plan', 'dialog', 'elicitation', 'error', 'interrupted', 'held_peer_message', 'auto_mode_unavailable']);
      expect(ATTENTION_STATES).toEqual(['pending', 'delivered', 'confirmed', 'retired']);
      expect(SAFEGUARD_VERDICTS).toEqual(['not_evaluated', 'not_flagged', 'flagged']);
      expect(TITLE_SOURCES).toEqual(['user', 'generated', 'tool', 'none']);
      expect(SESSION_STATES).toEqual(['idle', 'running', 'requires_action']);
      expect(COMMAND_LIFECYCLE_STATES).toEqual(['queued', 'started', 'completed', 'cancelled', 'discarded', 'refused']);
      expect(PLAN_OUTCOMES).toEqual(['implement', 'clear_and_implement', 'keep_planning']);
    });

    it('lists every event kind once and the union covers each', () => {
      expect(new Set(EVENT_KINDS).size).toBe(EVENT_KINDS.length);
      expect(EVENT_KINDS).toHaveLength(49);
      const covered = SessionEventSchema.options.map((option) => option.shape.kind.value).sort();
      expect(covered).toEqual([...EVENT_KINDS].sort());
    });
  });

  describe('events', () => {
    it('accepts a tool.result with every denial kind and rejects an invented one', () => {
      for (const denial of DENIAL_KINDS) expect(SessionEventSchema.safeParse(toolResult({ denial })).success, denial).toBe(true);
      expect(SessionEventSchema.safeParse(toolResult({ denial: 'because' })).success).toBe(false);
    });

    it('accepts a tool.result with every safeguard verdict and rejects an invented one', () => {
      for (const safeguard of SAFEGUARD_VERDICTS) expect(SessionEventSchema.safeParse(toolResult({ safeguard })).success, safeguard).toBe(true);
      expect(SessionEventSchema.safeParse(toolResult({ safeguard: 'approved' })).success).toBe(false);
    });

    it('is strict: an unknown field on the app record is rejected, a missing base field too', () => {
      expect(SessionEventSchema.safeParse(toolResult({ extra: 1 })).success).toBe(false);
      const { seq: _seq, ...withoutSeq } = toolResult({});
      void _seq;
      expect(SessionEventSchema.safeParse(withoutSeq).success).toBe(false);
      expect(SessionEventSchema.safeParse({ ...toolResult({}), seq: null }).success).toBe(true);
    });

    it('accepts session.reconnect phases and rejects an unknown phase', () => {
      const reconnect = { ...base, kind: 'session.reconnect', phase: 'attempting', attempt: 1, maxAttempts: 3, trigger: 'process_exit', reason: null };
      expect(SessionEventSchema.parse(reconnect)).toEqual(reconnect);
      expect(SessionEventSchema.safeParse({ ...reconnect, phase: 'retrying' }).success).toBe(false);
      expect(SessionEventSchema.safeParse({ ...reconnect, trigger: 'boredom' }).success).toBe(false);
    });

    it('accepts one event per kind through a representative payload', () => {
      const samples: Record<string, Record<string, unknown>> = {
        'session.started': { cwd: '/tmp', engineVersion: null, resumedFrom: null, forked: false },
        'session.init': { cwd: '/tmp', model: 'm', permissionMode: 'auto', tools: ['Bash'], slashCommands: [], agents: [], skills: [], plugins: [{ name: 'p', source: 's' }], mcpServers: [], capabilities: [], engineVersion: '2.1.283', outputStyle: null },
        'session.state': { state: 'requires_action' },
        'session.commands': { commands: [{ name: 'compact', description: 'd', argumentHint: null, builtin: true }] },
        'turn.started': { userMessageUuid: 'u', origin: 'human' },
        'turn.ended': { result: 'success', isError: false, terminalReason: 'completed', resultText: 'OK', durationMs: 10, numTurns: 1, costUsd: 0.01, usage: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null }, permissionDenials: [{ toolName: 'Bash', toolUseId: 't', toolInput: {} }], errors: [], userMessageUuids: ['u'], origin: 'human', resultIndex: 0, isEchoReceipt: false },
        'command.lifecycle': { commandUuid: 'c', state: 'queued' },
        'assistant.block.delta': { apiMessageId: 'msg_1', blockIndex: 0, blockType: 'text', textDelta: 'hi', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null },
        'assistant.block.complete': { messageUuid: 'm', apiMessageId: 'msg_1', blockIndex: 0, block: { type: 'text', text: 'hi' }, model: 'm', supersedes: [], aborted: false, userMessageUuids: [] },
        'user.message': { messageUuid: 'u', content: 'hi', isReplay: true, isSynthetic: false, origin: 'human', bash: { part: 'output', stdout: 'x', stderr: '', exitCode: 0 } },
        'tool.use': { toolUseId: 't', toolName: 'Bash', input: { command: 'ls' }, apiMessageId: null, messageUuid: null },
        'tool.safeguard': { toolUseId: 't', verdict: 'not_flagged', lane: 'server' },
        'tool.result': { toolUseId: 't', content: [{ type: 'text', text: 'x' }], isError: false, structured: null, spillPath: null, denial: 'user-rejected', safeguard: 'not_flagged', messageUuid: null },
        'tool.progress': { toolUseId: 't', toolName: 'Task', elapsedSeconds: 3, taskId: 'task', heartbeat: false },
        'hook.started': { hookId: 'h', hookName: 'n', hookEvent: 'PreToolUse' },
        'hook.finished': { hookId: 'h', hookName: 'n', hookEvent: 'PreToolUse', outcome: 'success', exitCode: 0, stdout: '', stderr: '' },
        'hook.callback_requested': { requestId: 'r', callbackId: 'cb', hookEvent: 'PreToolUse', toolUseId: 't', input: {} },
        'hook.callback_resolved': { requestId: 'r', callbackId: 'cb', response: {} },
        'permission.requested': { requestId: 'r', toolUseId: 't', toolName: 'Bash', displayName: null, input: {}, description: null, decisionReasonType: null, suggestions: [], blockedPath: null },
        'permission.resolved': { requestId: 'r', toolUseId: 't', behavior: 'allow', message: null, updatedInput: null, updatedPermissions: [], resolvedBy: 'user' },
        'question.requested': { requestId: 'r', toolUseId: 't', questions: [{ question: 'q', header: 'h', options: [{ label: 'a', description: null, preview: null }], multiSelect: false }] },
        'question.answered': { requestId: 'r', toolUseId: 't', answers: { q: 'a' } },
        'plan.requested': { requestId: 'r', toolUseId: 't', plan: '# plan', input: {} },
        'plan.resolved': { requestId: 'r', toolUseId: 't', outcome: 'implement', feedback: null },
        'dialog.requested': { requestId: 'r', dialogKind: 'sandbox', payload: {}, toolUseId: null },
        'dialog.resolved': { requestId: 'r', behavior: 'completed', result: {} },
        'elicitation.requested': { requestId: 'r', mcpServerName: 'srv', elicitationId: null, mode: 'form', payload: {} },
        'elicitation.resolved': { requestId: 'r', action: 'accept', content: {} },
        'subagent.started': { taskId: 'task', toolUseId: 't', description: 'd', subagentType: null, isBackground: false, spawnDepth: 1, prompt: null },
        'subagent.progress': { taskId: 'task', description: 'd', usage: { totalTokens: 1, toolUses: 1, durationMs: 1 }, lastToolName: null, summary: null },
        'subagent.finished': { taskId: 'task', status: 'completed', summary: null, outputFile: null, reason: null },
        'subagent.message': { direction: 'to_child', fromAgentId: null, toAgentId: 'agent', text: 'hi' },
        'task.started': { taskId: 'task', toolUseId: null, taskType: 'local_agent', description: 'd', isBackground: true, workflowName: null },
        'task.updated': { taskId: 'task', patch: { status: 'completed', endTime: 1 } },
        'task.notification': { taskId: 'task', toolUseId: null, status: 'completed', summary: 's', outputFile: null, reason: null },
        'tasks.snapshot': { tasks: [{ taskId: 'task', taskType: 'local_agent', description: 'd', ambient: false }] },
        'workflow.progress': { taskId: 'task', workflowName: 'wf', progress: { phase: 1 } },
        'boundary.compaction': { trigger: 'auto', preTokens: 100, postTokens: 10, logicalParentUuid: null, historical: false },
        'boundary.reset': { newConversationId: 'c2', trigger: null },
        'boundary.retraction': { retractedMessageUuids: ['m'], reason: 'refusal', fallbackModel: null },
        'boundary.rewind': { targetMessageUuid: 'm', precedingAssistantUuid: null, prefillText: null },
        'usage.sample': { costUsd: 0.1, usage: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: 0 }, modelUsage: {}, source: 'result' },
        'context.sample': { totalTokens: 1, maxTokens: 2, percentage: 50, autoCompactThreshold: null, isAutoCompactEnabled: true, model: 'm' },
        'error.raised': { scope: 'turn', message: 'boom', code: null, toolUseId: null, taskId: null, requestId: null },
        'api.retry': { attempt: 1, maxRetries: 3, retryDelayMs: 500, errorStatus: 529, error: 'overloaded' },
        'session.reconnect': { phase: 'reconnected', attempt: 2, maxAttempts: null, trigger: 'host_restart', reason: null },
        'notice.posted': { level: 'info', text: 'hi', key: null },
        'process.exited': { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0 },
        'frame.unknown': { frameType: 'wibble', subtype: null },
      };
      expect(Object.keys(samples).sort()).toEqual([...EVENT_KINDS].sort());
      for (const [kind, payload] of Object.entries(samples)) {
        const event = { ...base, kind, ...payload };
        const result = SessionEventSchema.safeParse(event);
        expect(result.success, `${kind}: ${result.success ? '' : z.prettifyError(result.error)}`).toBe(true);
        if (result.success) expect(result.data).toEqual(event);
      }
    });

    it('rejects an unknown kind and wrong-typed payload fields', () => {
      expect(SessionEventSchema.safeParse({ ...base, kind: 'tool.exploded' }).success).toBe(false);
      expect(SessionEventSchema.safeParse({ ...base, kind: 'turn.started', userMessageUuid: 5, origin: null }).success).toBe(false);
      expect(SessionEventSchema.safeParse({ ...base, kind: 'user.message', messageUuid: null, content: 'x', isReplay: false, isSynthetic: false, origin: null, bash: { part: 'input' } }).success).toBe(false);
      expect(SessionEventSchema.safeParse({ ...base, kind: 'process.exited', code: null, signal: null, reason: 'meteor', lostAttentionCount: 0 }).success).toBe(false);
    });

    it('brands the identifiers on parse', () => {
      const event: SessionEvent = SessionEventSchema.parse(toolResult({}));
      expect(event.sessionId).toBe('s1');
      expect(SessionEventSchema.safeParse(toolResult({ toolUseId: '' })).success).toBe(false);
    });
  });

  describe('session record', () => {
    it('accepts a well-formed record', () => {
      expect(record().permissionMode).toEqual({ requested: 'default', effective: 'default', refusal: null });
    });

    it('rejects a silent downgrade and accepts the same downgrade with its refusal code', () => {
      const downgraded = { ...record(), permissionMode: { requested: 'auto', effective: 'default', refusal: null } };
      const result = SessionRecordSchema.safeParse(downgraded);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toContain('permissionMode.refusal');
      expect(SessionRecordSchema.safeParse({ ...downgraded, permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_model' } }).success).toBe(true);
    });

    it('rejects a refusal that did not happen and accepts the honoured request', () => {
      expect(SessionRecordSchema.safeParse({ ...record(), permissionMode: { requested: 'auto', effective: 'auto', refusal: 'auto_mode_model' } }).success).toBe(false);
      expect(SessionRecordSchema.safeParse({ ...record(), permissionMode: { requested: 'auto', effective: 'auto', refusal: null } }).success).toBe(true);
    });

    it('rejects an unknown refusal code, an unknown mode and an unknown holder', () => {
      expect(SessionRecordSchema.safeParse({ ...record(), permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_weather' } }).success).toBe(false);
      expect(SessionRecordSchema.safeParse({ ...record(), permissionMode: { requested: 'yolo', effective: 'yolo', refusal: null } }).success).toBe(false);
      expect(SessionRecordSchema.safeParse({ ...record(), holder: { kind: 'ghost' } }).success).toBe(false);
      expect(SessionRecordSchema.safeParse({ ...record(), holder: { kind: 'terminal', pid: 42 } }).success).toBe(true);
      expect(SessionRecordSchema.safeParse({ ...record(), holder: { kind: 'background_job', pid: null, jobId: 'j' } }).success).toBe(true);
      expect(SessionRecordSchema.safeParse({ ...record(), title: { text: 't', source: 'oracle' } }).success).toBe(false);
      expect(SessionRecordSchema.safeParse({ ...record(), extra: true }).success).toBe(false);
    });
  });

  describe('attention item', () => {
    const item = (overrides: Record<string, unknown> = {}): unknown => ({
      id: 'att-1',
      appSessionId: 'app-1',
      sessionId: 's1',
      kind: 'permission',
      request: { requestId: 'r', toolUseId: 't', taskId: null, agentId: null },
      summary: 'Bash wants to run ls',
      createdAt: '2026-09-28T10:00:00.000Z',
      state: 'pending',
      stateChangedAt: '2026-09-28T10:00:00.000Z',
      expiresAt: null,
      ...overrides,
    });

    it('accepts every kind including auto_mode_unavailable, and every state', () => {
      for (const kind of ATTENTION_KINDS) expect(AttentionItemSchema.safeParse(item({ kind })).success, kind).toBe(true);
      const parsed: AttentionItem = AttentionItemSchema.parse(item({ kind: 'auto_mode_unavailable', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } }));
      expect(parsed.kind).toBe('auto_mode_unavailable');
      for (const state of ATTENTION_STATES) expect(AttentionItemSchema.safeParse(item({ state })).success, state).toBe(true);
      expect(AttentionItemSchema.safeParse(item({ kind: 'held_peer_message', expiresAt: '2026-09-28T11:00:00.000Z' })).success).toBe(true);
    });

    it('rejects an unknown kind, an unknown state and a stray field', () => {
      expect(AttentionItemSchema.safeParse(item({ kind: 'nudge' })).success).toBe(false);
      expect(AttentionItemSchema.safeParse(item({ state: 'snoozed' })).success).toBe(false);
      expect(AttentionItemSchema.safeParse(item({ extra: 1 })).success).toBe(false);
      expect(AttentionItemSchema.safeParse(item({ request: { requestId: 'r' } })).success).toBe(false);
    });
  });
});
