// The live runs' reading of a deferred tool (e2e/support/tool-search.ts; the tool-choice plan's M6, A12): whether a
// `maws` tool reached the model through the engine's ToolSearch before its first call. Held to two recordings: one where
// the ask was deferred and loaded by a ToolSearch before it was called (P4-R7's probe, before board ticket 420), and one
// where it was listed up front and called with no search (the ticket 421/420 probe's P1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { throughToolSearch, toolSearchLoads } from '../../e2e/support/tool-search';

const FIXTURES = join(__dirname, '../../spikes/protocol-probe/fixtures');
const rowsOf = (fixture: string): JournalRow[] =>
  readFileSync(join(FIXTURES, fixture), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JournalRow);

const DEFERRED_ASK = rowsOf('p4/p4-r7-loss-dialog.jsonl');
const LOADED_ASK = rowsOf('uxwave/uxwave-421-ask-upfront.jsonl');

describe('a maws tool reached through tool search', () => {
  it('reads each ToolSearch answer as the tools it loaded, at the seq of the engine frame that carries it', () => {
    expect(toolSearchLoads(DEFERRED_ASK)).toEqual([{ seq: 106, tools: ['mcp__maws__ask'] }]);
    expect(toolSearchLoads(LOADED_ASK)).toEqual([]);
  });

  it('a deferred tool is loaded by a search before its first call', () => {
    expect(throughToolSearch(DEFERRED_ASK, 'ask')).toEqual({ loadSeq: 106, callSeq: 232 });
  });

  it('a tool listed up front is called with no search before it', () => {
    expect(throughToolSearch(LOADED_ASK, 'ask')).toEqual({ loadSeq: null, callSeq: 27 });
  });

  it('a tool never called has no call, and a load only counts before the call', () => {
    expect(throughToolSearch(DEFERRED_ASK, 'artifact_edit')).toEqual({ loadSeq: null, callSeq: null });
    const searchedLate = [...LOADED_ASK, { seq: 999, ts: '', direction: 'in', frame: { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_late', content: [{ type: 'tool_reference', tool_name: 'mcp__maws__ask' }] }] } } }] as JournalRow[];
    expect(throughToolSearch(searchedLate, 'ask')).toEqual({ loadSeq: null, callSeq: 27 });
  });
});
