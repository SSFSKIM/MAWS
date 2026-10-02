import { describe, expect, it } from 'vitest';
import { SessionEventSchema } from '@shared/graph/events';
import type { AppSessionId, SessionId, TaskId } from '@shared/graph/ids';
import { parseTranscriptRecord } from '@shared/wire/transcript';
import { loadJournal, loadSyntheticJournal } from '../../test/support/fixtures';
import { applyTaskEvents, emptyGraph } from '../renderer/src/tools/agents/model/task-graph';
import { rowsOf, withAllExpanded } from '../renderer/src/transcript/model/derive';
import { applyEvents, createState } from '../renderer/src/transcript/model/reduce';
import { createBackfillContext, recordToEvents } from './fs/backfill';
import { Normalizer } from './normalizer';

const normalizer = () => new Normalizer({ appSessionId: 'fidelity' as AppSessionId, launchId: 'fixture', sessionId: null });

describe('recorded normalizer fidelity regressions', () => {
  it('plan-outcomes seq 120 never counts a skipped safeguard as reviewed', () => {
    const n = normalizer();
    const events = loadJournal('pass3', 'plan-outcomes').flatMap((row) => n.push(row));
    for (const e of events) SessionEventSchema.parse(e);
    expect(events.find((e) => e.seq === 120 && e.kind === 'tool.safeguard')).toMatchObject({ verdict: 'skipped' });
    const state = applyEvents(createState(null, null), events);
    const rows = rowsOf(withAllExpanded(state));
    const cells = rows.flatMap((row) => row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []);
    expect(cells.find((cell) => cell.toolUseId === 'toolu_01MmVYiQCVuXfxjFDLabEtVL')?.classification.safeguard).toBe('skipped');
    expect(rows.filter((row) => row.kind === 'divider').map((row) => row.summary.safeguard)).toEqual([
      { reviewed: 0, flagged: 0, notEvaluated: 4 },
      { reviewed: 0, flagged: 0, notEvaluated: 2 },
      { reviewed: 0, flagged: 0, notEvaluated: 1 },
    ]);
  });

  it('subagent completion replaces the last progress totals with the final usage', () => {
    const n = normalizer();
    const events = loadJournal('pass1', 'subagent').flatMap((row) => n.push(row));
    const finished = events.find((e) => e.seq === 335 && e.kind === 'subagent.finished');
    expect(finished).toMatchObject({ usage: { totalTokens: 11515, toolUses: 1, durationMs: 2788 } });
    for (const e of events) SessionEventSchema.parse(e);
    const graph = applyTaskEvents(emptyGraph(), events);
    expect(graph.tasks.get('ad286defbc77bc090' as TaskId)?.usage).toEqual({ totalTokens: 11515, toolUses: 1, durationMs: 2788 });
    expect(graph.tasks.get('ae75ba6ce5d866acc' as TaskId)?.usage).toEqual({ totalTokens: 11524, toolUses: 1, durationMs: 2693 });
  });

  it('retains progress usage when a completion has no usage report', () => {
    const n = normalizer();
    const events = loadJournal('pass1', 'subagent').flatMap((row) => {
      const frame = row.frame as Record<string, unknown>;
      return n.push(frame.subtype === 'task_notification' ? { ...row, frame: { ...frame, usage: undefined } } : row);
    });
    const graph = applyTaskEvents(emptyGraph(), events);
    expect(graph.tasks.get('ad286defbc77bc090' as TaskId)?.usage).toEqual({ totalTokens: 10899, toolUses: 1, durationMs: 1436 });
    expect(events.find((e) => e.seq === 335 && e.kind === 'subagent.finished')).not.toHaveProperty('usage');
  });

  // The long-output fixture supplies persistedOutputPath. Remove it to exercise the notice-only route, using the
  // CLI 2.1.283 formatter (cli.pretty.js:316303–316317), including its wrapper and newline-delimited path.
  it.each(['plain', 'wrapped', 'blocks'] as const)('preserves a space-containing spill path from the %s notice in live and disk replay', (shape) => {
    const path = '/Users/owner/Library/Application Support/MAWS/tool-results/toolu_synth_long_2.txt';
    const notice = `Output too large (184KB). Full output saved to: ${path}\n\nPreview (first 2KB):\n[1/1200] compiling src/app.ts`;
    const text = shape === 'plain' ? notice : `<persisted-output>\n${notice}\n</persisted-output>`;
    const content = shape === 'blocks' ? [{ type: 'text', text }] : text;
    const journal = loadSyntheticJournal('long-output');
    const row = journal.find((row) => row.seq === 26)!;
    const frame = row.frame as { uuid: string; timestamp: string; session_id: string; message: { role: string; content: Record<string, unknown>[] } };
    const result = { ...frame.message.content[0], content };
    const noticeFrame = { ...frame, tool_use_result: undefined, message: { ...frame.message, content: [result] } };
    const n = normalizer();
    const events = journal.flatMap((r) => n.push(r === row ? { ...r, frame: noticeFrame } : r));
    expect.soft(events.find((e) => e.kind === 'tool.result' && e.toolUseId === 'toolu_synth_long_2')).toMatchObject({ spillPath: path });
    const record = parseTranscriptRecord({ type: 'user', uuid: frame.uuid, timestamp: frame.timestamp, parentUuid: null, message: noticeFrame.message });
    const disk = recordToEvents(record, createBackfillContext({ sessionId: frame.session_id as SessionId, agent: null }));
    expect(disk.find((e) => e.kind === 'tool.result')).toMatchObject({ spillPath: path });
  });
});
