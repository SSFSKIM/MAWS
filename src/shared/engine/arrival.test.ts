// The arrivals reader (UX wave U3, UC-2; the U3a execution document, Acceptance 1, the child's A14): one table of the
// carriers it reads, from the probes' recorded sessions (spikes/protocol-probe/fixtures/uxwave/, findings-uxwave-u3-*.txt)
// wherever they hold the carrier, and written by hand with invented content where none does. Each recorded session is
// read whole, in order, through `readNext`, and the table names every frame or row that yields an arrival: one it does
// not name yields none.
import { describe, expect, it } from 'vitest';
import { askSteerText } from '@shared/maws/ask';
import { loadUxwaveJournal, loadUxwaveTranscript } from '../../../test/support/fixtures';
import { consentMessage, nothingOpen, readAnswerEnvelope, readArrivals, readNext, turnOriginOf, type Arrival, type OpenArrivals } from './arrival';

/** One arrival in a line: its class and what tells it apart. */
function said(arrival: Arrival): string {
  const first = (text: string) => text.split('\n', 1)[0];
  switch (arrival.class) {
    case 'peer':
      return `peer by ${arrival.via}${arrival.midTurn ? ', mid-turn' : ''}: ${arrival.sender.name ?? '?'} › ${first(arrival.body)}`;
    case 'subagent':
      return `subagent ${arrival.agentId}${arrival.report !== null ? `, report: ${first(arrival.report)}` : `: ${first(arrival.body)}`}`;
    case 'task':
      return `task ${arrival.outcome ?? 'with no end'}: ${arrival.summary}${arrival.runId === null ? '' : ` (run ${arrival.runId})`}`;
    case 'schedule':
      return `schedule: ${arrival.prompt ?? '(no prompt)'}`;
    case 'answer':
      return `answer by ${arrival.tool} to ${arrival.call}${arrival.dismissed ? ', dismissed' : ''}: ${first(arrival.summary)}`;
    case 'command':
      return `command ${arrival.run === null ? '(no run)' : `/${arrival.run.command}${arrival.run.args ? ` ${arrival.run.args}` : ''}`}: ${arrival.stderr !== '' ? `stderr ${first(arrival.stderr)}` : first(arrival.stdout)}`;
    case 'own':
      return `own ${arrival.via}: ${first(arrival.words)}`;
    case 'wake':
      return 'wake';
    case 'consent':
      return `consent to the ${arrival.kind} ${arrival.subject}`;
  }
}

/** Every arrival-bearing frame of a journal's engine output, by `seq`, read in order from nothing open. */
function journalArrivals(name: string): Record<number, string[]> {
  let open = nothingOpen;
  const out: Record<number, string[]> = {};
  for (const row of loadUxwaveJournal(name)) {
    if (row.direction !== 'in') continue;
    const read = readNext(row.frame, open);
    open = read.open;
    if (read.arrivals.length > 0) out[row.seq] = read.arrivals.map(said);
  }
  return out;
}

/** Every arrival-bearing row of a transcript file, by its line, read in order from nothing open. */
function transcriptArrivals(name: string): Record<number, string[]> {
  let open = nothingOpen;
  const out: Record<number, string[]> = {};
  loadUxwaveTranscript(name).forEach((row, i) => {
    const read = readNext(row, open);
    open = read.open;
    if (read.arrivals.length > 0) out[i + 1] = read.arrivals.map(said);
  });
  return out;
}

/** The arrivals of the last of `rows`, read in order from nothing open. */
function lastOf(rows: unknown[]): Arrival[] {
  let open: OpenArrivals = nothingOpen;
  let arrivals: Arrival[] = [];
  for (const row of rows) ({ arrivals, open } = readNext(row, open));
  return arrivals;
}

const frameOf = (name: string, seq: number): unknown => loadUxwaveJournal(name).find((row) => row.seq === seq)!.frame;
const rowOf = (name: string, line: number): unknown => loadUxwaveTranscript(name)[line - 1];

const OUTPUT = (task: string) => `/tmp/claude-501/-tmp-py-uKYfwV-work/fb15b826-4663-4368-9785-90a9ec37c4a9/tasks/${task}.output`;
const OK = 'Background command "uxw ok" completed (exit code 0)';
const FAIL = 'Background command "uxw fail" failed with exit code 1';
const STOPPED = 'Task "uxw stop" was stopped by the user or by the app connected to this session';
const BUSY_FAIL = 'Background command "uxw busy fail" failed with exit code 1';
const BUSY_OK = 'Background command "uxw busy ok" completed (exit code 0)';
const MONITOR_END = 'Monitor "uxw monitor" stream ended';
const BUSY_MONITOR_END = 'Monitor "uxw busy monitor" stream ended';

describe('the reader, over the probes’ recorded sessions (u3-tasks: task notifications and hand-backs)', () => {
  it('a session MAWS runs: a background command’s or monitor’s end on its system frame and on its replayed frame, a hand-back once, a foreground command’s frame and a stopped task’s none', () => {
    expect(journalArrivals('u3-tasks-r1')).toEqual({
      58: [`task completed: ${OK} (run 0mwdo00bz-9f5454ae)`], // idle: the system frame, kept for the result at 118
      148: [`task failed: ${FAIL} (run 0mwdo0vaw-64ed528d)`],
      // 216, the host's stop: its frame says `stopped` and holds the description; the block comes with the next prompt
      228: [`task stopped: ${STOPPED} (run 0mwdo1wz6-1b311c22)`],
      // 333, the agent's frame (handback: 'send'), is none; the hand-back is the agent's end, and no user frame follows
      337: ['subagent a91c8f61a920a8733, report: PONG'],
      // 418, the resumed agent's frame (handback: 'withheld'): an agent's, none; the wire then carries a turn and no sentence
      559: [`task failed: ${BUSY_FAIL} (run 0mwdo5gh5-47bafe76)`],
      578: [`task failed: ${BUSY_FAIL} (run 0mwdo5gh5-47bafe76)`], // the same end, taken in at a tool boundary
      581: [`task completed: ${BUSY_OK} (run 0mwdo5mb0-6cadaf3a)`],
      602: [`task completed: ${BUSY_OK} (run 0mwdo5mb0-6cadaf3a)`],
      // 600, 664, 826: the foreground commands' frames, none
      666: ['subagent ae47d5580a73561d0, report: PONG3'],
      // 667, the same agent's notification at the same tool boundary: the hand-back's second carrier, none (rule 5)
      743: [`task completed: ${MONITOR_END} (run 0mwdo8jdn-29730c86)`],
      824: [`task completed: ${BUSY_MONITOR_END} (run 0mwdo9e46-1ab63852)`],
      828: ['task with no end: Monitor event: "uxw busy monitor"'],
      829: [`task completed: ${BUSY_MONITOR_END} (run 0mwdo9e46-1ab63852)`],
      // 902, the stalled command the host stopped: none
    });
  });

  it('its transcript file: every notification row and queued command, a hand-back claiming its task’s next notification and not the one after a resume', () => {
    expect(transcriptArrivals('u3-tasks-r1')).toEqual({
      38: [`task completed: ${OK} (run 0mwdo00bz-9f5454ae)`],
      60: [`task failed: ${FAIL} (run 0mwdo0vaw-64ed528d)`],
      89: [`task stopped: ${STOPPED} (run 0mwdo1wz6-1b311c22)`], // the queued command, its run on the attachment
      104: ['subagent a91c8f61a920a8733, report: PONG'],
      // 114, the agent's notification marked queueTranscriptOnly: claimed by the hand-back at 104
      133: ['task completed: Agent "uxw agent" finished (run 0mwdo4j3k-45771648)'], // the resumed agent's end, its report withheld
      159: [`task failed: ${BUSY_FAIL} (run 0mwdo5gh5-47bafe76)`],
      167: [`task completed: ${BUSY_OK} (run 0mwdo5mb0-6cadaf3a)`],
      189: ['subagent ae47d5580a73561d0, report: PONG3'], // a queued command of the peer origin
      // 190, its notification: claimed
      226: ['task with no end: Monitor event: "uxw monitor"'],
      234: ['task with no end: Monitor event: "uxw monitor"'],
      242: ['task with no end: Monitor event: "uxw monitor"'],
      252: [`task completed: ${MONITOR_END} (run 0mwdo8jdn-29730c86)`],
      271: ['task with no end: Monitor event: "uxw busy monitor"'],
      272: [`task completed: ${BUSY_MONITOR_END} (run 0mwdo9e46-1ab63852)`],
      297: ['task with no end: Background command "uxw stall" appears to be waiting for interactive input'],
    });
  });

  it('reads each carrier’s fields: the system frame’s and the block’s, a monitor’s end carrying its last event, a stall’s advice, an agent’s duration', () => {
    const ended = lastOf(loadUxwaveJournal('u3-tasks-r1').filter((row) => row.direction === 'in' && row.seq <= 58).map((row) => row.frame));
    expect(ended).toEqual([{ class: 'task', taskId: 'bky1j6v31', toolUseId: 'toolu_01K77Emzzm6wXs615iRcFCA9', runId: '0mwdo00bz-9f5454ae', outcome: 'completed', summary: OK, durationMs: null, outputFile: OUTPUT('bky1j6v31'), detail: null }]);
    expect(readArrivals(rowOf('u3-tasks-r1', 60))).toEqual([{ class: 'task', taskId: 'bobq8duq2', toolUseId: 'toolu_01LT1MeGWt4SzKPVdDGYSk2E', runId: '0mwdo0vaw-64ed528d', outcome: 'failed', summary: FAIL, durationMs: null, outputFile: OUTPUT('bobq8duq2'), detail: null }]);
    expect(readArrivals(frameOf('u3-tasks-r1', 829))).toEqual([{ class: 'task', taskId: 'b7yxry0k8', toolUseId: 'toolu_01EZ8fohvMYQCLaghjweB174', runId: '0mwdo9e46-1ab63852', outcome: 'completed', summary: BUSY_MONITOR_END, durationMs: null, outputFile: OUTPUT('b7yxry0k8'), detail: 'UXW-BEVENT-2' }]);
    expect(readArrivals(frameOf('u3-tasks-r1', 828))).toEqual([{ class: 'task', taskId: 'b7yxry0k8', toolUseId: null, runId: null, outcome: null, summary: 'Monitor event: "uxw busy monitor"', durationMs: null, outputFile: null, detail: 'UXW-BEVENT-1' }]);
    const [stall] = readArrivals(rowOf('u3-tasks-r1', 297));
    expect(stall).toMatchObject({ class: 'task', taskId: 'b6qw9e9zq', outcome: null, outputFile: OUTPUT('b6qw9e9zq') });
    expect((stall as Extract<Arrival, { class: 'task' }>).detail).toMatch(/^Last output:\nContinue\? \(y\/n\)\n\nThe command is likely blocked on an interactive prompt\./);
    const [agent] = readArrivals(rowOf('u3-tasks-r1', 133));
    expect(agent).toMatchObject({ class: 'task', taskId: 'a91c8f61a920a8733', outcome: 'completed', durationMs: 55148 });
    expect((agent as Extract<Arrival, { class: 'task' }>).detail).toMatch(/^The subagent ended without delivering a report through SubagentHandback/);
    const [handback] = readArrivals(frameOf('u3-tasks-r1', 337));
    expect(handback).toMatchObject({ class: 'subagent', agentId: 'a91c8f61a920a8733', report: 'PONG', taskId: 'a91c8f61a920a8733' });
  });

  it('a task notification’s system frame yields nothing alone: whether its task was in the background is its start’s to say', () => {
    expect(readArrivals(frameOf('u3-tasks-r1', 58))).toEqual([]);
    // A foreground command moved to the background says so in a later update, and its end is then a carrier.
    const moved = [
      { type: 'system', subtype: 'task_started', task_id: 'b-1', run_id: 'r-1', tool_use_id: 'toolu_a', description: 'build', is_backgrounded: false, task_type: 'local_bash' },
      { type: 'system', subtype: 'task_updated', task_id: 'b-1', run_id: 'r-1', patch: { is_backgrounded: true } },
      { type: 'system', subtype: 'task_notification', task_id: 'b-1', run_id: 'r-1', tool_use_id: 'toolu_a', status: 'completed', output_file: '/tmp/demo/b-1.output', summary: 'Background command "build" completed (exit code 0)' },
    ];
    expect(lastOf(moved).map(said)).toEqual(['task completed: Background command "build" completed (exit code 0) (run r-1)']);
    expect(lastOf([moved[0], moved[2]])).toEqual([]);
  });

  it('a foreground command’s frame yields nothing (u3-tasks-fg): only the background command among them ends', () => {
    expect(journalArrivals('u3-tasks-fg')).toEqual({ 131: [`task completed: ${OK} (run 0mwdomtgh-8507e257)`] });
  });

  it('a check-in on a quiet command, in a terminal’s file, reports no end and keeps the engine’s advice (u3-terminal-checkin-r1)', () => {
    expect(transcriptArrivals('u3-terminal-checkin-r1')).toEqual({ 38: ['task with no end: Background command "uxw quiet" is still running after 10s, with no new output for 10s'] });
    expect(readArrivals(rowOf('u3-terminal-checkin-r1', 38))[0]).toMatchObject({ outcome: null, detail: expect.stringMatching(/^This is a check-in, not a completion\./) });
  });
});

describe('the reader, over sminos’s deliveries (u3-sminos)', () => {
  it('a session MAWS runs: the owner’s send and a peer’s by the inbox, idle and during a turn; the frame line says whose', () => {
    expect(journalArrivals('u3-sminos-r1-maws')).toEqual({
      54: ['own chat: UXW owner idle: reply with only the word ONE.'],
      100: ['peer by inbox: session:7ef6ac00 › UXW peer idle: reply with only the word TWO.'],
      264: ['own chat: UXW owner busy: also say THREE.'],
      387: ['peer by inbox, mid-turn: session:7ef6ac00 › UXW peer busy: also say FOUR.'],
    });
    expect(readArrivals(frameOf('u3-sminos-r1-maws', 54))).toEqual([{ class: 'own', via: 'chat', words: 'UXW owner idle: reply with only the word ONE.', frame: '[sminos message from human id=328cfd59]' }]);
    expect(readArrivals(frameOf('u3-sminos-r1-maws', 100))).toEqual([
      {
        class: 'peer', via: 'inbox', sender: { name: 'session:7ef6ac00', address: '', session: null, owners: null },
        body: 'UXW peer idle: reply with only the word TWO.', frame: '[sminos message from session:7ef6ac00 id=8f775ba5]', midTurn: false, lineage: 'peer', replyTo: null,
      },
    ]);
  });

  it('its file: the same four, the busy ones as queued commands', () => {
    expect(transcriptArrivals('u3-sminos-r1-maws')).toEqual({
      32: ['own chat: UXW owner idle: reply with only the word ONE.'],
      41: ['peer by inbox: session:7ef6ac00 › UXW peer idle: reply with only the word TWO.'],
      59: ['own chat: UXW owner busy: also say THREE.'],
      80: ['peer by inbox, mid-turn: session:7ef6ac00 › UXW peer busy: also say FOUR.'],
    });
  });

  it('a terminal session: the bridge’s submitted row, its appended row and a steer’s (their mirror lines yield nothing), a peer’s by the inbox, an answer by a hook’s context', () => {
    expect(transcriptArrivals('u3-sminos-r1-terminal')).toEqual({
      37: ['own chat: UXW owner idle: reply with only the word ONE.'],
      46: ['peer by inbox: session:36a90c26 › UXW peer idle: reply with only the word TWO.'],
      69: ['own chat: UXW owner busy: also say THREE.'], // 70, its mirror line: none
      84: ['own steer: UXW steer busy: also say FIVE.'], // 85, its mirror line: none
      112: ['answer by sminos to toolu_01LHmQnUatVVN4dGUBrrJefV: Your questions have been answered: "Which fruit do you prefer?"="Mango". You can now continue with these answers in mind.'],
    });
    expect(readArrivals(rowOf('u3-sminos-r1-terminal', 84))).toEqual([{ class: 'own', via: 'steer', words: 'UXW steer busy: also say FIVE.', frame: '[sminos steer from human]' }]);
    expect(readArrivals(rowOf('u3-sminos-r1-terminal', 112))).toEqual([
      { class: 'answer', tool: 'sminos', call: 'toolu_01LHmQnUatVVN4dGUBrrJefV', summary: 'Your questions have been answered: "Which fruit do you prefer?"="Mango". You can now continue with these answers in mind.', answers: null, dismissed: false },
    ]);
  });

  it('a hook’s context that is no answer yields nothing (u3-hookctx)', () => {
    expect(transcriptArrivals('u3-hookctx')).toEqual({});
    expect(journalArrivals('u3-hookctx')).toEqual({});
  });
});

// Rows sminos 1.46.2 no longer writes, or that no probe ran, in the shapes the recorded ones have (invented content).
const PEER_FRAME = '[sminos message from session:5b2c9e10 id=aa11bb22]';
const CHAT_FRAME = '[sminos chat demo a1b2c3d4:7 from sky-lab → @you]';
const submitted = (text: string) => ({ type: 'user', uuid: 'u-sub', origin: { kind: 'plugin', name: 'sminos', asUser: true }, promptSource: 'system', message: { role: 'user', content: text } });
const appended = (text: string) => ({ type: 'user', uuid: 'u-app', isMeta: true, origin: { kind: 'plugin', name: 'sminos' }, message: { role: 'user', content: [{ type: 'text', text }] } });
const mirror = (text: string) => ({ type: 'system', subtype: 'informational', uuid: 'u-mir', isMeta: false, level: 'notice', content: `sminos: delivered: ${text.replaceAll('\n', ' ')}` });
const TRAILER = '\n\nThis came from another Claude session — not typed by your user, but very likely working on their behalf.';
const inbox = (body: string, origin: Record<string, unknown> = { kind: 'peer', from: 'unknown', name: 'human' }) => ({
  type: 'user', uuid: 'u-in', isMeta: true, origin,
  message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message${origin.name === undefined ? '' : ` from-name="${String(origin.name)}"`}>\n${body}\n</cross-session-message>${TRAILER}` },
});

describe('the reader, on deliveries written by hand', () => {
  it('a peer’s row the bridge submitted, and one it appended with its mirror line after it: the peer’s, named by the frame, with no address to reply to', () => {
    expect(readArrivals(submitted(`${PEER_FRAME}\nCould you rerun the lint?`))).toEqual([
      { class: 'peer', via: 'bridge', sender: { name: 'session:5b2c9e10', address: '', session: null, owners: null }, body: 'Could you rerun the lint?', frame: PEER_FRAME, midTurn: false, lineage: 'peer', replyTo: null },
    ]);
    const text = `${CHAT_FRAME}\nThe fixtures are ready.`;
    let { arrivals, open } = readNext(appended(text), nothingOpen);
    expect(arrivals.map(said)).toEqual(['peer by bridge, mid-turn: sky-lab › The fixtures are ready.']);
    ({ arrivals, open } = readNext(mirror(text), open));
    expect(arrivals).toEqual([]);
  });

  it('the owner’s steer by `sminos steer`’s inbox fallback is the owner’s (X-032); the frame line decides when the origin names no one', () => {
    expect(readArrivals(inbox('[sminos steer from human]\nStop after the tests.'))).toEqual([{ class: 'own', via: 'steer', words: 'Stop after the tests.', frame: '[sminos steer from human]' }]);
    expect(readArrivals(inbox('[sminos message from human id=0f0e0d0c]\nAlso run the linter.', { kind: 'peer', from: 'unknown' })).map(said)).toEqual(['own chat: Also run the linter.']);
  });

  it('the owner’s words that alone read as the engine’s interrupt marker keep their frame line', () => {
    expect(readArrivals(inbox('[sminos message from human id=0f0e0d0c]\n[Request interrupted by user]'))).toEqual([
      { class: 'own', via: 'chat', words: '[sminos message from human id=0f0e0d0c]\n[Request interrupted by user]', frame: '[sminos message from human id=0f0e0d0c]' },
    ]);
  });

  it('the bridge’s wake, as the user and through the inbox', () => {
    expect(readArrivals(submitted('[sminos bridge]\nA message reached you while you were working; read it.'))).toEqual([{ class: 'wake' }]);
    expect(readArrivals(inbox('[sminos bridge]\nA message reached you while you were working; read it.'))).toEqual([{ class: 'wake' }]);
  });

  it('a teammate’s message to the lead, which names its sender and no address', () => {
    const row = { type: 'user', uuid: 'u-team', message: { role: 'user', content: '<teammate-message teammate_id="tester">\nThe suite passes.\n</teammate-message>' } };
    expect(readArrivals(row).map(said)).toEqual(['peer by team, mid-turn: tester › The suite passes.']);
  });

  // Decision 19: the engine's ordinary prompt row, written from its key set (no session file is copied).
  const seatPrompt = (content: string, keys: Record<string, unknown> = {}) => ({ type: 'user', uuid: 'u-seat', origin: { kind: 'human' }, promptSource: 'typed', sessionKind: 'bg', turnOrigin: 'human', message: { role: 'user', content }, ...keys });
  const OWNED = '[sminos chat demo 7f3a2b1c:12 from river, owned by m-4821 → @you | unread 2]';
  const REPLY = '[To reply, run in Bash: /opt/tools/sminos say "@demo/7f3a2b1c <your reply>"]';

  it('a background session’s prompt that opens with a whole frame line is that delivery: a peer’s with `via: prompt`, or the owner’s own', () => {
    expect(readArrivals(seatPrompt(`${OWNED}\nThe migration is merged.\n${REPLY}`))).toEqual([
      { class: 'peer', via: 'prompt', sender: { name: 'river', address: '', session: null, owners: ['m-4821'] }, body: 'The migration is merged.', frame: OWNED, midTurn: false, lineage: 'peer', replyTo: null },
    ]);
    expect(readArrivals(seatPrompt('[sminos message from session:9d0e1f2a id=4c5d6e7f]\nPlease review the plan.')).map(said)).toEqual(['peer by prompt: session:9d0e1f2a › Please review the plan.']);
    expect(readArrivals(seatPrompt('[sminos message from human id=1a2b3c4d]\nKeep going with the tests.'))).toEqual([{ class: 'own', via: 'chat', words: 'Keep going with the tests.', frame: '[sminos message from human id=1a2b3c4d]' }]);
    expect(readArrivals(seatPrompt(`${OWNED}\nThe migration is merged.`, { promptSource: 'queued' })).map(said)).toEqual(['peer by prompt: river › The migration is merged.']);
  });

  it('the same prompt without the session’s kind, or a frame line pasted into any other typed prompt, is the person’s and yields nothing', () => {
    const { sessionKind: _kind, ...withoutKind } = seatPrompt(`${OWNED}\nThe migration is merged.`);
    void _kind;
    expect(readArrivals(withoutKind)).toEqual([]);
    expect(readArrivals({ type: 'user', uuid: 'u-typed', origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content: `${PEER_FRAME}\nquoting what they sent me` } })).toEqual([]);
    expect(readArrivals(seatPrompt(`${OWNED} is the line to look for`))).toEqual([]); // no whole frame line with words after it
    expect(readArrivals({ type: 'user', uuid: 'u-typed', origin: { kind: 'human' }, message: { role: 'user', content: '<task-notification>\n<summary>typed</summary>\n</task-notification>' } })).toEqual([]);
  });
});

describe('the reader, on a background task’s notification block (rule 6)', () => {
  const notification = (blocks: string) => ({ type: 'user', uuid: 'u-n', origin: { kind: 'task-notification', producer: 'session-task' }, message: { role: 'user', content: blocks } });

  it('several blocks in one carrier are several arrivals, in order, the carrier naming no run for either', () => {
    const two = '<task-notification>\n<task-id>b-1</task-id>\n<status>completed</status>\n<summary>Background command "one" completed (exit code 0)</summary>\n</task-notification>\n\n<task-notification>\n<task-id>b-2</task-id>\n<status>failed</status>\n<summary>Background command "two" failed with exit code 2</summary>\n</task-notification>';
    expect(readArrivals({ ...notification(two), origin: { kind: 'task-notification', runId: 'r-9' } }).map(said)).toEqual(['task completed: Background command "one" completed (exit code 0)', 'task failed: Background command "two" failed with exit code 2']);
  });

  it('a block with no <summary> takes its first line; an agent’s that says it was stopped and has no <status> is stopped; an unlisted word claims no end, `error` is failed', () => {
    expect(readArrivals(notification('<task-notification>\nBackground task finished\n</task-notification>')).map(said)).toEqual(['task with no end: Background task finished']);
    expect(readArrivals(notification('<task-notification>\n<task-id>a-1</task-id>\n<summary>Agent "triage" was stopped by user</summary>\n</task-notification>')).map(said)).toEqual(['task stopped: Agent "triage" was stopped by user']);
    expect(readArrivals(notification('<task-notification>\n<status>paused</status>\n<summary>Workflow "nightly" paused</summary>\n</task-notification>')).map(said)).toEqual(['task with no end: Workflow "nightly" paused']);
    expect(readArrivals(notification('<task-notification>\n<status>error</status>\n<summary>Workflow "nightly" failed</summary>\n</task-notification>')).map(said)).toEqual(['task failed: Workflow "nightly" failed']);
    for (const word of ['killed', 'stopped', 'cancelled', 'interrupted']) expect(readArrivals(notification(`<task-notification>\n<status>${word}</status>\n<summary>s</summary>\n</task-notification>`))[0]).toMatchObject({ outcome: 'stopped' });
  });

  it('a subagent’s transcript holds its notifications after the engine’s preamble', () => {
    const text = '[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event.\n\n<task-notification>\n<task-id>b-3</task-id>\n<status>completed</status>\n<summary>Background command "probe" completed (exit code 0)</summary>\n</task-notification>';
    expect(readArrivals(notification(text)).map(said)).toEqual(['task completed: Background command "probe" completed (exit code 0)']);
  });
});

describe('the reader, on a scheduled prompt’s firing (u3-cron)', () => {
  it('on the live wire, the lifecycle frame of the fire, with no prompt', () => {
    expect(journalArrivals('u3-cron-r1')).toEqual({ 70: ['schedule: (no prompt)'], 85: ['schedule: (no prompt)'], 100: ['schedule: (no prompt)'], 154: ['schedule: (no prompt)'] });
  });

  it('in a headless session’s file, the meta row alone; in a terminal’s, the fire row, and the meta row after it yields nothing', () => {
    const tick = 'schedule: UXW tick: reply with only the word TOCK.';
    expect(transcriptArrivals('u3-cron-r1')).toEqual({ 47: [tick], 54: [tick], 61: [tick], 85: [tick] });
    expect(transcriptArrivals('u3-terminal-cron-r1')).toEqual({ 50: [tick], 57: [tick], 64: [tick] });
    // Tied by place where the engine wrote no `scheduledFireId`.
    const fire = rowOf('u3-terminal-cron-r1', 50) as Record<string, unknown>;
    const { scheduledFireId: _id, ...meta } = rowOf('u3-terminal-cron-r1', 51) as Record<string, unknown>;
    void _id;
    expect(lastOf([fire, meta])).toEqual([]);
    expect(lastOf([fire, { type: 'system', subtype: 'turn_duration', uuid: 'u-x' }, meta]).map(said)).toEqual([tick]);
  });
});

describe('the reader, on a slash command’s output (u3-commands)', () => {
  it('on the live wire: the assistant frame with `local_command_source` and the user frame of a compaction, the re-sent output too', () => {
    expect(journalArrivals('u3-commands-r1')).toEqual({
      28: ['command /compact: stderr Error: No messages to compact'],
      155: ['command (no run): Compacted '],
      167: ['command /usage: Total cost:            $0.0020'],
      179: ['command /context: ## Context Usage'],
      191: ['command /reload-plugins: Reloaded: 0 plugins · 0 skills · 5 agents · 0 hooks · 0 plugin LSP servers'],
      204: ['command /rename uxw renamed: Session renamed to: uxw renamed'],
      216: ['command /effort low: Set effort level to low (this session only): Quick, straightforward implementation with minimal overhead'],
      228: ['command /model uxw-no-such-model: API error: 400 ClaudeUsage routes Claude models only; got uxw-no-such-model · model not changed'],
      406: ['command (no run): Compaction canceled.'],
      422: ['command (no run): Compaction canceled.'], // sent again under the same uuid: the caller drops a uuid it mapped
      423: ['command (no run): Compacted '],
      // the unknown command is the model's prompt (241), the command's own replays and the summary are none
    });
  });

  it('in the file: the system rows and the user rows that hold an output; the command’s own rows, a caveat and an unknown command yield nothing', () => {
    expect(transcriptArrivals('u3-commands-r1')).toEqual({
      5: ['command (no run): stderr Error: No messages to compact'],
      45: ['command (no run): Compacted '],
      55: ['command (no run): Total cost:            $0.0020'],
      60: ['command (no run): ## Context Usage'],
      68: ['command (no run): Reloaded: 0 plugins · 0 skills · 5 agents · 0 hooks · 0 plugin LSP servers'],
      75: ['command (no run): Session renamed to: uxw renamed'],
      80: ['command (no run): Set effort level to low (this session only): Quick, straightforward implementation with minimal overhead'],
      85: ['command (no run): API error: 400 ClaudeUsage routes Claude models only; got uxw-no-such-model · model not changed'],
      133: ['command (no run): Compaction canceled.'],
      145: ['command (no run): Compacted '],
    });
    const terminal = transcriptArrivals('u3-terminal-commands-r1');
    expect(Object.keys(terminal).map(Number)).toEqual([6, 50, 57, 67, 71, 76, 78, 119]); // 56, 70 and 77 hold the command; 79 the unknown one
    expect(terminal[50]).toEqual(['command (no run): Compacted (ctrl+o to see full summary)']);
    expect(JSON.stringify(Object.values(terminal))).not.toContain('\\u001b');
  });

  it('reads the run the frame names and keeps the output as the tag held it', () => {
    expect(readArrivals(frameOf('u3-commands-r1', 204))).toEqual([{ class: 'command', run: { command: 'rename', args: 'uxw renamed' }, stdout: 'Session renamed to: uxw renamed', stderr: '' }]);
    expect(readArrivals(frameOf('u3-commands-r1', 28))).toEqual([{ class: 'command', run: { command: 'compact', args: '' }, stdout: '', stderr: 'Error: No messages to compact' }]);
  });
});

const QUESTIONS = [{ question: 'Which color do you prefer?', header: 'Color', options: [{ label: 'Blue' }, { label: 'Red' }] }];
const CHOSEN = 'Your questions have been answered: "Which color do you prefer?"="Blue". You can now continue with these answers in mind.';
const DISMISSED = 'The human dismissed these questions without answering them; no answer will come. Do not wait for one.';
const REFUSED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).";
const delivered = (call: string, summary: string) => `The human responded to your async AskUserQuestion (call ${call}): ${summary}`;
const pluginPrompt = (text: string) => ({ type: 'user', uuid: 'u-plug', origin: { kind: 'plugin', name: 'sminos' }, message: { role: 'user', content: `The sminos plugin sent a message:\n${text}\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.` } });
const hookContext = (text: string) => ({ type: 'attachment', uuid: 'u-hook', attachment: { type: 'hook_additional_context', content: [text], hookName: 'tool.call', toolUseID: 'tool.call-1-context', hookEvent: 'PostToolUse' } });

describe('the reader, on an answer to a question asked without waiting', () => {
  it('by the plugin’s prompt, an answer and a dismissal in one row: two arrivals, in order', () => {
    expect(readArrivals(pluginPrompt(`${delivered('toolu_a', CHOSEN)}\n\n${delivered('toolu_b', DISMISSED)}`))).toEqual([
      { class: 'answer', tool: 'sminos', call: 'toolu_a', summary: CHOSEN, answers: null, dismissed: false },
      { class: 'answer', tool: 'sminos', call: 'toolu_b', summary: DISMISSED, answers: null, dismissed: true },
    ]);
  });

  it('a dismissal by a hook’s context; the engine’s refusal after a declined dialog is no dismissal, nor is a sentence that only opens like one', () => {
    expect(readArrivals(hookContext(delivered('toolu_c', DISMISSED)))).toEqual([{ class: 'answer', tool: 'sminos', call: 'toolu_c', summary: DISMISSED, answers: null, dismissed: true }]);
    expect(readArrivals(hookContext(delivered('toolu_d', REFUSED)))[0]).toMatchObject({ dismissed: false, summary: REFUSED });
    expect(readArrivals(hookContext(delivered('toolu_e', `${DISMISSED} Ask again tomorrow.`)))[0]).toMatchObject({ dismissed: false });
  });

  it('MAWS’s own envelope, from its prompt and from its text alone; any other text is none', () => {
    const answers = [{ id: 'q1', question: 'Which color do you prefer?', status: 'answered' as const, value: ['Blue'] }];
    const text = askSteerText('toolu_f', QUESTIONS.map((q) => ({ ...q, modality: 'choice' as const })), answers);
    const expected = { class: 'answer', tool: 'maws', call: 'toolu_f', summary: text, answers, dismissed: false };
    expect(readAnswerEnvelope(text)).toEqual(expected);
    expect(readArrivals({ type: 'user', uuid: 'u-steer', origin: { kind: 'human' }, message: { role: 'user', content: text } })).toEqual([expected]);
    expect(readArrivals({ type: 'attachment', uuid: 'u-q', attachment: { type: 'queued_command', prompt: text, source_uuid: 'u-steer', commandMode: 'prompt', origin: { kind: 'human' } } })).toEqual([expected]);
    expect(readAnswerEnvelope('[MAWS ask toolu_f] The user answered the questions you asked:\n1. Color — Blue')).toBeNull();
    expect(readAnswerEnvelope(CHOSEN)).toBeNull();
  });
});

describe('the reader, on MAWS’s consent message (U1, l4-approvals-12)', () => {
  it('is one template with two words, the subject quoted as one JSON string', () => {
    expect(consentMessage('command', 'pnpm test')).toBe(
      'Permission granted for this exact command only, as one whole string: "pnpm test". This does not approve any other command, any part of this one, or running it with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry this exact command if you would like.',
    );
  });

  it('matches the sentence whole, for a command and for a call, on the person’s prompt; the same sentence with one word changed is none', () => {
    const prompt = (text: string) => ({ type: 'user', uuid: 'u-ok', origin: { kind: 'human' }, message: { role: 'user', content: text } });
    expect(readArrivals(prompt(consentMessage('command', 'git push --force-with-lease "origin" main')))).toEqual([{ class: 'consent', kind: 'command', subject: 'git push --force-with-lease "origin" main' }]);
    expect(readArrivals(prompt(consentMessage('call', '{"path":"/tmp/demo/notes.txt"}')))).toEqual([{ class: 'consent', kind: 'call', subject: '{"path":"/tmp/demo/notes.txt"}' }]);
    expect(readArrivals(prompt(consentMessage('command', 'pnpm test').replace('if you would like', 'if you wish')))).toEqual([]);
    expect(readArrivals(prompt(consentMessage('command', 'pnpm test').replace('exact command only', 'exact call only')))).toEqual([]);
    expect(readArrivals(prompt(`${consentMessage('command', 'pnpm test')} Thanks.`))).toEqual([]);
  });
});

describe('readNext and turnOriginOf', () => {
  it('is pure: the same row and state give the same reading, and the state passed in is not changed', () => {
    const started = readNext({ type: 'system', subtype: 'task_started', task_id: 'b-1', run_id: 'r-1', is_backgrounded: true, task_type: 'local_bash' }, nothingOpen).open;
    const before = structuredClone(started);
    const end = { type: 'system', subtype: 'task_notification', task_id: 'b-1', run_id: 'r-1', status: 'failed', output_file: '', summary: 'Background command "b" failed with exit code 1' };
    const first = readNext(end, started);
    expect(readNext(end, started)).toEqual(first);
    expect(started).toEqual(before);
    expect(first.arrivals).toEqual([{ class: 'task', taskId: 'b-1', toolUseId: null, runId: 'r-1', outcome: 'failed', summary: 'Background command "b" failed with exit code 1', durationMs: null, outputFile: null, detail: null }]);
    expect(nothingOpen.tasks.size).toBe(0);
  });

  it('gives each class the turn it opens', () => {
    const origins = Object.fromEntries(
      (
        [
          { class: 'own', via: 'chat', words: 'w', frame: 'f' },
          { class: 'consent', kind: 'command', subject: 's' },
          { class: 'peer', via: 'inbox', sender: { name: null, address: '', session: null, owners: null }, body: '', frame: null, midTurn: false, lineage: 'peer', replyTo: null },
          { class: 'subagent', agentId: 'a', body: '', report: null, taskId: null },
          { class: 'task', taskId: null, toolUseId: null, runId: null, outcome: null, summary: '', durationMs: null, outputFile: null, detail: null },
          { class: 'schedule', prompt: null },
          { class: 'answer', tool: 'sminos', call: 'c', summary: '', answers: null, dismissed: false },
          { class: 'command', run: null, stdout: '', stderr: '' },
          { class: 'wake' },
        ] satisfies Arrival[]
      ).map((arrival) => [arrival.class, turnOriginOf(arrival)]),
    );
    expect(origins).toEqual({ own: 'human', consent: 'human', peer: 'peer', subagent: 'engine', task: 'engine', schedule: 'engine', answer: 'engine', command: 'engine', wake: 'engine' });
  });
});
