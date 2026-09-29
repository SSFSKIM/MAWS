import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { AgentMetaSchema, currentChain, type TranscriptRecord } from '@shared/wire/transcript';
import { FIXTURE_DIR, loadJournal, loadTranscript, loadTranscriptFixture } from '../../../../test/support/fixtures';
import { projectEvents, projectWire } from '../../../../test/support/wire-projection';
import { createBackfillContext, recordToEvents } from '../backfill';
import { ReplayClock } from './clock';
import { engineNormalizer } from './normalizer';
import { ReplayRunner } from './runner';

// The paired probe session 9a1d4262-…: the pass-1 wire journal, the parent transcript the engine wrote for it, and the
// two sidecar transcripts of its Agent children (C4 execution document, Grounding; acceptance item 5).
const SIDECARS = ['ad286defbc77bc090', 'ae75ba6ce5d866acc'];
const RUN = 'rp_00000000-0000-4000-8000-00000000c0de' as SessionId;

function runner(emit: (events: SessionEvent[]) => void = () => {}) {
  return new ReplayRunner({ appSessionId: 'app-consistency' as AppSessionId, sessionId: RUN, clock: new ReplayClock({ speed: 'instant' }), emit, progress: () => {} });
}

// The journal at 'instant' through the runner; what the normaliser was handed is the wire side.
async function replayedRows(): Promise<JournalRow[]> {
  const handed: JournalRow[] = [];
  await runner().runJournal(loadJournal('pass1', 'subagent'), { normalize: (row) => (handed.push(row), []) });
  return handed;
}

// The transcript through the runner's transcript source (the backfill mapping over the chain).
async function replayedTranscript(records: TranscriptRecord[]): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  await runner((batch) => void events.push(...batch)).runTranscript(records, null);
  return events;
}

function sidecarBackfill(agentId: string): { toolUseId: ParentToolUseId; events: SessionEvent[] } {
  const meta = AgentMetaSchema.parse(JSON.parse(readFileSync(join(FIXTURE_DIR, `subagent-sidecars/agent-${agentId}.meta.json`), 'utf8')));
  const toolUseId = meta.toolUseId as ParentToolUseId;
  const ctx = createBackfillContext({ sessionId: RUN, agent: { agentId: agentId as AgentId, parentToolUseId: toolUseId } });
  const { chain } = currentChain(loadTranscript(`subagent-sidecars/agent-${agentId}.jsonl`));
  return { toolUseId, events: chain.flatMap((record) => recordToEvents(record, ctx)) };
}

describe('journal replay and transcript backfill agree', () => {
  it('the parent conversation: the journal replayed at instant speed projects as the backfill of subagent-parent.jsonl', async () => {
    const wire = projectWire(await replayedRows(), { parentToolUseId: null });
    const disk = projectEvents(await replayedTranscript(loadTranscriptFixture('subagent-parent')));
    expect(disk).toEqual(wire);
    // Not agreement over nothing: the parent's prompt, nine assistant blocks, both Agent calls and their results.
    expect(wire.userMessages).toHaveLength(1);
    expect(wire.assistantBlocks).toHaveLength(9);
    expect(wire.toolUses.map((use) => use.name)).toEqual(['Agent', 'Agent']);
    expect(wire.toolResults).toHaveLength(2);
  });

  it('each child: the frames attributed to its parent tool use project as its sidecar\'s backfill', async () => {
    const rows = await replayedRows();
    for (const agentId of SIDECARS) {
      const { toolUseId, events } = sidecarBackfill(agentId);
      const wire = projectWire(rows, { parentToolUseId: toolUseId });
      expect(projectEvents(events), agentId).toEqual(wire);
      expect(wire.assistantBlocks, agentId).toHaveLength(4);
      expect(wire.toolUses.map((use) => use.name), agentId).toEqual(['Read']);
      expect(wire.toolResults, agentId).toHaveLength(1);
    }
  });

  it('sees a difference: one tool_use id altered in a copy of the parent transcript breaks the agreement', async () => {
    const wire = projectWire(await replayedRows(), { parentToolUseId: null });
    let altered = false;
    const copy = loadTranscriptFixture('subagent-parent').map((record): TranscriptRecord => {
      const content = (record.message as { content?: unknown } | undefined)?.content;
      if (altered || record.type !== 'assistant' || !Array.isArray(content) || content[0]?.type !== 'tool_use') return record;
      altered = true;
      return { ...record, message: { ...(record.message as object), content: [{ ...content[0], id: `${content[0].id}-altered` }] } };
    });
    expect(altered).toBe(true);
    const disk = projectEvents(await replayedTranscript(copy));
    expect(disk).not.toEqual(wire);
    expect(disk.toolUses).not.toEqual(wire.toolUses);
    expect(disk.assistantBlocks).toEqual(wire.assistantBlocks); // the comparator sees the one field that changed
  });
});

// The M5 follow-up (pending until C3 landed): the same comparison with C3's `Normalizer` on the journal side, as the
// running app wires it (register.ts), instead of the raw-frame projection.
describe('replay through the normaliser agrees with backfill', () => {
  const APP = 'app-consistency' as AppSessionId;

  async function normalised(): Promise<SessionEvent[]> {
    const events: SessionEvent[] = [];
    await runner((batch) => void events.push(...batch)).runJournal(loadJournal('pass1', 'subagent'), engineNormalizer(RUN, APP));
    return events;
  }

  it('the parent conversation: C3\'s normaliser over the journal at instant speed projects as the backfill of subagent-parent.jsonl', async () => {
    const events = await normalised();
    const wire = projectEvents(events.filter((event) => event.parentToolUseId === null));
    const disk = projectEvents(await replayedTranscript(loadTranscriptFixture('subagent-parent')));
    expect(wire).toEqual(disk);
    expect(wire.userMessages).toHaveLength(1);
    expect(wire.assistantBlocks).toHaveLength(9);
    expect(wire.toolUses.map((use) => use.name)).toEqual(['Agent', 'Agent']);
    expect(wire.toolResults).toHaveLength(2);
    // Real normalised events, not the stand-in's frame.unknown per row.
    expect(events.every((event) => event.sessionId === RUN)).toBe(true);
    expect(events.some((event) => event.kind === 'frame.unknown' && event.id.startsWith('row:'))).toBe(false);
  });

  it('each child: the events C3\'s normaliser attributes to its parent tool use project as its sidecar\'s backfill', async () => {
    const events = await normalised();
    for (const agentId of SIDECARS) {
      const { toolUseId, events: backfill } = sidecarBackfill(agentId);
      const wire = projectEvents(events.filter((event) => event.parentToolUseId === toolUseId));
      expect(wire, agentId).toEqual(projectEvents(backfill));
      expect(wire.assistantBlocks, agentId).toHaveLength(4);
      expect(wire.toolUses.map((use) => use.name), agentId).toEqual(['Read']);
      expect(wire.toolResults, agentId).toHaveLength(1);
    }
  });
});
