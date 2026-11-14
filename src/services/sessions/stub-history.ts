// UX wave U7b: an invented transcript for the stub source, given to one session a scene names (`MAWS_STUB_LONG_HISTORY`)
// so that its pane has something to scroll. A stub session otherwise has no history (stub-source.ts, `session.events`).
// Fixed length and content, with timestamps from a fixed start, so every launch draws the same rows.
import type { SessionEvent } from '@shared/graph/events';
import type { ApiMessageId, EventId, MessageUuid, SessionId } from '@shared/graph/ids';

// Long enough that the transcript overflows the smallest window a scene over it uses (1360 by 760).
export const LONG_HISTORY_TURNS = 40;

const START = Date.parse('2026-09-28T08:00:00.000Z');
const USAGE = { inputTokens: 1200, outputTokens: 180, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null };

type Payload<K extends SessionEvent['kind']> = Omit<Extract<SessionEvent, { kind: K }>, 'id' | 'sessionId' | 'at' | 'seq' | 'agentId' | 'parentToolUseId' | 'kind'>;

export function inventedHistory(sessionId: SessionId): SessionEvent[] {
  const events: SessionEvent[] = [];
  const push = <K extends SessionEvent['kind']>(kind: K, at: number, payload: Payload<K>) => {
    const seq = events.length + 1;
    events.push({ id: `long-${seq}` as EventId, sessionId, at: new Date(at).toISOString(), seq, agentId: null, parentToolUseId: null, kind, ...payload } as unknown as SessionEvent);
  };
  for (let n = 1; n <= LONG_HISTORY_TURNS; n += 1) {
    const at = START + n * 60_000;
    const user = `long-u${n}` as MessageUuid;
    const reply = `long-a${n}` as MessageUuid;
    const apiMessageId = `msg_long_${n}` as ApiMessageId;
    push('turn.started', at, { userMessageUuid: user, origin: 'human' });
    push('user.message', at, { messageUuid: user, content: `Step ${n}: read the next section of the charter and note what it asks of the shell.`, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    push('assistant.block.complete', at + 20_000, {
      messageUuid: reply, apiMessageId, blockIndex: 0, model: 'claude-opus-4-1',
      block: { type: 'text', text: `Section ${n} asks the shell to keep each session's place while the person moves between them. It names the transcript, the composer and the side surface as the parts that must come back as they were left, and it leaves the order of the strip to the person. Nothing in it changes the engine's wire.` },
      supersedes: [], aborted: false, userMessageUuids: [user],
    });
    push('turn.ended', at + 21_000, {
      result: 'success', isError: false, terminalReason: 'completed', resultText: null, durationMs: 21_000, numTurns: 1, costUsd: 0.02, usage: USAGE,
      permissionDenials: [], errors: [], userMessageUuids: [user], origin: 'human', resultIndex: null, isEchoReceipt: false,
    });
  }
  return events;
}
