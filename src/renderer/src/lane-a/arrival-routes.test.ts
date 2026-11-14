// The routes agree (UX wave U3, first landing; docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, Acceptance 2, 4,
// 6 and 7; the child's A14, last sentence, and the wave's law 5). One recorded session is drawn from its transcript file,
// as the chain follower answers `session.events` for it on this Mac, from the same rows as another machine sends them
// (`freshSource`, the reader of another machine's rows), and from its journal as a session MAWS runs draws it (the
// journal through `Normalizer`, M4), and the arrival rows are the same: every message line, notice and command output,
// every user row, and each turn's origin and opener; the live route lacks only what the live wire does not carry, which
// the test states row by row. The rows written by hand (no probe recorded them) are invented, from the carriers' key
// sets. It lives beside the reader of another machine's rows, not in the transcript's model: the node project
// typechecks the model's directory, and that reader's graph is the renderer's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { journalToEvents } from '../transcript/dev/journal';
import { rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState, type TranscriptState } from '../transcript/model/reduce';
import type { Row } from '../transcript/model/rows';
import { freshSource, subagentLookupOf } from './plane-transcript';

const SESSION = '0f0e0d0c-0000-4000-8000-00000000c0de';

/** A recorded session's transcript file, as the engine wrote it: every line, the ones the reader of rows never sees too. */
const recorded = (name: string): string => readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.transcript.jsonl`), 'utf8');
const rowsIn = (text: string): JsonObject[] => text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject);

/** The file route: the chain follower over the file's bytes, as `session.events` answers for a session nobody holds. */
async function fromFile(text: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text), SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}

/** The file route followed on: a follower nobody holds, over a file the test writes on, read at each poke. */
async function following(text: string): Promise<{ reader: MemoryFileReader; follower: ChainFollower; events: SessionEvent[] }> {
  const events: SessionEvent[] = [];
  const reader = new MemoryFileReader(text);
  const follower = new ChainFollower(reader, SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  return { reader, follower, events };
}

/** The remote route: the same rows, each with its uuid, through the reader of another machine's rows. */
const fromRows = (text: string): Promise<SessionEvent[]> =>
  freshSource(rowsIn(text).filter((row) => typeof row.uuid === 'string'), SESSION, subagentLookupOf([])).snapshot();

/** The live route: the session's journal through the engine host's normaliser, as a session MAWS runs reaches the window. */
const fromJournal = (name: string): SessionEvent[] => journalToEvents(loadUxwaveJournal(name));

const stateOf = (events: SessionEvent[]): TranscriptState => applyEvents(createState(null, null), events);
const drawn = (state: TranscriptState): Row[] => rowsOf(withAllExpanded(state));
const firstLine = (text: string) => text.split('\n', 1)[0]!;

/** The arrival rows of a drawing, one line each, in order (Acceptance 7's list). */
function arrivalRows(rows: Row[]): string[] {
  return rows.flatMap((row): string[] => {
    switch (row.kind) {
      case 'divider':
        return [`turn ${row.origin}${row.opener === undefined ? '' : `, opened by ${row.opener.class}: ${row.opener.line}`}`];
      case 'agent_message':
        return [`› ${row.text}`];
      case 'notice':
        return [`● ${row.class}${row.outcome === null ? '' : ` ${row.outcome}`}: ${row.text}`];
      case 'local_command':
        return [`⎿ ${firstLine(row.text)}`];
      case 'user':
        return [`${row.consent !== undefined ? 'consent' : row.steer ? 'steer' : 'prompt'}: ${firstLine(row.text)}`];
      default:
        return [];
    }
  });
}

async function bothRoutes(text: string): Promise<{ file: TranscriptState; remote: TranscriptState }> {
  return { file: stateOf(await fromFile(text)), remote: stateOf(await fromRows(text)) };
}

const turnsOf = (state: TranscriptState) => state.order.map((id) => state.turns.get(id)!);
const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is Extract<Row, { kind: K }> => row.kind === kind);

describe('the file and another machine’s rows draw the same arrival rows (Acceptance 7)', () => {
  for (const name of ['u3-tasks-r1', 'u3-sminos-r1-maws', 'u3-cron-r1', 'u3-commands-r1', 'u3-sminos-r1-terminal', 'u3-terminal-cron-r1', 'u3-terminal-commands-r1', 'u3-terminal-checkin-r1', 'u3-tasks-r2']) {
    it(name, async () => {
      const { file, remote } = await bothRoutes(recorded(name));
      expect(arrivalRows(drawn(remote))).toEqual(arrivalRows(drawn(file)));
    });
  }
});

describe('a background task’s end, from the file (Acceptance 4)', () => {
  it('u3-tasks-r1: each end is one line where the agent was told, a hand-back the one line of its agent’s end, the monitor’s events and the stall notice in the file', async () => {
    const { file } = await bothRoutes(recorded('u3-tasks-r1'));
    const rows = arrivalRows(drawn(file));
    const notices = rows.filter((row) => row.startsWith('●') || row.startsWith('›'));
    expect(notices).toEqual([
      '● task completed: Background command "uxw ok" completed (exit code 0)',
      '● task failed: Background command "uxw fail" failed with exit code 1',
      '● task stopped: Task "uxw stop" was stopped by the user or by the app connected to this session',
      '› Report from uxw agent: PONG',
      '› Sent to uxw agent: Reply with only the word PONG2. Use no tool.', // the send's own line (UC-2, "The rows"), in the person's turn
      '● task completed: Agent "uxw agent" finished',
      '● task failed: Background command "uxw busy fail" failed with exit code 1',
      '● task completed: Background command "uxw busy ok" completed (exit code 0)',
      '› Report from uxw busy agent: PONG3',
      '● task: Monitor event: "uxw monitor"',
      '● task: Monitor event: "uxw monitor"',
      '● task: Monitor event: "uxw monitor"',
      '● task completed: Monitor "uxw monitor" stream ended',
      '● task: Monitor event: "uxw busy monitor"',
      '● task completed: Monitor "uxw busy monitor" stream ended',
      '● task: Background command "uxw stall" appears to be waiting for interactive input',
    ]);
    // An end told while idle stands above the divider of the turn it opened, which it names; the stopped task's,
    // delivered with the person's next prompt, directly above that prompt.
    const at = (line: string) => rows.indexOf(line);
    expect(rows[at('● task completed: Background command "uxw ok" completed (exit code 0)') + 1]).toBe('turn engine, opened by task: Background command "uxw ok" completed (exit code 0)');
    // UX wave U2 (O-15; the U2a document's C5): the turn the failed one opened only answers, so it has no line
    expect(rows).not.toContain('turn engine, opened by task: Background command "uxw fail" failed with exit code 1');
    expect(rows[at('● task stopped: Task "uxw stop" was stopped by the user or by the app connected to this session') + 1]).toMatch(/^prompt: Use the Agent tool/);
    // A hand-back's turn is the engine's ("Continued for"), opened by its report, which names the agent by its title
    expect(rows[at('› Report from uxw agent: PONG') - 1]).toBe('turn engine, opened by subagent: Report from uxw agent: PONG');
  });

  it('the notification a hand-back claimed while the session was idle makes no row and no turn, and still ends its agent (rule 5, decision 13)', async () => {
    const text = recorded('u3-tasks-r1');
    const claimed = rowsIn(text)[113]!; // line 114: marked queueTranscriptOnly, its task the hand-back's at line 104
    expect(claimed).toMatchObject({ queueTranscriptOnly: true, origin: { kind: 'task-notification' } });
    for (const events of [await fromFile(text), await fromRows(text)]) {
      const own = events.filter((event) => event.id === claimed.uuid || event.id.startsWith(`${claimed.uuid as string}#`));
      expect(own.map((event) => event.kind)).toEqual(['task.notification']);
      expect(own[0]).toMatchObject({ taskId: 'a91c8f61a920a8733', status: 'completed' });
    }
  });

  it('a block that claims no end ends nothing: a monitor’s event and the stall notice make no task event (decision 13)', async () => {
    const text = recorded('u3-tasks-r1');
    const events = await fromFile(text);
    const ended = new Set(events.flatMap((event) => (event.kind === 'task.notification' || event.kind === 'subagent.finished' ? [event.id.split('#')[0]] : [])));
    const lines = rowsIn(text);
    for (const line of [226, 234, 242, 271, 297]) expect(ended.has(lines[line - 1]!.uuid as string), `line ${line}`).toBe(false);
    expect(ended.has(lines[251]!.uuid as string)).toBe(true); // line 252, the monitor's end
  });
});

describe('sminos’s deliveries, from the file and another machine’s rows (Acceptance 2)', () => {
  it('u3-sminos-r1-maws, from its file, the same rows and its journal: a peer’s message is its line in a peer’s turn, never a user row; the owner’s send is their bubble without the frame line, idle, and a steer during a turn', async () => {
    const { file, remote } = await bothRoutes(recorded('u3-sminos-r1-maws'));
    for (const state of [file, remote, stateOf(fromJournal('u3-sminos-r1-maws'))]) {
      const rows = arrivalRows(drawn(state));
      expect(rows).toContain('prompt: UXW owner idle: reply with only the word ONE.');
      expect(rows).toContain('steer: UXW owner busy: also say THREE.');
      expect(rows.filter((row) => row.startsWith('›'))).toEqual(['› Message from @session:7ef6ac00: UXW peer idle: reply with only the word TWO.', '› Message from @session:7ef6ac00: UXW peer busy: also say FOUR.']);
      expect(rows[rows.indexOf('› Message from @session:7ef6ac00: UXW peer idle: reply with only the word TWO.') - 1]).toBe('turn peer, opened by peer: Message from @session:7ef6ac00: UXW peer idle: reply with only the word TWO.');
      expect(rows[rows.indexOf('prompt: UXW owner idle: reply with only the word ONE.') + 1]).toBe('turn human');
      expect(rows.join('\n')).not.toMatch(/\[sminos message from|From /);
    }
  });

  it('u3-sminos-r1-terminal: the bridge’s row from the owner is their bubble without its frame line; an appended one and a steer are steers, their mirror lines nothing; the answer a hook gave is its notice in the turn that took it', async () => {
    const { file, remote } = await bothRoutes(recorded('u3-sminos-r1-terminal'));
    for (const state of [file, remote]) {
      const rows = drawn(state);
      const lines = arrivalRows(rows);
      expect(lines).toContain('prompt: UXW owner idle: reply with only the word ONE.');
      expect(lines).toContain('steer: UXW owner busy: also say THREE.');
      expect(lines).toContain('steer: UXW steer busy: also say FIVE.');
      expect(lines.filter((row) => row.startsWith('● answer'))).toEqual(['● answer: answered: Fruit → Mango'] /* answeredWords' words (decision 9): the question's header */);
      expect(rows.some((row) => row.kind === 'error' && /sminos: (delivered|steer):/.test(row.text))).toBe(false);
    }
    // The hook's context carries the arrival for U1 (Interfaces G)
    const hook = (await fromFile(recorded('u3-sminos-r1-terminal'))).find((event) => event.kind === 'user.message' && event.arrival !== undefined && event.arrival[0]?.class === 'answer');
    expect(hook).toMatchObject({ isSynthetic: true, origin: 'task-notification', arrival: [{ class: 'answer', tool: 'sminos', call: 'toolu_01LHmQnUatVVN4dGUBrrJefV', dismissed: false }] });
  });

  // The whole-branch review's finding 1: a window of history that begins at the hook's answer (transcript line 112) has
  // no turn open for it; the answer is kept at the window's start, and the whole file, which an older page rebuilds the
  // view from, draws it once in the turn that took it. The window does not hold the call, so its line words the answer
  // from the summary's own pairs (decision 9); the whole file words it by the call's header
  it('u3-sminos-r1-terminal from line 112, the hook’s answer, on both routes: the answer’s line is drawn, as from the whole file', async () => {
    const whole = recorded('u3-sminos-r1-terminal');
    const window = `${whole.split('\n').slice(111).join('\n')}`;
    expect(rowsIn(window)[0]).toMatchObject({ type: 'attachment', attachment: { type: 'hook_additional_context' } });
    const answers = (state: TranscriptState) => arrivalRows(drawn(state)).filter((row) => row.startsWith('● answer'));
    for (const [text, line] of [[window, '● answer: answered: Which fruit do you prefer? → Mango'], [whole, '● answer: answered: Fruit → Mango']] as const) {
      const { file, remote } = await bothRoutes(text);
      expect(answers(file)).toEqual([line]);
      expect(answers(remote)).toEqual([line]);
    }
    const { file } = await bothRoutes(window);
    expect(drawn(file).find((row) => row.kind === 'notice')).toMatchObject({ class: 'answer', turnId: null }); // kept at the window's start
  });
});

// Rows written by hand, in the shapes the recorded ones have (no probe recorded them), with invented names and words.
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
function transcript(...rows: JsonObject[]): string {
  let parent: string | null = null;
  return rows
    .map((row, i) => {
      const uuid = id();
      const line = { parentUuid: parent, isSidechain: false, sessionId: SESSION, timestamp: `2026-11-12T10:00:${String(i).padStart(2, '0')}.000Z`, uuid, cwd: '/tmp/demo', ...row };
      parent = uuid;
      return JSON.stringify(line);
    })
    .join('\n');
}
const typed = (text: string, keys: JsonObject = {}): JsonObject => ({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', message: { role: 'user', content: text }, ...keys });
const said = (text: string): JsonObject => ({ type: 'assistant', message: { id: `msg_${n}`, role: 'assistant', model: 'claude-demo', type: 'message', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
const call = (toolUseId: string): JsonObject => ({ type: 'assistant', message: { id: `msg_${n}`, role: 'assistant', model: 'claude-demo', type: 'message', content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command: 'sleep 5' } }] } });
const result = (toolUseId: string): JsonObject => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'done', is_error: false }] } });
const ended = (): JsonObject => ({ type: 'system', subtype: 'turn_duration', durationMs: 1200, isMeta: false });
const submitted = (text: string): JsonObject => ({ type: 'user', origin: { kind: 'plugin', name: 'sminos', asUser: true }, promptSource: 'system', turnOrigin: 'system', message: { role: 'user', content: text } });
const appended = (text: string): JsonObject => ({ type: 'user', isMeta: true, origin: { kind: 'plugin', name: 'sminos' }, message: { role: 'user', content: [{ type: 'text', text }] } });
const mirror = (text: string): JsonObject => ({ type: 'system', subtype: 'informational', isMeta: false, level: 'notice', content: `sminos: delivered: ${text.replaceAll('\n', ' ')}` });
const TRAILER = '\n\nThis came from another Claude session — not typed by your user, but very likely working on their behalf.';
const inbox = (body: string): JsonObject => ({
  type: 'user', isMeta: true, origin: { kind: 'peer', from: 'unknown', name: 'human' }, promptSource: 'system', turnOrigin: 'peer',
  message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from-name="human">\n${body}\n</cross-session-message>${TRAILER}` },
});
const PEER_FRAME = '[sminos message from session:5b2c9e10 id=aa11bb22]';
const OWNED = '[sminos chat demo 7f3a2b1c:12 from river, owned by m-4821 → @you | unread 2]';

/** On both routes: the arrival rows, the turns' origins, and how many turns are still waiting to start. */
async function both(text: string) {
  const { file, remote } = await bothRoutes(text);
  const read = (state: TranscriptState) => ({ rows: arrivalRows(drawn(state)), pending: turnsOf(state).filter((turn) => !turn.accepted).length, users: ofKind(drawn(state), 'user').map((row) => row.text) });
  const [onFile, onRows] = [read(file), read(remote)];
  expect(onRows).toEqual(onFile);
  return onFile;
}

describe('deliveries no probe recorded, on both routes (Acceptance 2)', () => {
  it('a peer’s row the bridge submitted is one turn, a peer’s, holding the line: no bubble, no second turn of the person’s waiting beside it', async () => {
    const drawing = await both(transcript(submitted(`${PEER_FRAME}\nCould you rerun the lint?`), said('Rerunning it.'), ended()));
    expect(drawing).toEqual({ rows: ['turn peer, opened by peer: Message from @session:5b2c9e10: Could you rerun the lint?', '› Message from @session:5b2c9e10: Could you rerun the lint?'], pending: 0, users: [] });
  });

  it('a peer’s row the bridge appended into a running turn is its line there, its mirror line nothing', async () => {
    const text = `${PEER_FRAME}\nThe fixtures are ready.`;
    const drawing = await both(transcript(typed('Run the slow job.'), call('toolu_demo1'), appended(text), mirror(text), result('toolu_demo1'), said('Done.'), ended()));
    expect(drawing.rows).toEqual(['prompt: Run the slow job.', 'turn human', '› Message from @session:5b2c9e10: The fixtures are ready.']);
    expect(drawing.users).toEqual(['Run the slow job.']);
  });

  it('the owner’s steer by `sminos steer`’s inbox fallback is the owner’s bubble (X-032)', async () => {
    const drawing = await both(transcript(inbox('[sminos steer from human]\nStop after the tests.'), said('Stopping after the tests.'), ended()));
    expect(drawing).toEqual({ rows: ['prompt: Stop after the tests.'], pending: 0, users: ['Stop after the tests.'] });
  });

  it('the owner’s send whose words are the engine’s interrupt marker is a bubble, its frame line kept, and stops no turn', async () => {
    const { file, remote } = await bothRoutes(transcript(inbox('[sminos message from human id=0f0e0d0c]\n[Request interrupted by user]'), said('Noted.'), ended()));
    for (const state of [file, remote]) {
      expect(ofKind(drawn(state), 'user').map((row) => row.text)).toEqual(['[sminos message from human id=0f0e0d0c]\n[Request interrupted by user]']);
      // closed, and not as an interrupt closes a turn
      expect(turnsOf(state).map((turn) => [turn.origin, turn.state, turn.closedBy === 'stopped'])).toEqual([['human', 'closed', false]]);
    }
  });

  it('a background session’s prompt that opens with a peer’s frame is the peer’s line in a peer’s turn; with a frame from `human`, the owner’s bubble without it (decision 19)', async () => {
    const peer = await both(transcript(typed(`${OWNED}\nThe migration is merged.`, { sessionKind: 'bg' }), said('Thanks, picking it up.'), ended()));
    expect(peer).toEqual({ rows: ['turn peer, opened by peer: Message from @river: The migration is merged.', '› Message from @river: The migration is merged.'], pending: 0, users: [] });
    const queued = await both(transcript(typed(`${OWNED}\nThe migration is merged.`, { sessionKind: 'bg', promptSource: 'queued' }), said('Thanks.'), ended()));
    expect(queued.rows).toEqual(peer.rows);
    const own = await both(transcript(typed('[sminos message from human id=1a2b3c4d]\nKeep going with the tests.', { sessionKind: 'bg' }), said('Going on.'), ended()));
    expect(own).toEqual({ rows: ['prompt: Keep going with the tests.'], pending: 0, users: ['Keep going with the tests.'] });
    // without the session's kind the row is the person's typed prompt, whatever its first line
    const plain = await both(transcript(typed(`${OWNED}\nThe migration is merged.`), said('Ok.'), ended()));
    expect(plain.users).toEqual([`${OWNED}\nThe migration is merged.`]);
  });
});

describe('a scheduled prompt’s firing, from the file (Acceptance 7)', () => {
  // UX wave U2 (O-15; the U2a document's C5): each fired turn only answers, so the fire's row stands and the turn has no line
  it('a headless session’s meta row and a terminal’s fire row each open the engine’s turn, which only answers and has no line', async () => {
    for (const name of ['u3-cron-r1', 'u3-terminal-cron-r1']) {
      const rows = arrivalRows(drawn(stateOf(await fromFile(recorded(name)))));
      const fires = rows.filter((row) => row.startsWith('● schedule'));
      expect(fires.length, name).toBeGreaterThanOrEqual(3);
      for (const fire of new Set(fires)) expect(fire, name).toBe('● schedule: Running scheduled task · UXW tick: reply with only the word TOCK.');
      expect(rows.filter((row) => row.startsWith('turn engine, opened by schedule')), name).toEqual([]);
    }
  });

  // M3's fix round (review finding 1): a file, or the rows another machine sent, that end at a terminal's fire row
  // (its meta row not written yet, or never) still draw the fire where it stands, on the engine's turn it opens
  it('u3-terminal-cron-r1 cut at its first fire row: the line is drawn on both routes, once', async () => {
    // line 50: the fire, 51 its meta row; the cut ends with the line's newline, as a whole line written does
    const text = `${recorded('u3-terminal-cron-r1').split('\n').slice(0, 50).join('\n')}\n`;
    expect(rowsIn(text).at(-1)).toMatchObject({ type: 'system', subtype: 'scheduled_task_fire' });
    const { file, remote } = await bothRoutes(text);
    // UX wave U2 (O-15; the U2a document's C5): the fired turn's line follows its state on each route. The routes differ
    // here, a difference that predates this landing and is pinned as it is: at the cut's end the file route has closed
    // the turn, which did nothing and so has no line, and the remote route still runs it, so it reads `Working for …`
    const fired = (state: TranscriptState) => {
      const notice = drawn(state).find((row) => row.kind === 'notice' && row.class === 'schedule')!;
      const turn = state.turns.get(notice.turnId!)!;
      return { state: turn.state, accepted: turn.accepted, line: drawn(state).find((row): row is Extract<Row, { kind: 'divider' }> => row.kind === 'divider' && row.turnId === notice.turnId)?.state ?? null };
    };
    expect(fired(file), 'file').toEqual({ state: 'closed', accepted: true, line: null });
    expect(fired(remote), 'remote').toEqual({ state: 'open', accepted: true, line: 'working' });
    for (const [route, state] of [['file', file], ['remote', remote]] as const) {
      const rows = arrivalRows(drawn(state));
      expect(rows.filter((row) => row.startsWith('● schedule')), route).toEqual(['● schedule: Running scheduled task · UXW tick: reply with only the word TOCK.']);
    }
  });

  // M3's second fix round: nothing is held for the meta row, so a fire is placed wherever the rows it is read with end:
  // written after the backfill, at a reload's end, and before a meta row the follower reads after its exit
  const TICK = '● schedule: Running scheduled task · UXW tick: reply with only the word TOCK.';
  const OPENED = 'turn engine, opened by schedule: Running scheduled task · UXW tick: reply with only the word TOCK.';
  const cronLines = (from: number, to: number) => `${recorded('u3-terminal-cron-r1').split('\n').slice(from, to).join('\n')}\n`;
  const fireTurn = (state: TranscriptState) => turnsOf(state).find((turn) => turn.events.some((event) => event.kind === 'user.message' && event.arrival?.[0]?.class === 'schedule'));
  const answerTurn = (state: TranscriptState) => turnsOf(state).find((turn) => turn.events.some((event) => event.kind === 'assistant.block.complete' && event.block.type === 'text' && event.block.text === 'TOCK'));

  it('u3-terminal-cron-r1: a fire written after the backfill is drawn at the next read, in the engine’s turn it opens', async () => {
    const { reader, follower, events } = await following(cronLines(0, 49)); // to the queue rows before the first fire
    expect(arrivalRows(drawn(stateOf(events))).filter((row) => row.startsWith('● schedule'))).toEqual([]);
    reader.append(cronLines(49, 50));
    await follower.poke();
    follower.stop();
    const rows = arrivalRows(drawn(stateOf(events)));
    expect(rows.filter((row) => row.startsWith('● schedule'))).toEqual([TICK]);
    expect(rows.at(-1)).toBe(OPENED);
  });

  it('u3-terminal-cron-r1: a file rewritten to end at a fire draws it from the reload', async () => {
    const { reader, follower, events } = await following(cronLines(0, 49));
    reader.replace(cronLines(0, 50));
    await follower.poke();
    follower.stop();
    const rows = arrivalRows(drawn(stateOf(events)));
    expect(rows.filter((row) => row.startsWith('● schedule'))).toEqual([TICK]);
    expect(rows.at(-1)).toBe(OPENED);
  });

  it('u3-terminal-cron-r1: a meta row written after the follower’s exit ended the fire’s turn: the answer is in an engine turn, the line stays in the fire’s', async () => {
    const { reader, follower, events } = await following(cronLines(0, 50)); // nobody holds it: its unended turn gets the exit
    expect(events.at(-1)).toMatchObject({ kind: 'process.exited' });
    reader.append(cronLines(50, 54));
    await follower.poke();
    follower.stop();
    const state = stateOf(events);
    const rows = arrivalRows(drawn(state));
    expect(rows.filter((row) => row.startsWith('● schedule'))).toEqual([TICK]);
    const fire = fireTurn(state)!;
    expect(fire).toMatchObject({ origin: 'engine', state: 'closed' });
    expect(answerTurn(state)).toMatchObject({ origin: 'engine' });
    expect(answerTurn(state)!.id).not.toBe(fire.id);
  });
});

describe('a slash command’s output, from the file (Acceptance 6)', () => {
  it('u3-terminal-commands-r1: a command the terminal wrote as a `system` row has its bubble and its turn, and its output is under it, no escape in it', async () => {
    const state = stateOf(await fromFile(recorded('u3-terminal-commands-r1')));
    const rows = drawn(state);
    expect(JSON.stringify(rows)).not.toContain('\\u001b');
    const turns = turnsOf(state);
    for (const command of ['/context', '/rename uxw renamed', '/model uxw-no-such-model']) {
      const at = rows.findIndex((row) => row.kind === 'user' && row.text === command);
      expect(at, command).toBeGreaterThanOrEqual(0);
      expect(turns.find((turn) => turn.id === rows[at]!.turnId), command).toMatchObject({ origin: 'human', state: 'closed' });
      // a local command runs no model, so its turn ends where it starts and its output follows it, as a command's
      // `user` row has it from the file (backfill's localCommandTurn): the row under the bubble
      expect(rows.slice(at + 1).find((row) => row.kind !== 'time')?.kind, command).toBe('local_command');
    }
    expect(rows.filter((row) => row.kind === 'assistant_text').map((row) => (row as { markdown: string }).markdown).join('\n')).not.toMatch(/Session renamed to|Context Usage/);
  });

  it('u3-commands-r1: every output is a command output in its command’s turn, and none an answer', async () => {
    const rows = drawn(stateOf(await fromFile(recorded('u3-commands-r1'))));
    const answers = rows.flatMap((row) => (row.kind === 'assistant_text' ? [row.markdown] : [])).join('\n');
    expect(answers).not.toMatch(/Total cost|Context Usage|Reloaded:|Session renamed to|Compaction canceled|No messages to compact/);
    expect(rows.filter((row) => row.kind === 'local_command' && row.text.includes('Compaction canceled.'))).toHaveLength(1);
  });
});

// M4: the live half. What the live wire does not carry, row by row (Acceptance 7): a monitor's event, the stall notice and
// the withheld report's `Agent "…" finished` told while the session was idle (no frame tells the host the model was
// told: the engine turn opens with no `user` frame, findings-uxwave-u3-tasks.txt), each with the opener of the turn it
// opens in the file; and the prompt's text on a scheduled fire's line (the live wire's fire names no prompt). Beside
// them, one row that is no arrival's: the person's slash command as typed (`/cost`) where the file holds the command the
// engine ran (`/usage`, findings-uxwave-u3-commands.txt), a difference of the routes that predates this landing.
type Notice = { class: string; outcome: string | null; text: string };
const FILE_ONLY: Record<string, Notice[]> = {
  'u3-tasks-r1': [
    { class: 'task', outcome: null, text: 'Monitor event: "uxw monitor"' },
    { class: 'task', outcome: 'completed', text: 'Agent "uxw agent" finished' },
    { class: 'task', outcome: null, text: 'Background command "uxw stall" appears to be waiting for interactive input' },
  ],
  'u3-sminos-r1-maws': [],
  'u3-cron-r1': [],
  'u3-commands-r1': [],
};
// UX wave U2 (O-15; the U2a document's C5 and its point 10, "A turn nobody announced"): a turn whose one row in the file
// is a file-only notice and that only answers has nothing under it on the live wire, and so no line there
const UNANNOUNCED: Record<string, string[]> = { 'u3-tasks-r1': ['Monitor event: "uxw monitor"'] };
const FIRE_PROMPT = ' · UXW tick: reply with only the word TOCK.';
const TYPED: Record<string, [file: string, live: string][]> = { 'u3-commands-r1': [['prompt: /usage', 'prompt: /cost']] };

/** The file's arrival rows as the live route draws them: the stated differences taken out, and nothing else. */
function asTheLiveWireCarries(name: string, rows: string[]): string[] {
  const only = FILE_ONLY[name]!;
  return rows.flatMap((row) => {
    if (only.some((notice) => row === noticeRow(notice))) return [];
    const opened = only.find((notice) => row.endsWith(`, opened by ${notice.class}: ${notice.text}`));
    if (opened !== undefined && UNANNOUNCED[name]?.includes(opened.text)) return [];
    if (opened !== undefined) return [row.slice(0, row.length - `, opened by ${opened.class}: ${opened.text}`.length)];
    const typed = TYPED[name]?.find(([file]) => file === row);
    if (typed !== undefined) return [typed[1]];
    return [row.endsWith(FIRE_PROMPT) && row.includes('Running scheduled task') ? row.slice(0, -FIRE_PROMPT.length) : row];
  });
}
const noticeRow = (notice: Notice) => `● ${notice.class}${notice.outcome === null ? '' : ` ${notice.outcome}`}: ${notice.text}`;

describe('the live wire draws the file’s arrival rows but for what only the file carries (Acceptance 7)', () => {
  for (const name of ['u3-tasks-r1', 'u3-sminos-r1-maws', 'u3-cron-r1', 'u3-commands-r1']) {
    it(name, async () => {
      const file = arrivalRows(drawn(stateOf(await fromFile(recorded(name)))));
      const live = arrivalRows(drawn(stateOf(fromJournal(name))));
      expect(live).toEqual(asTheLiveWireCarries(name, file));
      // each stated difference is one: in the file, not on the live route
      for (const notice of FILE_ONLY[name]!) {
        expect(file, name).toContain(noticeRow(notice));
        expect(live, name).not.toContain(noticeRow(notice));
      }
      for (const [inFile, onLive] of TYPED[name] ?? []) expect([file.includes(inFile), live.includes(inFile), live.includes(onLive)], name).toEqual([true, false, true]);
      if (name === 'u3-cron-r1') expect([file.some((row) => row.endsWith(FIRE_PROMPT)), live.some((row) => row.endsWith(FIRE_PROMPT))]).toEqual([true, false]);
    });
  }
});

describe('a background task’s end, from the journal (Acceptance 4)', () => {
  const r1 = fromJournal('u3-tasks-r1');
  const at = (rows: string[], line: string) => rows.indexOf(line);

  it('u3-tasks-r1: an end told while idle stands above the divider of the engine’s turn it opens, drawn when that turn opens; the stopped task’s directly above the person’s next prompt', () => {
    const rows = arrivalRows(drawn(stateOf(r1)));
    expect(rows.filter((row) => row.startsWith('●') || row.startsWith('›'))).toEqual([
      '● task completed: Background command "uxw ok" completed (exit code 0)',
      '● task failed: Background command "uxw fail" failed with exit code 1',
      '● task stopped: Task "uxw stop" was stopped by the user or by the app connected to this session',
      '› Report from uxw agent: PONG',
      '› Sent to uxw agent: Reply with only the word PONG2. Use no tool.',
      '● task failed: Background command "uxw busy fail" failed with exit code 1',
      '● task completed: Background command "uxw busy ok" completed (exit code 0)',
      '› Report from uxw busy agent: PONG3',
      '● task completed: Monitor "uxw monitor" stream ended',
      '● task: Monitor event: "uxw busy monitor"',
      '● task completed: Monitor "uxw busy monitor" stream ended',
    ]);
    expect(rows[at(rows, '● task completed: Background command "uxw ok" completed (exit code 0)') + 1]).toBe('turn engine, opened by task: Background command "uxw ok" completed (exit code 0)');
    // UX wave U2 (O-15; the U2a document's C5): the turn the failed one opened only answers, so it has no line
    expect(rows).not.toContain('turn engine, opened by task: Background command "uxw fail" failed with exit code 1');
    expect(rows[at(rows, '● task stopped: Task "uxw stop" was stopped by the user or by the app connected to this session') + 1]).toMatch(/^prompt: Use the Agent tool/);
    // drawn when its turn opens: the journal read up to that turn's init
    const opened = journalToEvents(loadUxwaveJournal('u3-tasks-r1').filter((row) => row.seq <= 61));
    expect(arrivalRows(drawn(stateOf(opened))).slice(-2)).toEqual(['● task completed: Background command "uxw ok" completed (exit code 0)', 'turn engine, opened by task: Background command "uxw ok" completed (exit code 0)']);
  });

  it('u3-tasks-r1: the two commands that ended during a turn are notices where their frames arrived, among that turn’s work', () => {
    const rows = drawn(stateOf(r1));
    const prompt = rows.find((row) => row.kind === 'user' && row.text.startsWith('Do these in order'))!;
    for (const text of ['Background command "uxw busy fail" failed with exit code 1', 'Background command "uxw busy ok" completed (exit code 0)']) {
      const notice = rows.findIndex((row) => row.kind === 'notice' && row.text === text);
      expect(rows[notice]!.turnId, text).toBe(prompt.turnId);
      expect(rows.slice(0, notice).some((row) => row.turnId === prompt.turnId && (row.kind === 'cell' || row.kind === 'group')), text).toBe(true); // after work began
    }
  });

  it('a monitor’s end stands on the turn whose result names its run and on no other, in u3-tasks-r1 and in u3-tasks-r2 (placed and withdrawn twice first)', () => {
    for (const [name, endedAt] of [['u3-tasks-r1', 780], ['u3-tasks-r2', 624]] as const) {
      const state = stateOf(fromJournal(name));
      const ends = drawn(state).filter((row) => row.kind === 'notice' && row.text === 'Monitor "uxw monitor" stream ended');
      expect(ends, name).toHaveLength(1);
      const turn = state.turns.get(ends[0]!.turnId!)!;
      expect(turn.ended, name).toMatchObject({ seq: endedAt });
    }
  });

  it('no notice has a duration, a foreground command makes no row, and with its turn folded an end is among the rows and an event with no outcome is not', () => {
    const state = stateOf(r1);
    const all = drawn(state).flatMap((row) => (row.kind === 'notice' ? [row] : []));
    expect(all.filter((row) => row.durationMs !== null)).toEqual([]);
    expect(all.some((row) => row.text.includes('uxw foreground'))).toBe(false);
    expect(drawn(stateOf(fromJournal('u3-tasks-fg'))).filter((row) => row.kind === 'notice').map((row) => row.text)).toEqual(['Background command "uxw ok" completed (exit code 0)']);
    const folded = rowsOf(state).flatMap((row) => (row.kind === 'notice' ? [row.text] : []));
    expect(folded).toContain('Background command "uxw ok" completed (exit code 0)');
    expect(folded).not.toContain('Monitor event: "uxw busy monitor"');
  });
});

describe('a slash command’s output, from the journal (Acceptance 6)', () => {
  it('u3-commands-r1: each output is a command output in its command’s turn and no answer; /effort low draws nothing; “Compaction canceled.” is in the interrupted /compact’s turn once', () => {
    const rows = drawn(stateOf(fromJournal('u3-commands-r1')));
    for (const command of ['/cost', '/context', '/reload-plugins', '/rename uxw renamed', '/model uxw-no-such-model']) {
      const at = rows.findIndex((row) => row.kind === 'user' && row.text === command);
      const next = rows.slice(at + 1).find((row) => row.kind !== 'time');
      expect(next?.kind, command).toBe('local_command');
      expect(next?.turnId, command).toBe(rows[at]!.turnId);
    }
    const compacts = rows.filter((row) => row.kind === 'user' && row.text === '/compact');
    const first = rows.findIndex((row) => row.kind === 'user' && row.text === '/compact');
    expect(rows.slice(first + 1).find((row) => row.kind !== 'time')).toMatchObject({ kind: 'local_command', turnId: rows[first]!.turnId }); // nothing to compact
    const effort = rows.findIndex((row) => row.kind === 'user' && row.text === '/effort low');
    expect(rows.slice(effort + 1).find((row) => row.kind !== 'time')?.kind).toBe('user');
    const canceled = rows.filter((row) => row.kind === 'local_command' && row.text.includes('Compaction canceled.'));
    expect(canceled).toHaveLength(1);
    expect(canceled[0]!.turnId).toBe(compacts[2]!.turnId); // the third /compact, which the probe interrupted
    const answers = rows.flatMap((row) => (row.kind === 'assistant_text' ? [row.markdown] : [])).join('\n');
    expect(answers).not.toMatch(/Total cost|Context Usage|Reloaded:|Session renamed to|Compaction canceled|No messages to compact|ClaudeUsage routes/);
  });
});
