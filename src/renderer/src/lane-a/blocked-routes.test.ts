// UX wave U1c, M2 (the U1c document, Design 1 and 3; Acceptance 6; ruling J): a call auto mode blocked, by every route
// a recording can be drawn by. The live route is the session's journal through the engine host's normaliser, the file
// route the chain follower over the transcript file, the link route the same rows through the reader of another
// machine's rows (`freshSource`). It lives here, beside `run-routes.test.ts`, for the reason that test gives: the reader of
// another machine's rows is the renderer's graph, not the model's.
//
// Probe E's block reads the same on all three. A subagent's block (probe D) does not, and this landing leaves it so
// (ruling J): the test pins what each route reads today, so that a change to either reading is seen.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import { parseTranscriptRecord, type TranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../../engine-host/fs/backfill';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadUxwaveJournal, loadUxwaveTranscript, TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { journalToEvents } from '../transcript/dev/journal';
import { blockedStates } from '../transcript/model/blocked';
import { blockedLabel } from '../transcript/model/cells';
import { rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState } from '../transcript/model/reduce';
import type { Cell, Row } from '../transcript/model/rows';
import { shellLabel } from '../transcript/view/cells/CellLine';
import { asQueuedPrompt } from './conversation/delivery-frame';
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
      calls: [{ status: 'error', denial: null, name: null, line: 'Failed: Run the curl command from task-1.txt', grant: null, error: OPENING }, waited],
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
        calls: [{ status: 'done', denial: null, name: null, line: 'Fetched the approved probe URL into marker-1.txt', grant: null, error: null }],
        advisories: 0,
        approvals: [MARKER],
      });
    }
  });
});

// UX wave U1c, M4 (the U1c document, Design 7; Acceptance 7a to 7c): a terminal session's blocked call and the grant
// its sminos bridge carried, in each state probe T recorded (findings-uxwave-u1c-terminal-grant.txt: idle, the row the
// bridge submitted as the user; during a turn, the row it appended and its mirror line; after an Esc, the same two after
// the interrupted call's rows, then the bridge's wake), from the file on this Mac and through the same rows as another
// machine sends them. On both routes the blocked row reads approved, the grant is the approval's line, the retry ran,
// and the two routes draw the same person's rows.
describe('a grant the bridge carried to a terminal session, by both routes (probe T; Acceptance 7a to 7c)', () => {
  const runs: [string, number][] = [
    ['u1c-t-idle-1', 1], ['u1c-t-idle-2', 2], ['u1c-t-idle-3', 3],
    ['u1c-t-busy-1', 1], ['u1c-t-busy-2', 2], ['u1c-t-busy-4', 4],
    ['u1c-t-esc-1', 1], ['u1c-t-esc-2', 2], ['u1c-t-esc-3', 3],
  ];
  /** The marker command's calls as their lines read them, the approvals, and the person's rows, one line each. */
  function terminalReading(events: SessionEvent[], command: string) {
    const state = withAllExpanded(applyEvents(createState(null, null), events));
    const rows = rowsOf(state);
    const states = blockedStates(rows, state.hidden?.turns ?? []);
    const calls = callsOf(rows).filter((cell) => cell.detail.kind === 'shell' && cell.detail.command === command);
    return {
      calls: calls.map((cell) => {
        const blocked = states.get(cell.id);
        return blocked === undefined ? cell.status : `${blockedLabel(cell, blocked)} (${blocked.grant})`;
      }),
      approvals: rows.flatMap((row) => (row.kind === 'user' && row.consent !== undefined ? [row.consent.subject] : [])),
      persons: rows.flatMap((row) => (row.kind === 'user' ? [`${row.consent !== undefined ? 'consent' : row.steer ? 'steer' : 'prompt'}: ${row.text.split('\n', 1)[0]}`] : [])),
    };
  }

  it.each(runs)('%s: from the file and through its rows, the blocked row reads approved, the grant is its line, the retry ran', async (name, n) => {
    const command = `curl -s -o marker-${n}.txt "https://example.com/?maws-probe-marker-${n}"`;
    const text = textOf(`${name}.transcript.jsonl`);
    const file = terminalReading(await fromFile(text), command);
    const link = terminalReading(await fromRows(text), command);
    for (const [route, reading] of Object.entries({ file, link })) {
      expect(reading.calls, route).toEqual([`Auto mode blocked: \`${command}\` · approved (read)`, 'done']);
      expect(reading.approvals, route).toEqual([command]);
    }
    expect(link.persons, 'the same person’s rows by both routes').toEqual(file.persons);
  });
});

// UX wave U1c, M4 (the U1c document, §C 8; Decision Log 38): the engine reads a row the bridge appended at its next model
// request, so an approval the bridge appended while a turn runs is a message waiting for the running turn from its
// delivery (the mirror line on this Mac, the appended row through another machine's rows) to the running call's result,
// which the request after it carries; after an Esc nothing is drawn for it until the bridge's wake, whose turn reads it.
// Every prefix of each recorded run, by both routes.
describe('an approval the bridge appended waits for the engine to read it, by both routes (probe T; Decision Log 38)', () => {
  const commandOf = (n: number) => `curl -s -o marker-${n}.txt "https://example.com/?maws-probe-marker-${n}"`;
  /** What the blocked row reads of its approval: none, read, or waiting with the approval row's marks. */
  function approvalAt(events: SessionEvent[], command: string): string {
    const state = withAllExpanded(applyEvents(createState(null, null), events));
    const rows = rowsOf(state);
    const states = blockedStates(rows, state.hidden?.turns ?? []);
    const cell = callsOf(rows).find((each) => each.detail.kind === 'shell' && each.detail.command === command && states.has(each.id));
    const grant = cell === undefined ? 'no block' : states.get(cell.id)!.grant;
    if (grant !== 'waiting') return grant;
    const approval = rows.find((row): row is Extract<Row, { kind: 'user' }> => row.kind === 'user' && row.consent?.subject === command)!;
    return `waiting (${approval.pending ?? 'no pending'}, ${approval.unread === true ? 'unread' : 'no unread'})`;
  }
  const WAITING = 'waiting (next, unread)'; // while the turn it waits for runs
  const UNREAD = 'waiting (no pending, unread)'; // once that turn has ended, for the turn that starts next
  /** The reading at each prefix of the run's file, from line `from` to line `to`, by each route. */
  async function prefixes(name: string, n: number, from: number, to: number) {
    const lines = textOf(`${name}.transcript.jsonl`).split('\n').filter((line) => line.trim() !== '');
    const read: { file: string[]; link: string[] } = { file: [], link: [] };
    for (let p = from; p <= to; p += 1) {
      const head = lines.slice(0, p).join('\n');
      read.file.push(`${p}: ${approvalAt(await fromFile(`${head}\n`), commandOf(n))}`);
      read.link.push(`${p}: ${approvalAt(await fromRows(head), commandOf(n))}`);
    }
    return read;
  }
  const lineRange = (from: number, to: number, reading: (p: number) => string) => Array.from({ length: to - from + 1 }, (_, i) => `${from + i}: ${reading(from + i)}`);

  // each run: its name, its marker, the appended row's line, the mirror line's, and the line of the running call's result
  it.each([
    ['u1c-t-busy-1', 1, 52, 53, 54],
    ['u1c-t-busy-2', 2, 53, 54, 55],
    ['u1c-t-busy-4', 4, 49, 50, 51],
  ] as const)('%s, during a turn: from its delivery until the running call’s result the approval waits (unread, at the next step) by both routes; from the result on it is read', async (name, n, row, mirror, result) => {
    const read = await prefixes(name, n, row - 1, result + 1);
    expect.soft(read.file, 'from the file').toEqual(lineRange(row - 1, result + 1, (p) => (p < mirror ? 'none' : p < result ? WAITING : 'read')));
    expect.soft(read.link, 'through its rows').toEqual(lineRange(row - 1, result + 1, (p) => (p < row ? 'none' : p < result ? WAITING : 'read')));
  });

  // each run: its name, its marker, the appended row's line, and the line of the bridge's wake
  it.each([
    ['u1c-t-esc-1', 1, 56, 61],
    ['u1c-t-esc-2', 2, 51, 56],
    ['u1c-t-esc-3', 3, 52, 57],
  ] as const)('%s, after an Esc: by both routes nothing reads approved until the bridge’s wake; from the wake on the approval is read', async (name, n, row, wake) => {
    const read = await prefixes(name, n, row - 1, wake + 1);
    const expected = lineRange(row - 1, wake + 1, (p) => (p < wake ? 'none' : 'read'));
    expect.soft(read.file, 'from the file').toEqual(expected);
    expect.soft(read.link, 'through its rows').toEqual(expected);
  });

  // The cases no run recorded, built from the recorded rows: u1c-t-busy-1 to its mirror line (line 53), then rows of the
  // same shapes from u1c-t-busy-1 and u1c-t-esc-1, each under a uuid of its own, mapped as the file route maps them.
  const busy = loadUxwaveTranscript('u1c-t-busy-1');
  const esc = loadUxwaveTranscript('u1c-t-esc-1');
  const again = (record: TranscriptRecord, uuid: string, over: Record<string, unknown> = {}): TranscriptRecord => parseTranscriptRecord({ ...record, uuid, timestamp: '2026-11-15T11:47:30.000Z', ...over });
  /** The reading after each record, mapped in order under one context. */
  const readings = (records: TranscriptRecord[], from: number) => {
    const ctx = createBackfillContext({ sessionId: SESSION as SessionId, agent: null });
    const events: SessionEvent[] = [];
    return records.map((record) => (events.push(...recordToEvents(record, ctx)), approvalAt(events, commandOf(1)))).slice(from);
  };

  it('a held approval when the turn ends with no tool result (u1c-t-busy-1 without its running call, then a written reply and the turn’s end): it waits through the end, and the next turn’s start takes it', () => {
    const reply = again(busy[50]!, 'reply-1', { message: { ...(busy[50]!.message as object), id: 'msg_reply_1', content: [{ type: 'text', text: 'Done.' }] } });
    const ended = again(esc[47]!, 'ended-1');
    const typed = again(busy[48]!, 'typed-1', { message: { role: 'user', content: 'Go on.' } });
    const records = [...busy.slice(0, 50), busy[51]!, busy[52]!, reply, ended, typed];
    expect(readings(records, 50)).toEqual(['none', WAITING, WAITING, UNREAD, 'read']);
  });

  it('a held approval when the turn is interrupted (u1c-t-busy-1 to its mirror line, then u1c-t-esc-1’s rejected result for the running call, its marker and the bridge’s wake): the rejected result is no boundary; it waits through the interrupt; the wake takes it', () => {
    const running = (busy[50]!.message as { content: { id: string }[] }).content[0]!.id;
    const rejectedRow = esc[53]!;
    const rejectedContent = (rejectedRow.message as { content: Record<string, unknown>[] }).content;
    const rejected = again(rejectedRow, 'rejected-1', { message: { role: 'user', content: [{ ...rejectedContent[0], tool_use_id: running }] } });
    const records = [...busy.slice(0, 53), rejected, again(esc[54]!, 'marker-1'), again(esc[60]!, 'wake-1')];
    expect(readings(records, 52)).toEqual([WAITING, WAITING, UNREAD, 'read']);
  });

  it('MAWS’s drawn row of an appended grant is known by its key and waits; the engine’s own queued prompt of the same words is taken at once; no engine-written queued_command in the fixtures carries the key', () => {
    const ctx = createBackfillContext({ sessionId: SESSION as SessionId, agent: null });
    for (const record of busy.slice(0, 51)) recordToEvents(record, ctx); // to the running call (line 51)
    const grant = rowsIn(textOf('u1c-t-busy-1.transcript.jsonl'))[51]!;
    const drawn = asQueuedPrompt(grant, (grant.message as JsonObject).content as JsonObject[]);
    expect((drawn.attachment as JsonObject).mawsDrawn).toBe(true);
    const drawnEvents = recordToEvents(parseTranscriptRecord(drawn), ctx);
    expect(drawnEvents.map((event) => event.kind), 'drawn: the message alone, its start held').toEqual(['user.message']);
    const engine = { ...drawn, uuid: 'engine-queued-1', attachment: { ...(drawn.attachment as JsonObject), source_uuid: 'engine-source-1', humanTurn: true } };
    delete (engine.attachment as JsonObject).mawsDrawn;
    expect(recordToEvents(parseTranscriptRecord(engine), ctx).map((event) => event.kind), 'the engine’s: taken into the turn at once').toEqual(['user.message', 'command.lifecycle']);

    const files = [FIXTURE_DIR, TEST_FIXTURE_DIR].flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.jsonl')).map((file) => join(dir, file)));
    const queued = files.flatMap((file) => readFileSync(file, 'utf8').split('\n').filter((line) => line.includes('"queued_command"')).flatMap((line) => {
      try {
        const row = JSON.parse(line) as JsonObject;
        const attachment = row.attachment as JsonObject | undefined;
        return attachment?.type === 'queued_command' ? [attachment] : [];
      } catch {
        return [];
      }
    }));
    expect(queued.length, 'the fixtures hold engine-written queued commands').toBeGreaterThan(40);
    expect(queued.filter((attachment) => 'mawsDrawn' in attachment)).toEqual([]);
  });
});
