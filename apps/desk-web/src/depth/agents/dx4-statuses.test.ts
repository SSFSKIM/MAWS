// DC9's M5, the status patch at the adapter: every body case of DC8's shared fixture (DX4's vectors, vendored at
// `apps/desk-hub/fake-machine/dx4/dx4-jobs.json`) played through the main subscription as a DC8 producer sends it — its
// rows in the snapshot, mapped by MAWS's backfill, and the body the machine derives — draws each agent with the body's
// status. MAWS's backfill alone reads some of these rows otherwise: an older launch written without a `toolUseResult`
// is a finished Agent call to it (`subagent.finished/completed`), where DX4 says the session's end left it `exited`.
import { readFileSync } from 'node:fs';
import { TranscriptRecordSchema } from '@shared/wire/transcript';
import type { SessionId } from '@shared/graph/ids';
import type { JsonObject, SessionBodies, SubagentMeta } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createBackfillContext, recordToEvents } from '../../../../../src/engine-host/fs/backfill';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { FakePlane } from '../../../test/double/fake-plane';
import { DeskTranscript, subagentLookupOf } from '../source/desk-transcript';
import { taskGraphOf } from './task-feed';

type Case = { name: string; input: { session: { id: string }; main: JsonObject[]; metas: SubagentMeta[] }; expect: SessionBodies['subagents'] };
const FIXTURE = new URL('../../../../desk-hub/fake-machine/dx4/dx4-jobs.json', import.meta.url);
const CASES = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: Case[] }).cases;
const LEGACY = 'launches written without a toolUseResult, in a cold open of the ended session';

/** The rows as a session's transcript holds them, with the envelope fields the fixture leaves out. */
const rowsOf = (c: Case): JsonObject[] => c.input.main.map((row) => ({ sessionId: c.input.session.id, isSidechain: false, userType: 'external', cwd: '/work', version: '2.1.300', ...row }));

/** The tree MAWS's backfill builds from the rows and metas alone, before DX4's statuses. */
function heldStatuses(c: Case): Record<string, string> {
  const ctx = createBackfillContext({ sessionId: c.input.session.id as SessionId, agent: null, subagents: subagentLookupOf(c.input.metas) });
  const events = rowsOf(c).flatMap((row) => {
    const record = TranscriptRecordSchema.safeParse(row);
    return record.success ? recordToEvents(record.data, ctx) : [];
  });
  const graph = taskGraphOf(c.input.metas, events);
  return Object.fromEntries(c.input.metas.map(({ agentId }) => [agentId, graph.tasks.get(agentId as never)!.status]));
}

/** The statuses the main subscription draws once a DC8 producer's snapshot carries the rows and the body. */
function drawnStatuses(c: Case): Record<string, string> {
  const plane = new FakePlane('proj');
  const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: c.input.session.id, agentId: null }, store: createTranscriptStore() });
  controller.open();
  plane.send('snapshot', { rows: [...rowsOf(c)].reverse(), more: false, subagents: c.expect.subagents, presence: { record: null, bridge: false }, streaming: [], usage: null, jobs: c.expect.jobs, mcp: c.expect.mcp });
  const { tasks } = controller.state.getState();
  return Object.fromEntries(c.expect.subagents.map(({ agentId }) => [agentId, tasks.tasks.get(agentId as never)?.status ?? 'absent']));
}

const expected = (c: Case) => Object.fromEntries(c.expect.subagents.map((entry) => [entry.agentId, entry.status as string]));

describe('DX4’s statuses drawn over MAWS’s backfill', () => {
  it.each(CASES.filter((c) => c.expect.subagents.length > 0).map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect(drawnStatuses(c)).toEqual(expected(c));
  });

  it('draws an older launch exited where MAWS’s backfill alone reads it completed', () => {
    const c = CASES.find((k) => k.name === LEGACY)!;
    const held = heldStatuses(c);
    const launched = ['a13a0000000000001', 'a13b0000000000002', 'a13f0000000000003'];
    for (const agentId of launched) expect(held[agentId], agentId).toBe('completed'); // the conflict the body corrects
    const drawn = drawnStatuses(c);
    for (const agentId of launched) expect(drawn[agentId], agentId).toBe('exited');
  });
});
