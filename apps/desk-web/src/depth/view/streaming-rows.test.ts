import { parse } from '@shared/owner/to-human-parser';
import { describe, expect, it } from 'vitest';
import type { StreamBlock } from '../stream/layer';
import { streamingRows } from './streaming-rows';

const block = (index: number, kind: StreamBlock['kind'], text: string): StreamBlock => ({ turnId: 't1', agentId: null, step: 0, index, kind, text, toolName: null, toolUseId: null, settledBy: null });
const call = (index: number, name: string, input: string, id = `toolu_${index}`): StreamBlock => ({ ...block(index, 'tool', input), toolName: name, toolUseId: id });
const since = () => '2026-10-15T00:00:00.000Z';

describe('the streaming rows', () => {
  it('draws a live answer as its text, live thinking as its label alone, and no tool input', () => {
    const rows = streamingRows([block(0, 'thinking', 'Weigh it.'), block(1, 'text', 'Two.'), block(2, 'tool', '{"a":1}'), call(3, 'Bash', '{"command": "ls')], since);
    expect(rows.map((row) => [row.kind, row.kind === 'thinking' ? row.text : row.kind === 'assistant_text' ? row.markdown : null])).toEqual([
      ['thinking', ''],
      ['assistant_text', 'Two.'],
    ]);
    expect(rows[0]).toMatchObject({ live: true });
  });

  it("hands a live answer's open `<message>` to MAWS's row closed, so its Presenter draws the span, never the tag", () => {
    const [row] = streamingRows([block(0, 'text', '<message>\nBoth subagents rep')], since);
    expect(row.kind === 'assistant_text' && parse(row.markdown).map((part) => [part.kind, part.text])).toEqual([['to-human', 'Both subagents rep']]);
  });

  it("draws a message tool's call, MAWS's or the to-human plugin's, as the message MAWS draws for it, its text as far as it has come", () => {
    const rows = streamingRows([call(0, 'mcp__maws__message', '{"text": "Stage 1 is done.\\nStage 2 st'), call(1, 'mcp__to-human__message', '{"text": "Both'), call(2, 'mcp__to-human__message', '{"te')], since, { turn: 'turn-9' as never });
    expect(rows).toEqual([
      { id: 'desk-stream:t1:main:0:0', turnId: 'turn-9', at: since(), kind: 'to_human', toolUseId: 'toolu_0', text: 'Stage 1 is done.\nStage 2 st', pending: true },
      { id: 'desk-stream:t1:main:0:1', turnId: 'turn-9', at: since(), kind: 'to_human', toolUseId: 'toolu_1', text: 'Both', pending: true },
    ]); // the third has no text yet
  });
});
