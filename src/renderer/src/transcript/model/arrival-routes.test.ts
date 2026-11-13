// The routes agree (UX wave U3, first landing; docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, Acceptance 2, 4,
// 6 and 7; the child's A14, last sentence, and the wave's law 5). One recorded session is drawn from its transcript file,
// as the chain follower answers `session.events` for it on this Mac, and from the same rows as another machine sends
// them (`freshSource`, the reader of another machine's rows), and the arrival rows of the two are the same: every
// message line, notice and command output, every user row, and each turn's origin and opener. The rows written by hand
// (no probe recorded them) are invented, from the carriers' key sets. M4 adds the live half (the journal through
// `Normalizer`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { ChainFollower } from '../../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR } from '../../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../../test/support/memory-reader';
import { freshSource, subagentLookupOf } from '../../lane-a/plane-transcript';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Row } from './rows';

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

/** The remote route: the same rows, each with its uuid, through the reader of another machine's rows. */
const fromRows = (text: string): Promise<SessionEvent[]> =>
  freshSource(rowsIn(text).filter((row) => typeof row.uuid === 'string'), SESSION, subagentLookupOf([])).snapshot();

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
      '› Report from a91c8f61a920a8733: PONG',
      '● task completed: Agent "uxw agent" finished',
      '● task failed: Background command "uxw busy fail" failed with exit code 1',
      '● task completed: Background command "uxw busy ok" completed (exit code 0)',
      '› Report from ae47d5580a73561d0: PONG3',
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
    expect(rows[at('● task failed: Background command "uxw fail" failed with exit code 1') + 1]).toBe('turn engine, opened by task: Background command "uxw fail" failed with exit code 1');
    expect(rows[at('● task stopped: Task "uxw stop" was stopped by the user or by the app connected to this session') + 1]).toMatch(/^prompt: Use the Agent tool/);
    // A hand-back's turn is the engine's ("Continued for"), opened by its report
    expect(rows[at('› Report from a91c8f61a920a8733: PONG') - 1]).toBe('turn engine, opened by subagent: Report from a91c8f61a920a8733: PONG');
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
  it('u3-sminos-r1-maws: a peer’s message is its line in a peer’s turn, never a user row; the owner’s send is their bubble without the frame line, idle, and a steer during a turn', async () => {
    const { file, remote } = await bothRoutes(recorded('u3-sminos-r1-maws'));
    for (const state of [file, remote]) {
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
      expect(lines.filter((row) => row.startsWith('● answer'))).toEqual(['● answer: answered: Which fruit do you prefer? → Mango']);
      expect(rows.some((row) => row.kind === 'error' && /sminos: (delivered|steer):/.test(row.text))).toBe(false);
    }
    // The hook's context carries the arrival for U1 (Interfaces G)
    const hook = (await fromFile(recorded('u3-sminos-r1-terminal'))).find((event) => event.kind === 'user.message' && event.arrival !== undefined && event.arrival[0]?.class === 'answer');
    expect(hook).toMatchObject({ isSynthetic: true, origin: 'task-notification', arrival: [{ class: 'answer', tool: 'sminos', call: 'toolu_01LHmQnUatVVN4dGUBrrJefV', dismissed: false }] });
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
    expect(drawing).toEqual({ rows: ['prompt: Stop after the tests.', 'turn human'], pending: 0, users: ['Stop after the tests.'] });
  });

  it('the owner’s send whose words are the engine’s interrupt marker is a bubble, its frame line kept, and stops no turn', async () => {
    const { file, remote } = await bothRoutes(transcript(inbox('[sminos message from human id=0f0e0d0c]\n[Request interrupted by user]'), said('Noted.'), ended()));
    for (const state of [file, remote]) {
      expect(ofKind(drawn(state), 'user').map((row) => row.text)).toEqual(['[sminos message from human id=0f0e0d0c]\n[Request interrupted by user]']);
      expect(turnsOf(state).map((turn) => [turn.origin, turn.closedBy])).toEqual([['human', 'completed']]);
    }
  });

  it('a background session’s prompt that opens with a peer’s frame is the peer’s line in a peer’s turn; with a frame from `human`, the owner’s bubble without it (decision 19)', async () => {
    const peer = await both(transcript(typed(`${OWNED}\nThe migration is merged.`, { sessionKind: 'bg' }), said('Thanks, picking it up.'), ended()));
    expect(peer).toEqual({ rows: ['turn peer, opened by peer: Message from @river: The migration is merged.', '› Message from @river: The migration is merged.'], pending: 0, users: [] });
    const queued = await both(transcript(typed(`${OWNED}\nThe migration is merged.`, { sessionKind: 'bg', promptSource: 'queued' }), said('Thanks.'), ended()));
    expect(queued.rows).toEqual(peer.rows);
    const own = await both(transcript(typed('[sminos message from human id=1a2b3c4d]\nKeep going with the tests.', { sessionKind: 'bg' }), said('Going on.'), ended()));
    expect(own).toEqual({ rows: ['prompt: Keep going with the tests.', 'turn human'], pending: 0, users: ['Keep going with the tests.'] });
    // without the session's kind the row is the person's typed prompt, whatever its first line
    const plain = await both(transcript(typed(`${OWNED}\nThe migration is merged.`), said('Ok.'), ended()));
    expect(plain.users).toEqual([`${OWNED}\nThe migration is merged.`]);
  });
});

describe('a scheduled prompt’s firing, from the file (Acceptance 7)', () => {
  it('a headless session’s meta row and a terminal’s fire row each open the engine’s turn, which the line names', async () => {
    for (const name of ['u3-cron-r1', 'u3-terminal-cron-r1']) {
      const rows = arrivalRows(drawn(stateOf(await fromFile(recorded(name)))));
      const fires = rows.filter((row) => row.startsWith('● schedule'));
      expect(fires.length, name).toBeGreaterThanOrEqual(3);
      for (const fire of new Set(fires)) expect(fire, name).toBe('● schedule: Running scheduled task · UXW tick: reply with only the word TOCK.');
      expect(rows[rows.indexOf(fires[0]!) + 1], name).toBe('turn engine, opened by schedule: Running scheduled task · UXW tick: reply with only the word TOCK.');
    }
  });
});

describe('a slash command’s output, from the file (Acceptance 6)', () => {
  it('u3-terminal-commands-r1: a command the terminal wrote as a `system` row has its bubble and its turn, and its output is in that turn, no escape in it', async () => {
    const state = stateOf(await fromFile(recorded('u3-terminal-commands-r1')));
    const rows = drawn(state);
    expect(JSON.stringify(rows)).not.toContain('\\u001b');
    for (const command of ['/context', '/rename uxw renamed', '/model uxw-no-such-model']) {
      const at = rows.findIndex((row) => row.kind === 'user' && row.text === command);
      expect(at, command).toBeGreaterThanOrEqual(0);
      const turn = rows[at]!.turnId;
      expect(rows.some((row) => row.kind === 'local_command' && row.turnId === turn), command).toBe(true);
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
