import { describe, expect, it } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { parseTranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../../../engine-host/fs/backfill';
import { Normalizer } from '../../../../engine-host/normalizer';
import { applyEvents, createState } from '../model/reduce';
import { rowsOf, withAllExpanded } from '../model/derive';
import { assistantInput } from './adapters';
import { sittingSeed } from '../../../../../test/support/r3-surface';

const id = '6c90fab1-575c-4e47-a232-8a8df83076ec' as SessionId;
const records = sittingSeed({ repo: '/scratch/doperpowers', engineId: id });
const messages = records.filter((r) => r.type === 'assistant').flatMap((r) => {
  const message = r.message as { content: { type: string; text?: string }[] };
  return message.content.filter((b) => b.type === 'text').map((b) => ({ uuid: r.uuid, text: b.text! }));
});

describe('owner sitting through MAWS normalization and assistant adapter', () => {
  it.each([['disk', false], ['stream', false], ['disk', true], ['stream', true]] as const)('%s preserves engine text and opening bullets (display headers=%s)', (path, headers) => {
    const ctx = createBackfillContext({ sessionId: id, agent: null });
    const normalizer = new Normalizer({ appSessionId: 'sitting' as AppSessionId, launchId: 'sitting', sessionId: id });
    let lastUserUuid: unknown;
    const input = sittingSeed({ repo: '/scratch/doperpowers', engineId: id }, path === 'stream', headers);
    const expected = headers ? input.filter((r) => r.type === 'assistant').flatMap((r) => (r.message as { content: { type: string; text?: string }[] }).content.filter((b) => b.type === 'text').map((b) => ({ uuid: r.uuid, text: b.text! }))) : messages;
    const events = input.flatMap((r, seq) => {
      if (path === 'disk') return recordToEvents(parseTranscriptRecord(r), ctx);
      const content = (r.message as { content?: unknown } | undefined)?.content;
      if (r.type === 'user' && (typeof content === 'string' || Array.isArray(content) && content.some((b: { type: string }) => b.type === 'text'))) lastUserUuid = r.uuid;
      if (r.subtype === 'turn_duration') return normalizer.push({ seq, direction: 'in', at: String(r.timestamp), frame: { type: 'result', subtype: 'success', session_id: id, is_error: false, duration_ms: r.durationMs, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], user_message_uuids: [lastUserUuid] } });
      if (r.type !== 'user' && r.type !== 'assistant') return [];
      return normalizer.push({ seq, direction: 'in', at: String(r.timestamp), frame: { type: r.type, session_id: id, uuid: r.uuid, parent_tool_use_id: null, message: r.message, ...(r.type === 'user' && { isReplay: true, origin: { kind: 'human' } }) } });
    });
    const state = withAllExpanded(applyEvents(createState(null, null), events));
    const texts = rowsOf(state).filter((r) => r.kind === 'assistant_text');
    expect(texts).toHaveLength(3);
    expect(texts.map((row) => assistantInput(row, state.turns.get(row.turnId!)))).toEqual(expected.map(({ uuid, text }) => ({ instanceId: uuid, props: { text, isFirstOfReply: true } })));
    if (!headers) expect(texts.map((r) => r.markdown.length)).toEqual([256, 87, 2920]);
    else expect(texts.every((r) => !r.markdown.includes('\u001b'))).toBe(true);
    expect(texts[1].turnId).toBe(texts[2].turnId);
    expect(texts[0].turnId).not.toBe(texts[1].turnId);
  });
});
