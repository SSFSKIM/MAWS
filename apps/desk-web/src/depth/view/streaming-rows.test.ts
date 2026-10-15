import { describe, expect, it } from 'vitest';
import type { StreamBlock } from '../stream/layer';
import { streamingRows } from './streaming-rows';

const block = (index: number, kind: StreamBlock['kind'], text: string): StreamBlock => ({ turnId: 't1', agentId: null, step: 0, index, kind, text, toolName: null, settledBy: null });
const since = () => '2026-10-15T00:00:00.000Z';

describe('the streaming rows', () => {
  it('draws a live answer as its text, live thinking as its label alone, and no tool input', () => {
    const rows = streamingRows([block(0, 'thinking', 'Weigh it.'), block(1, 'text', 'Two.'), block(2, 'tool', '{"a":1}')], since);
    expect(rows.map((row) => [row.kind, row.kind === 'thinking' ? row.text : row.kind === 'assistant_text' ? row.markdown : null])).toEqual([
      ['thinking', ''],
      ['assistant_text', 'Two.'],
    ]);
    expect(rows[0]).toMatchObject({ live: true });
  });
});
