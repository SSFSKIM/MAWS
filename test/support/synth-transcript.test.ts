import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { STREAM_BATCH_INTERVAL_MS, synthesise } from './synth-transcript';

const byKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) =>
  events.filter((event): event is Extract<SessionEvent, { kind: K }> => event.kind === kind);

const blockText = (event: Extract<SessionEvent, { kind: 'assistant.block.complete' }>) =>
  String((event.block as { text?: string; thinking?: string }).text ?? (event.block as { thinking?: string }).thinking ?? '');

describe('synthetic transcript', () => {
  const events = synthesise({ turns: 500, seed: 1, streamLast: true });

  it('is deterministic for a seed and differs across seeds', () => {
    expect(synthesise({ turns: 30, seed: 7 })).toEqual(synthesise({ turns: 30, seed: 7 }));
    expect(synthesise({ turns: 30, seed: 7 })).not.toEqual(synthesise({ turns: 30, seed: 8 }));
  });

  it('emits valid X1 events only, with unique ids and non-decreasing timestamps', () => {
    for (const event of events) SessionEventSchema.parse(event);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    const times = events.map((event) => Date.parse(event.at));
    expect(times.every((time, i) => i === 0 || time >= times[i - 1])).toBe(true);
  });

  it('is a five-hundred-turn transcript of about fifty thousand events', () => {
    expect(byKind(events, 'turn.started')).toHaveLength(500);
    expect(byKind(events, 'turn.ended')).toHaveLength(500);
    expect(events.length).toBeGreaterThanOrEqual(45_000);
    expect(events.length).toBeLessThanOrEqual(60_000);
  });

  it('carries nested child activity every tenth turn, never at the top level', () => {
    const starts = byKind(events, 'subagent.started');
    expect(starts).toHaveLength(100); // two agents in each of fifty turns
    const child = events.filter((event) => event.parentToolUseId !== null);
    expect(child.length).toBeGreaterThanOrEqual(50 * 2 * 5);
    expect(child.every((event) => event.agentId !== null)).toBe(true);
    const parents = new Set(starts.map((start) => start.toolUseId));
    expect(child.every((event) => parents.has(event.parentToolUseId as never))).toBe(true);
  });

  it('covers every tool category, receipts, denials, compactions and time gaps', () => {
    const names = new Set(byKind(events, 'tool.use').map((use) => use.toolName.replace(/^mcp__.*/, 'mcp__')));
    for (const name of ['mcp__', 'Skill', 'ToolSearch', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'TodoWrite', 'Agent']) {
      expect(names, name).toContain(name);
    }
    const edits = byKind(events, 'tool.result').filter((result) => (result.structured as { structuredPatch?: unknown } | null)?.structuredPatch);
    expect(edits.length).toBeGreaterThanOrEqual(100); // a receipt at least every fifth turn
    expect(byKind(events, 'tool.result').filter((result) => result.denial === 'permission-rule')).toHaveLength(12); // every fortieth turn
    expect(byKind(events, 'boundary.compaction')).toHaveLength(2); // every two hundredth turn
    const starts = byKind(events, 'turn.started').map((event) => Date.parse(event.at));
    const hourGaps = starts.filter((time, i) => i > 0 && time - starts[i - 1] >= 60 * 60_000).length;
    expect(hourGaps).toBeGreaterThanOrEqual(20);
  });

  it('writes answers with headings, lists, tables, code in four languages, math every fifteenth turn and a diagram every twenty-fifth', () => {
    const answers = byKind(events, 'assistant.block.complete').filter((event) => event.block.type === 'text').map(blockText).join('\n');
    for (const fence of ['```ts', '```py', '```json', '```sh']) expect(answers).toContain(fence);
    expect(answers).toMatch(/^## /m);
    expect(answers).toMatch(/^- /m);
    expect(answers).toMatch(/^\| .* \|$/m);
    expect(answers.match(/^```mermaid$/gm)).toHaveLength(20);
    expect((answers.match(/^\$\$$/gm) ?? []).length).toBe(2 * 33); // opening and closing delimiters, turns 15, 30, …, 495
  });

  it('streams the last answer as deltas one batch interval apart, completed by the same text and the turn end', () => {
    const lastStart = events.findLastIndex((event) => event.kind === 'turn.started');
    const tail = events.slice(lastStart);
    const answerDeltas = byKind(tail, 'assistant.block.delta').filter((delta) => delta.textDelta !== null);
    const lastApi = answerDeltas.at(-1)!.apiMessageId;
    const streamed = answerDeltas.filter((delta) => delta.apiMessageId === lastApi);
    expect(streamed.length).toBeGreaterThanOrEqual(2_000); // over half a minute at sixty batches a second
    const gaps = streamed.slice(1).map((delta, i) => Date.parse(delta.at) - Date.parse(streamed[i].at));
    expect(gaps.every((gap) => Math.abs(gap - STREAM_BATCH_INTERVAL_MS) <= 1)).toBe(true);
    const complete = byKind(tail, 'assistant.block.complete').find((event) => event.apiMessageId === lastApi && event.block.type === 'text')!;
    expect(streamed.map((delta) => delta.textDelta).join('')).toBe(blockText(complete));
    expect(blockText(complete)).toMatch(/^```mermaid$/m);
    expect(events.at(-1)!.kind).toBe('turn.ended');
  });

  it('streams history blocks as deltas too, as a live session delivers them', () => {
    const firstTurn = events.slice(0, events.findIndex((event) => event.kind === 'turn.ended') + 1);
    const deltas = byKind(firstTurn, 'assistant.block.delta');
    for (const complete of byKind(firstTurn, 'assistant.block.complete').filter((event) => event.block.type !== 'tool_use')) {
      const own = deltas.filter((delta) => delta.apiMessageId === complete.apiMessageId && delta.blockIndex === complete.blockIndex);
      expect(own.map((delta) => delta.textDelta ?? delta.thinkingDelta).join('')).toBe(blockText(complete));
    }
  });
});
