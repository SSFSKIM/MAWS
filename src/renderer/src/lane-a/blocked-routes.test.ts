// UX wave U1c, M2 (the U1c document, Design 1 and 3; Acceptance 6; ruling J): a call auto mode blocked, by every route
// a recording can be drawn by. The live route is the session's journal through the engine host's normaliser, the file
// route the chain follower over the transcript file, the link route the same rows through the reader of another
// machine's rows (`freshSource`). It lives here, beside `run-routes.test.ts`, for the reason that test gives: the reader of
// another machine's rows is the renderer's graph, not the model's.
//
// Probe E's block reads the same on all three. A subagent's block (probe D) does not, and this landing leaves it so
// (ruling J): the test pins what each route reads today, so that a change to either reading is seen.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { journalToEvents } from '../transcript/dev/journal';
import { blockedStates } from '../transcript/model/blocked';
import { blockedLabel } from '../transcript/model/cells';
import { rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState } from '../transcript/model/reduce';
import type { Cell, Row } from '../transcript/model/rows';
import { shellLabel } from '../transcript/view/cells/CellLine';
import { freshSource, subagentLookupOf } from './plane-transcript';

const SESSION = '0f0e0d0c-0000-4000-8000-00000000c0de';
const UXWAVE = join(FIXTURE_DIR, 'uxwave');
const OPENING = 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: ';
const MARKER = 'curl -s -o marker-1.txt "https://example.com/?maws-probe-marker-1"';

const rowsIn = (text: string): JsonObject[] => text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject);
const textOf = (name: string) => readFileSync(join(UXWAVE, name), 'utf8');

async function fromFile(text: string, agent: { agentId: AgentId; parentToolUseId: ParentToolUseId } | null = null): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text), SESSION as SessionId, agent, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}
const fromRows = (text: string, agentId: string | null = null): Promise<SessionEvent[]> =>
  freshSource(rowsIn(text).filter((row) => typeof row.uuid === 'string'), SESSION, subagentLookupOf([]), agentId).snapshot();

const callsOf = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'cell' ? [row] : row.kind === 'group' ? row.cells.filter((cell) => cell.toolUseId !== null) : []));

/** A transcript's rows drawn open (the main loop's, or an agent's own), and what its line reads of each refused or failed shell call, with the rule's state. */
function reading(events: SessionEvent[], agentId: AgentId | null = null) {
  const state = withAllExpanded(applyEvents(createState(null, agentId), events));
  const rows = rowsOf(state);
  const states = blockedStates(rows, state.hidden?.turns ?? []);
  return {
    calls: callsOf(rows).filter((cell) => cell.toolName === 'Bash').map((cell) => {
      const blocked = states.get(cell.id);
      return {
        status: cell.status, denial: cell.classification.denial?.kind ?? null, name: cell.blocked ?? null,
        line: blocked === undefined ? shellLabel(cell) : blockedLabel(cell, blocked), grant: blocked?.grant ?? null, error: cell.error?.slice(0, OPENING.length) ?? null,
      };
    }),
    advisories: rows.filter((row) => row.kind === 'error' && row.text.startsWith(OPENING)).length,
    approvals: rows.flatMap((row) => (row.kind === 'user' && row.consent !== undefined ? [row.consent.subject] : [])),
  };
}

describe('probe E’s block reads the same by every route (Design 1, Acceptance 6)', () => {
  it('u1c-e-1: the short label, approved, the retry ran, and no advisory, live, from the file and through its rows', async () => {
    const text = textOf('u1c-e-1.transcript.jsonl');
    const routes = { live: journalToEvents(loadUxwaveJournal('u1c-e-1')), file: await fromFile(text), link: await fromRows(text) };
    for (const [route, events] of Object.entries(routes)) {
      expect(reading(events), route).toEqual({
        calls: [
          { status: 'denied', denial: 'automode-blocked', name: { kind: 'command', subject: MARKER }, line: `Auto mode blocked: \`${MARKER}\` · approved`, grant: 'read', error: null },
          { status: 'done', denial: null, name: null, line: 'Ran the curl command from task-1.txt', grant: null, error: null },
        ],
        advisories: 0,
        approvals: [MARKER],
      });
    }
  });
});

// Ruling J: the grant reaches the main loop, never the subagent, so a subagent's rows get no button; what each route
// reads of its blocked call is left as it is. Probe D's `u1c-d-after-1`: the subagent's call (journal seq 95, its
// advisory 96, its result 98; line 24 of the subagent's own file), the grant sent idle after the hand-back (204), the
// main loop's own retry (259, 263).
describe('a subagent’s blocked call, by each route (probe D, ruling J; pinned, not agreed)', () => {
  const CHILD = 'a76ce748bb105e7a4';
  const LAUNCH = 'toolu_01TnEruuyhgcF3zMSUG4zE1T';
  const reportsOnOwnAgent = (event: SessionEvent) => event.agentId !== null && 'taskId' in event && (event.taskId as string | null) === (event.agentId as string);
  const ofParent = (event: SessionEvent) => event.agentId === null || event.parentToolUseId !== null || reportsOnOwnAgent(event); // transcript/source/ipc.ts
  const own = (event: SessionEvent) => (event.agentId as string | null) === CHILD && !reportsOnOwnAgent(event); // `ownOf`, transcript/source/ipc.ts
  const childText = textOf(`u1c-d-after-1.agent-${CHILD}.transcript.jsonl`);
  const mainText = textOf('u1c-d-after-1.transcript.jsonl');

  it('u1c-d-after-1, the subagent’s own transcript: live a failed call with the advisory beside it; from its file and its rows a blocked call with the short label', async () => {
    const live = journalToEvents(loadUxwaveJournal('u1c-d-after-1'));
    const routes = {
      live: live.filter(own),
      file: await fromFile(childText, { agentId: CHILD as AgentId, parentToolUseId: LAUNCH as ParentToolUseId }),
      link: await fromRows(childText, CHILD),
    };
    const waited = { status: 'done', denial: null, name: null, line: 'Ran uxw_wait.py with argument 30', grant: null, error: null };
    expect(reading(routes.live, CHILD as AgentId), 'live').toEqual({
      calls: [{ status: 'error', denial: null, name: null, line: 'Failed to run the curl command from task-1.txt', grant: null, error: OPENING }, waited],
      advisories: 1,
      approvals: [],
    });
    for (const route of ['file', 'link'] as const) {
      expect(reading(routes[route], CHILD as AgentId), route).toEqual({
        calls: [{ status: 'denied', denial: 'automode-blocked', name: { kind: 'command', subject: MARKER }, line: `Auto mode blocked: \`${MARKER}\``, grant: 'none', error: null }, waited],
        advisories: 0,
        approvals: [],
      });
    }
  });

  it('u1c-d-after-1, the main transcript: no blocked row by any route; the grant’s line and the main loop’s own retry, which ran', async () => {
    const routes = { live: journalToEvents(loadUxwaveJournal('u1c-d-after-1')).filter(ofParent), file: await fromFile(mainText), link: await fromRows(mainText) };
    for (const [route, events] of Object.entries(routes)) {
      expect(reading(events), route).toEqual({
        calls: [{ status: 'done', denial: null, name: null, line: 'Ran the curl command', grant: null, error: null }],
        advisories: 0,
        approvals: [MARKER],
      });
    }
  });
});
