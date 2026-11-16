// UX wave U2b (M6, the architect's addition; the U2b document, §E's known differences and the coordinator's grammar
// ruling: MAWS does not follow the mod's reading of malformed marks at this landing). Whatever MAWS draws for a text
// whose marks are malformed, it stores the text and hands it to the mod byte for byte: no step on the way repairs a
// mark. Each text goes the whole event path with invented words: the engine's stdout lines parsed as the transport
// parses them, written by the real journal writer (the store of record: `<launchId>.jsonl`, read back by the reader),
// normalised from the rows the journal holds, reduced and derived by the renderer's transcript model, and asked of the
// mod through `assistantInput` (the props of the `AssistantMessage` ask for that text block). The stream is cut inside
// a tag, so a delta boundary falls mid-mark.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { assistantInput } from '../renderer/src/transcript/surface/adapters';
import { rowsOf, withAllExpanded } from '../renderer/src/transcript/model/derive';
import { applyEvents, createState } from '../renderer/src/transcript/model/reduce';
import { JOURNAL_MAX_BYTES, JournalReader, JournalWriter } from './journal';
import { Normalizer } from './normalizer';

const MALFORMED = {
  'a mark left open in a completed text': 'Checked the tree. <message>The fixtures are ready and the suite',
  'a stray closing tag': 'The fixtures are ready.</message> Next comes the suite.',
  'crossing marks': '<message>One <insight>two</message> three</insight>',
} as const;

const SESSION = 'sess-u2b-marks';
const initFrame = { type: 'system', subtype: 'init', cwd: '/w', session_id: SESSION, tools: ['Bash'], mcp_servers: [], model: 'claude-haiku-4-5', permissionMode: 'default', slash_commands: [], claude_code_version: '2.1.322', output_style: 'default', uuid: 'i-1' };
const stream = (event: Record<string, unknown>, uuid: string) => ({ type: 'stream_event', event, session_id: SESSION, parent_tool_use_id: null, uuid });
// The engine's frames for one turn whose reply is `text`, streamed in two deltas cut at `cut`, then whole
function engineFrames(text: string, cut: number): unknown[] {
  const id = 'msg_01U2bMarks';
  return [
    { type: 'command_lifecycle', command_uuid: 'u-1', state: 'started', uuid: 's-u-1', session_id: SESSION },
    initFrame,
    stream({ type: 'message_start', message: { id, model: 'claude-haiku-4-5' } }, 'ms'),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'cs'),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, cut) } }, 'cd1'),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(cut) } }, 'cd2'),
    { type: 'assistant', message: { id, role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null, session_id: SESSION, uuid: 'a-1' },
    stream({ type: 'content_block_stop', index: 0 }, 'cx'),
    stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }, 'md'),
    stream({ type: 'message_stop' }, 'mx'),
    { type: 'result', subtype: 'success', session_id: SESSION, is_error: false, duration_ms: 10, duration_api_ms: 8, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], result: text, uuid: 'r-1' },
  ];
}
const prompt = { type: 'user', uuid: 'u-1', message: { role: 'user', content: 'Report on the fixtures.' }, parent_tool_use_id: null, origin: { kind: 'human' } };

let dir = '';
afterEach(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
  dir = '';
});

async function journalled(text: string): Promise<{ rows: JournalRow[]; file: string }> {
  dir = mkdtempSync(join(tmpdir(), 'maws-u2b-marks-'));
  const writer = new JournalWriter(join(dir, 'app-marks'), 'LAUNCHMK', { maxBytes: JOURNAL_MAX_BYTES });
  writer.row('out', prompt);
  // the engine's stdout lines, parsed as the transport parses a line (JSON.parse), then journalled before normalising
  for (const frame of engineFrames(text, text.indexOf('</') > 0 ? text.indexOf('</') + 3 : text.indexOf('<') + 3)) writer.row('in', JSON.parse(JSON.stringify(frame)));
  await writer.close();
  const rows: JournalRow[] = [];
  for await (const row of JournalReader.rows(writer.path)) rows.push(row);
  return { rows, file: readFileSync(writer.path, 'utf8') };
}
const textBlocks = (row: JournalRow): string[] => {
  const frame = row.frame as { type?: string; message?: { content?: { type: string; text?: string }[] } };
  return frame.type === 'assistant' ? (frame.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '') : [];
};

describe('a text whose marks are malformed is stored and handed to the mod byte for byte (U2b, M6)', () => {
  it.each(Object.entries(MALFORMED))('%s: the journal, the events, the store and the AssistantMessage ask hold the engine’s text exactly', async (_name, text) => {
    const { rows, file } = await journalled(text);
    // stored: the journal's assistant frame, as the file holds it and as the reader gives it back
    expect(file).toContain(JSON.stringify(text));
    expect(rows.flatMap(textBlocks)).toEqual([text]);
    // normalised from the journal's rows: the streamed pieces join to the text, and the completed block is the text
    const n = new Normalizer({ appSessionId: 'app-marks' as AppSessionId, launchId: 'LAUNCHMK', sessionId: null });
    const events: SessionEvent[] = rows.flatMap((row) => n.push(row));
    for (const e of events) SessionEventSchema.parse(e);
    const deltas = events.filter((e): e is Extract<SessionEvent, { kind: 'assistant.block.delta' }> => e.kind === 'assistant.block.delta');
    expect(deltas.map((e) => e.textDelta).join('')).toBe(text);
    const completed = events.filter((e): e is Extract<SessionEvent, { kind: 'assistant.block.complete' }> => e.kind === 'assistant.block.complete');
    expect(completed.map((e) => (e.block.type === 'text' ? e.block.text : null))).toEqual([text]);
    // the renderer's store, mid-stream (both deltas, before the block completes) and after the turn
    const live = deltas.at(-1)!;
    for (const upTo of [events.indexOf(live) + 1, events.length]) {
      const state = withAllExpanded(applyEvents(createState(null, null), events.slice(0, upTo)));
      const turn = [...state.turns.values()].at(-1)!;
      expect([...turn.live.values()].filter((b) => b.blockType === 'text').map((b) => b.sourceText)).toEqual([text]);
      // the mod's route: the props MAWS sends on the AssistantMessage ask for that text block
      const asks = rowsOf(state).flatMap((row) => (row.kind === 'assistant_text' ? [assistantInput(row, turn)?.props.text ?? null] : []));
      expect(asks).toEqual([text]);
    }
  });
});
