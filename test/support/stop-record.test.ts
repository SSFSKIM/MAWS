// UX wave U1b, probe 9b: what `e2e:lane-a`'s two Stop scenes stage from the records (e2e/support/stop-record.ts), checked
// on both records here, where a run reaches it without an Electron: the bridge's events, its answer to the interrupt,
// and the kinds and order of the file's rows before the Stop, after it, and after the answer.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stopRecord, type FileRow } from '../../e2e/support/stop-record';

const ROOT = join(__dirname, '../..');

// A row as its kind: `user:<content>[:<origin>][:meta]`, `assistant:<blocks>`, `system:<subtype>`
function shape(row: FileRow): string {
  const content = row.message?.content;
  const blocks = Array.isArray(content) ? (content as { type: string; name?: string }[]) : [];
  if (row.type === 'system') return `system:${row.subtype}`;
  if (row.type === 'assistant') return `assistant:${blocks.map((b) => (b.type === 'tool_use' ? `tool_use:${b.name}` : b.type)).join(',')}`;
  const kind = typeof content === 'string' ? 'text' : blocks.map((b) => b.type).join(',');
  return ['user', kind, ...(row.origin?.kind ? [row.origin.kind] : []), ...(row.isMeta === true ? ['meta'] : [])].join(':');
}

const BEFORE = ['user:text:human', 'assistant:tool_use:mcp__sminos__AskUserQuestion', 'user:tool_result', 'assistant:tool_use:Bash'];
const AFTER_STOP = ['user:text:plugin:meta', 'user:text:plugin:meta', 'system:informational', 'user:tool_result'];

describe('the Stop scenes’ staging from the probe 9b records (u1b-askwait-stop-*-r2)', () => {
  it.each(['answer', 'dismiss'] as const)('%s: the raised question, the turn’s start and its aborted end, the interrupt’s answer, and the rows before and after the Stop', (then) => {
    const record = stopRecord(then, ROOT);
    expect(record.raised).toMatchObject({ request: record.call, tool: 'mcp__sminos__AskUserQuestion', async: true, agentId: null });
    expect(record.raised).not.toHaveProperty('type');
    expect(record.question).toMatchObject({ question: expect.any(String), header: expect.any(String) });
    expect(record.turn).toMatchObject({ type: 'turn', phase: 'start', turnId: expect.any(String) });
    expect(record.aborted).toMatchObject({ type: 'turn', phase: 'complete', reason: 'aborted', turnId: record.turn.turnId });
    for (const event of [record.turn, record.aborted]) for (const key of ['ms', 'n', 't']) expect(event).not.toHaveProperty(key);
    expect(record.interrupted).toMatchObject({ ok: true, result: { turnId: record.turn.turnId, stopped: [expect.any(String)], running: [] } });
    expect(record.before.map(shape)).toEqual(BEFORE);
    expect(record.afterStop.map(shape)).toEqual(AFTER_STOP);
  });

  it('answer: settled answered by MAWS, then the plugin’s delivery opening a turn, its reply and the turn’s end; the delivery quotes the answer', () => {
    const record = stopRecord('answer', ROOT);
    expect(record.settled).toMatchObject({ request: record.call, winner: 'web', outcome: 'answered', by: 'maws' });
    expect(record.afterAnswer.map(shape)).toEqual(['user:text:plugin', 'assistant:text', 'system:stop_hook_summary', 'system:turn_duration']);
    expect(record.answer).toBe('Mango');
  });

  it('dismiss: settled withdrawn by MAWS, and no row after the Stop’s', () => {
    const record = stopRecord('dismiss', ROOT);
    expect(record.settled).toMatchObject({ request: record.call, winner: 'web', outcome: 'withdrawn', by: 'maws' });
    expect(record.afterAnswer).toEqual([]);
    expect(record.answer).toBeNull();
  });
});
