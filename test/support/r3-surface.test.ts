import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { currentChain, parseTranscriptRecord } from '../../src/shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../src/engine-host/fs/backfill';
import { applyEvents, createState } from '../../src/renderer/src/transcript/model/reduce';
import { rowsOf, withAllExpanded } from '../../src/renderer/src/transcript/model/derive';
import { addSurfaceSeedEchoes, ownerMarkedText, r3Output, r3Question, recordedSurfaceJournal, recordedSurfaceSessionId, sittingSeed, transcriptSeed } from './r3-surface';
import { Normalizer } from '../../src/engine-host/normalizer';
import type { JournalRow } from '../../src/shared/wire/journal';
import type { SessionId } from '../../src/shared/graph/ids';
const root = resolve(__dirname, '../..');
const base = { repo: '/tmp/maws-r3-seed', engineId: 'r3-seed' };
function derive(records: Record<string, unknown>[]) {
  const ctx = createBackfillContext({ sessionId: base.engineId as SessionId, agent: null });
  const events = records.map(parseTranscriptRecord).flatMap((record) => recordToEvents(record, ctx));
  return rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
}
interface Entry { direction: string; frame: { request_id?: string; request?: { subtype: string; component?: string; instance_id?: string }; response?: { request_id: string }; [key: string]: unknown } }
const journal = (path: string): Entry[] => readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Entry);

describe('R3 e2e recording and disk-seed helpers', () => {
  it.each([false, true])('keeps the projected sitting seed on one disk chain (synthetic completions=%s)', (closeTurns) => {
    const records = sittingSeed(base, closeTurns);
    const { chain, gap } = currentChain(records.map(parseTranscriptRecord));
    expect(gap).toBeNull();
    expect(chain).toHaveLength(records.length);
    expect(derive(chain).filter((row) => row.kind === 'assistant_text')).toHaveLength(3);
    expect(derive(chain).some((row) => row.kind === 'divider')).toBe(true);
  });
  it('selects a recorded outcome and rebases only the request identity, retaining the original engine response', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'maws-r3-helper-'));
    try {
      const fixture = 'mods-surface-transcript-tool-group';
      const original = journal(join(root, 'spikes/protocol-probe/fixtures/pass3', `${fixture}.jsonl`));
      const selected = original.find((r) => r.direction === 'out' && r.frame.request?.instance_id === 'r3:ToolGroup:engine-slot-rewrite')!;
      const answer = original.find((r) => r.direction === 'in' && r.frame.response?.request_id === selected.frame.request_id)!;
      const replay = journal(recordedSurfaceJournal(scratch, fixture, { component: 'ToolGroup', outcome: 'engine-slot-rewrite', instanceId: 'group:tool-r3' }));
      const requests = replay.filter((r) => r.direction === 'out' && r.frame.request?.subtype === 'ui_render');
      expect(requests).toHaveLength(1);
      expect(requests[0]!.frame.request?.instance_id).toBe('group:tool-r3');
      expect(replay.find((r) => r.direction === 'in' && r.frame.response?.request_id === selected.frame.request_id)?.frame).toEqual(answer.frame);
      expect(() => recordedSurfaceJournal(scratch, fixture, { component: 'Missing', outcome: 'replacement', instanceId: 'x' })).toThrow('No recorded');
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
  it('keeps the owner recording controls and payloads intact, including the invalidate between toggle and redraw', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'maws-r3-helper-'));
    try {
      const fixture = 'mods-surface-transcript-to-human';
      const original = journal(join(root, 'spikes/protocol-probe/fixtures/pass3', `${fixture}.jsonl`));
      const replay = journal(recordedSurfaceJournal(scratch, fixture));
      expect(replay.map((r) => r.frame)).toEqual(original.map((r) => r.frame));
      const engineId = recordedSurfaceSessionId(join(scratch, `${fixture}-dom.jsonl`));
      const pushedIds = new Set(replay.filter((r) => r.direction === 'in' && typeof r.frame.session_id === 'string').map((r) => r.frame.session_id));
      expect([...pushedIds]).toEqual([engineId]);
      const seed = transcriptSeed({ ...base, engineId });
      seed.user('owner-user', 'Show the report');
      expect(seed.finish().every((record) => record.sessionId === engineId)).toBe(true);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
  it('derives an active tool group, a completed standalone cell, and a native question receipt from the disk seeds', () => {
    const group = transcriptSeed(base); group.user('u', 'run'); group.tool('tool-r3', 'Bash', { command: 'printf R3' }, r3Output);
    expect(derive(group.finish(false)).find((r) => r.kind === 'group')).toMatchObject({ cells: [{ toolUseId: 'tool-r3' }] });
    const standalone = transcriptSeed(base); standalone.user('u', 'show'); standalone.tool('tool-r3', 'Bash', { command: 'printf R3' }, r3Output);
    expect(derive(standalone.finish()).find((r) => r.kind === 'cell')).toMatchObject({ toolUseId: 'tool-r3', detail: { kind: 'shell' } });
    const question = transcriptSeed(base); question.user('u', 'ask'); question.tool('owner-question', 'AskUserQuestion', { questions: [r3Question] }, { questions: [r3Question], answers: { 'Which path?': 'One' } });
    expect(derive(question.finish()).find((r) => r.kind === 'question')).toMatchObject({ toolUseId: 'owner-question', answers: { 'Which path?': 'One' } });
  });
  it('makes control-only replay history available to live snapshots without changing recorded control payloads', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'maws-r3-helper-'));
    try {
      const path = recordedSurfaceJournal(scratch, 'mods-surface-transcript-to-human');
      const original = journal(path).map((row) => row.frame);
      const engineId = recordedSurfaceSessionId(path);
      const seed = transcriptSeed({ ...base, engineId });
      seed.user('owner-user', 'Show the report'); seed.text('owner-multi', ownerMarkedText); seed.text('owner-record', 'Private follow-up record.');
      seed.tool('owner-tool', 'Bash', { command: 'printf R3' }, r3Output);
      seed.tool('owner-question', 'AskUserQuestion', { questions: [r3Question] }, { questions: [r3Question], answers: { 'Which path?': 'One' } });
      addSurfaceSeedEchoes(path, seed.finish());
      const entries = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as JournalRow);
      const originalControls = original.filter((frame) => frame.type === 'control_request' || frame.type === 'control_response');
      expect(entries.map((row) => row.frame).filter((frame) => ['control_request', 'control_response'].includes((frame as { type: string }).type))).toEqual(originalControls);
      const normalizer = new Normalizer({ appSessionId: 'r3-e2e' as never, launchId: 'r3-e2e', sessionId: engineId as SessionId });
      const events = entries.flatMap((row) => normalizer.push(row));
      expect(events.filter((event) => event.kind === 'error.raised')).toEqual([]);
      const rows = rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
      expect(rows.filter((row) => row.kind === 'assistant_text').map((row) => row.messageUuid)).toEqual(['owner-multi', 'owner-record']);
      expect(rows.find((row) => row.kind === 'question')).toMatchObject({ toolUseId: 'owner-question', answers: { 'Which path?': 'One' } });
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
  it('keeps both owner message identities and working text in history for the recorded folded and unfolded responses', () => {
    const seed = transcriptSeed(base); seed.user('owner-user', 'Show the report'); seed.text('owner-multi', ownerMarkedText); seed.text('owner-record', 'Private follow-up record.');
    seed.tool('owner-tool', 'Bash', { command: 'printf R3' }, r3Output);
    seed.tool('owner-question', 'AskUserQuestion', { questions: [r3Question] }, { questions: [r3Question], answers: { 'Which path?': 'One' } });
    const texts = derive(seed.finish()).filter((r) => r.kind === 'assistant_text');
    expect(texts.map((r) => r.messageUuid)).toEqual(['owner-multi', 'owner-record']);
    expect(texts.map((r) => r.markdown)).toEqual([ownerMarkedText, 'Private follow-up record.']);
  });
});
