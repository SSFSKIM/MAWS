// Event builders for the model's unit tests: X1 events with the base fields filled and a clock that advances per
// event, so a test states only the payload that matters. Not a test file itself.
import type { SessionEvent } from '@shared/graph/events';
import type { ApiMessageId, EventId, MessageUuid, ParentToolUseId, RequestId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';

type Payload<K extends SessionEvent['kind']> = Omit<Extract<SessionEvent, { kind: K }>, 'id' | 'sessionId' | 'at' | 'seq' | 'agentId' | 'parentToolUseId' | 'kind'>;

export const SESSION = 'test-session' as SessionId;
export const USAGE = { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null };
export const MODEL = 'claude-test';

export const uuid = (s: string) => s as MessageUuid;
export const api = (s: string) => s as ApiMessageId;
export const tool = (s: string) => s as ToolUseId;
export const task = (s: string) => s as TaskId;
export const request = (s: string) => s as RequestId;
export const parent = (s: string) => s as ParentToolUseId;

export interface Builder {
  events: SessionEvent[];
  at: number;
  emit<K extends SessionEvent['kind']>(kind: K, payload: Payload<K>, options?: { parentToolUseId?: ParentToolUseId; atMs?: number; id?: string }): Extract<SessionEvent, { kind: K }>;
  tick(ms: number): void;
  // Conveniences for the common shapes.
  turn(uuidText: string, text?: string, origin?: string | null): void;
  end(uuids: string[], options?: Partial<Payload<'turn.ended'>>): void;
  text(apiId: string, index: number, text: string, options?: Partial<Payload<'assistant.block.complete'>>): void;
  thinking(apiId: string, index: number, text: string): void;
  toolUse(id: string, name: string, input: Record<string, unknown>, apiId?: string, index?: number): void;
  result(id: string, content: string | Record<string, unknown>[], options?: Partial<Payload<'tool.result'>>): void;
}

export function builder(start = '2026-09-28T10:00:00.000Z'): Builder {
  const events: SessionEvent[] = [];
  const b: Builder = {
    events,
    at: Date.parse(start),
    emit(kind, payload, options = {}) {
      const seq = events.length;
      const event = {
        id: (options.id ?? `e${seq}`) as EventId, sessionId: SESSION, at: new Date(options.atMs ?? b.at).toISOString(), seq, agentId: null,
        parentToolUseId: options.parentToolUseId ?? null, kind, ...payload,
      } as unknown as SessionEvent;
      events.push(event);
      b.at += 100;
      return event as never;
    },
    tick(ms) {
      b.at += ms;
    },
    turn(u, text = `prompt ${u}`, origin = 'human') {
      b.emit('turn.started', { userMessageUuid: uuid(u), origin });
      b.emit('user.message', { messageUuid: uuid(u), content: text, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    },
    end(uuids, options = {}) {
      b.emit('turn.ended', {
        result: 'success', isError: false, terminalReason: 'completed', resultText: null, durationMs: 1000, numTurns: 1, costUsd: 0.01, usage: USAGE,
        permissionDenials: [], errors: [], userMessageUuids: uuids.map(uuid), origin: 'human', resultIndex: null, isEchoReceipt: false, ...options,
      });
    },
    text(apiId, index, text, options = {}) {
      b.emit('assistant.block.complete', {
        messageUuid: uuid(`${apiId}-u${index}`), apiMessageId: api(apiId), blockIndex: index, block: { type: 'text', text }, model: MODEL,
        supersedes: [], aborted: false, userMessageUuids: [], ...options,
      });
    },
    thinking(apiId, index, text) {
      b.emit('assistant.block.complete', {
        messageUuid: uuid(`${apiId}-u${index}`), apiMessageId: api(apiId), blockIndex: index, block: { type: 'thinking', thinking: text, signature: '' }, model: MODEL,
        supersedes: [], aborted: false, userMessageUuids: [],
      });
    },
    toolUse(id, name, input, apiId = `msg-${id}`, index = 0) {
      b.emit('assistant.block.complete', {
        messageUuid: uuid(`${apiId}-u${index}`), apiMessageId: api(apiId), blockIndex: index, block: { type: 'tool_use', id, name, input }, model: MODEL,
        supersedes: [], aborted: false, userMessageUuids: [],
      });
      b.emit('tool.use', { toolUseId: tool(id), toolName: name, input, apiMessageId: api(apiId), messageUuid: uuid(`${apiId}-u${index}`) });
    },
    result(id, content, options = {}) {
      b.emit('tool.result', {
        toolUseId: tool(id), content: content as never, isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated',
        messageUuid: uuid(`${id}-result`), ...options,
      });
    },
  };
  return b;
}

export const BASH_RESULT = (stdout: string) => ({ stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
