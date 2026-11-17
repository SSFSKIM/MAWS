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
import { consentMessage } from '@shared/engine/arrival';
import { neutraliseGrant } from '@shared/engine/grant';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import { parseTranscriptRecord, type TranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../../engine-host/fs/backfill';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadJournal, loadUxwaveJournal, loadUxwaveTranscript, TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
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
/** The same while the file is still being written: a live engine holds the session, so the follower synthesises no exit. */
async function fromFileFollowed(text: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text), SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 1 });
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
  /** The reading at each prefix of the run's file, from line `from` to line `to`, by each route, the file still being written. */
  async function prefixes(name: string, n: number, from: number, to: number) {
    const lines = textOf(`${name}.transcript.jsonl`).split('\n').filter((line) => line.trim() !== '');
    const read: { file: string[]; link: string[] } = { file: [], link: [] };
    for (let p = from; p <= to; p += 1) {
      const head = lines.slice(0, p).join('\n');
      read.file.push(`${p}: ${approvalAt(await fromFileFollowed(`${head}\n`), commandOf(n))}`);
      read.link.push(`${p}: ${approvalAt(await fromRows(head), commandOf(n))}`);
    }
    return read;
  }
  const lineRange = (from: number, to: number, reading: (p: number) => string) => Array.from({ length: to - from + 1 }, (_, i) => `${from + i}: ${reading(from + i)}`);

  // UX wave U1c, the one-writer rule's per-boundary pins (the architect's ruling on the review's route finding): the
  // bridge's three forms (a row it submitted as the user, idle; a row it appended into the running turn, with its mirror
  // line, which the file route's backfill recovers the words from; and that appended row as another machine's rows draw
  // it, a queued prompt of the person's, `steerAsDrawn`), each in its recorded run with the recorded sentence replaced by
  // the writer's neutralised one: by both routes the joiner is still there and no approval is read; the recorded runs,
  // the pressed consent the bridge carried, read their approval
  it.each([
    ['u1c-t-idle-1', 'submitted as the user'],
    ['u1c-t-busy-1', 'appended into the running turn, its mirror line recovered'],
    ['u1c-t-esc-1', 'appended after an Esc, and the bridge’s wake'],
  ] as const)('%s (%s): the neutralised sentence keeps its joiner and reads no approval by either route; the pressed one is read', async (name, form) => {
    const recorded = textOf(`${name}.transcript.jsonl`);
    const sentence = JSON.stringify(consentMessage('command', commandOf(1))).slice(1, -1);
    expect(recorded.includes(sentence), `${form}: the recorded run holds the sentence`).toBe(true);
    const neutralised = recorded.replaceAll(sentence, JSON.stringify(neutraliseGrant(consentMessage('command', commandOf(1)))).slice(1, -1));
    for (const [route, events] of [['from the file', await fromFile(neutralised)], ['through its rows', await fromRows(neutralised)]] as const) {
      expect(approvalAt(events, commandOf(1)), route).toBe('none');
      expect(events.some((event) => event.kind === 'user.message' && JSON.stringify(event.content).includes('\u2060')), `${route}: the joiner is still there`).toBe(true);
    }
    for (const [route, events] of [['from the file', await fromFile(recorded)], ['through its rows', await fromRows(recorded)]] as const) expect(approvalAt(events, commandOf(1)), `${route}, recorded`).toBe('read');
  });

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

// UX wave U1c (Decision Log 43): the read boundary of an approval held during a turn is the result that completes the
// round, when every call the assistant made since its last request has its result; the engine sends no request before
// it. The recorded parallel round is `u3-tasks-r2`'s (lines 156 to 161: an Agent call and a Bash call of one response,
// the Agent's result at once, the Bash call's thirty seconds later), with u1c-t-busy-1's appended grant and its mirror
// line (lines 52 and 53) put after the round's last call, each row chained as the engine chains them.
describe('an approval held during a round is read at the result that completes the round (Decision Log 43)', () => {
  const linesOf = (name: string) => textOf(`${name}.transcript.jsonl`).split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject);
  const tasks = linesOf('u3-tasks-r2');
  const busy = linesOf('u1c-t-busy-1');
  const esc = linesOf('u1c-t-esc-1');
  const at = (line: number) => tasks[line - 1]!;
  /** u1c-t-busy-1's appended grant and its mirror line, the row chained under `parent`. */
  const grantAfter = (parent: JsonObject): JsonObject[] => [{ ...busy[51]!, parentUuid: parent.uuid as string }, busy[52]!];
  const AGENT_RESULT = at(158);
  const BASH_RESULT = at(161);
  const BASH_CALL = at(157);

  /** What the approval's row reads: none, read, or waiting with its marks. */
  function approvalOf(events: SessionEvent[]): string {
    const rows = rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
    const approval = rows.find((row): row is Extract<Row, { kind: 'user' }> => row.kind === 'user' && row.consent?.subject === MARKER);
    if (approval === undefined) return 'none';
    if (approval.pending === undefined && approval.unread !== true) return 'read';
    return `waiting (${approval.pending ?? 'no pending'}, ${approval.unread === true ? 'unread' : 'no unread'})`;
  }
  const WAITING = 'waiting (next, unread)';
  const UNREAD = 'waiting (no pending, unread)';
  /** The reading by both routes at each prefix of `lines` from line `from` on, the file still being written. */
  async function prefixes(lines: JsonObject[], from: number) {
    const read: { file: string[]; link: string[] } = { file: [], link: [] };
    for (let p = from; p <= lines.length; p += 1) {
      const head = lines.slice(0, p).map((line) => JSON.stringify(line)).join('\n');
      read.file.push(`${p}: ${approvalOf(await fromFileFollowed(`${head}\n`))}`);
      read.link.push(`${p}: ${approvalOf(await fromRows(head))}`);
    }
    return read;
  }
  /** The reading after each record from `from` on, mapped in order under one context, as the file route maps them. */
  const readings = (lines: JsonObject[], from: number) => {
    const ctx = createBackfillContext({ sessionId: SESSION as SessionId, agent: null });
    const events: SessionEvent[] = [];
    return lines.map((line) => (events.push(...recordToEvents(parseTranscriptRecord(line), ctx)), approvalOf(events))).slice(from - 1);
  };
  const labelled = (from: number, readings: string[]) => readings.map((reading, i) => `${from + i}: ${reading}`);

  it('u3-tasks-r2, the grant held from its parallel round: it waits through the Agent call’s result and is read at the Bash call’s, thirty seconds later, by both routes', async () => {
    // 158 the grant, 159 its mirror line, 160 the Agent call's result, 163 the Bash call's result
    const lines = [...tasks.slice(0, 157), ...grantAfter(BASH_CALL), ...tasks.slice(157, 161)];
    expect(lines[159]!.uuid).toBe(AGENT_RESULT.uuid);
    expect(lines[162]!.uuid).toBe(BASH_RESULT.uuid);
    const read = await prefixes(lines, 157);
    expect.soft(read.file, 'from the file').toEqual(labelled(157, ['none', 'none', WAITING, WAITING, WAITING, WAITING, 'read']));
    expect.soft(read.link, 'through its rows').toEqual(labelled(157, ['none', WAITING, WAITING, WAITING, WAITING, WAITING, 'read']));
  });

  it('u3-tasks-r2, the same round answered in the other order (the Bash call’s result, then the Agent call’s): read at the second result, by both routes', async () => {
    // 158 the grant, 159 its mirror line, 160 the Bash call's result, 161 the Agent call's result
    const lines = [...tasks.slice(0, 157), ...grantAfter(BASH_CALL), BASH_RESULT, AGENT_RESULT];
    const read = await prefixes(lines, 159);
    expect.soft(read.file, 'from the file').toEqual(labelled(159, [WAITING, WAITING, 'read']));
    expect.soft(read.link, 'through its rows').toEqual(labelled(159, [WAITING, WAITING, 'read']));
  });

  it('u3-tasks-r2, one call in its round (the Bash call of line 138, answered at line 139): read at its result', () => {
    // 139 the grant, 140 its mirror line, 141 the call's result
    const lines = [...tasks.slice(0, 138), ...grantAfter(at(138)), at(139)];
    expect(readings(lines, 138)).toEqual(['none', 'none', WAITING, 'read']);
  });

  it('u3-tasks-r2, the parallel round interrupted after its first result (the Agent call’s; then u1c-t-esc-1’s rejected result for the Bash call, its marker and the bridge’s wake): it never reads at a result; it waits through the interrupt; the wake takes it', () => {
    const bashId = ((BASH_CALL.message as JsonObject).content as JsonObject[])[0]!.id as string;
    const rejected: JsonObject = { ...esc[53]!, uuid: 'rejected-43', parentUuid: BASH_CALL.uuid as string, sourceToolAssistantUUID: BASH_CALL.uuid as string, message: { role: 'user', content: [{ ...((esc[53]!.message as JsonObject).content as JsonObject[])[0]!, tool_use_id: bashId }] } };
    const marker: JsonObject = { ...esc[54]!, uuid: 'marker-43', parentUuid: 'rejected-43' };
    const wake: JsonObject = { ...esc[60]!, uuid: 'wake-43', parentUuid: 'marker-43' };
    // 158 the grant, 159 its mirror line, 160 the Agent call's result, 161 the rejected result, 162 the marker, 163 the wake
    const lines = [...tasks.slice(0, 157), ...grantAfter(BASH_CALL), AGENT_RESULT, rejected, marker, wake];
    expect(readings(lines, 159)).toEqual([WAITING, WAITING, WAITING, UNREAD, 'read']);
  });

  it('u3-tasks-r2, a subagent’s call and result (sidechain records) inside the parallel round: no read boundary; the round’s own last result is', () => {
    const sub = { isSidechain: true, agentId: 'a0sub43', sessionId: at(157).sessionId as string, timestamp: at(157).timestamp as string };
    const call: JsonObject = { ...sub, type: 'assistant', uuid: 'sub-call-43', parentUuid: null, message: { id: 'msg_sub_43', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'tool_use', id: 'toolu_sub_43', name: 'Bash', input: { command: 'true' } }] } };
    const result: JsonObject = { ...sub, type: 'user', uuid: 'sub-result-43', parentUuid: 'sub-call-43', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_sub_43', content: '' }] } };
    // 158 the grant, 159 its mirror line, 160 the subagent's call, 161 its result, 162 the Agent call's result, 163 the Bash call's
    const lines = [...tasks.slice(0, 157), ...grantAfter(BASH_CALL), call, result, AGENT_RESULT, BASH_RESULT];
    expect(readings(lines, 159)).toEqual([WAITING, WAITING, WAITING, WAITING, 'read']);
  });

  // Decision Log 49 (3): the engine's interruption results, each only where a recorded transcript holds it. The one
  // recorded form is `toolDenialKind: "interrupted"`, written for a call whose session ended before its result
  // (`pass3/p1-side-thread-live-resume`, the transcript its seq-35 snapshot holds: record 26 the Bash call, 27 its
  // interrupted result, 28 "No response requested.", 29 the next prompt).
  it('p1-side-thread-live-resume, the call its session ended during: its interrupted result is no read boundary; the next prompt’s turn takes the grant', () => {
    const snapshot = loadJournal('pass3', 'p1-side-thread-live-resume').find((row) => row.seq === 35)!.frame as { records: JsonObject[] };
    const records = snapshot.records;
    const call = records[26]!;
    expect(records[27]!.toolDenialKind).toBe('interrupted');
    expect(((records[28]!.message as JsonObject).content as JsonObject[])[0]!.text).toBe('No response requested.');
    // 28 the grant, 29 its mirror line, 30 the interrupted result, 31 "No response requested.", 32 the next prompt
    const lines = [...records.slice(0, 27), ...grantAfter(call), records[27]!, records[28]!, records[29]!];
    expect(readings(lines, 28)).toEqual(['none', WAITING, WAITING, WAITING, 'read']);
  });
});
