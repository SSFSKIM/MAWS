// P2-C (M6): the replay journal e2e/to-human.spec.ts answers a question over. It is the launch main's replay seam
// (MAWS_E2E_REPLAY_FIXTURES) gives the session's first Send, so the launch is a decided one (Design §2) and sets the
// session's watermark. C3's handshake prelude answers as a direct session's; the rest are frames of the M5 fixture
// (test/fixtures/engine/p2c-report-marks.jsonl: U2 S13's init, tool call, tool result, text and result) with only
// content, ids and times changed, and the steer's lifecycle as pass3/steer-next.jsonl records one (`queued`, then
// `started` once the engine folds it into the running turn, `completed` at the turn's end). Two human turns:
//   1. a must-read, then the turn ends;
//   2. a question with two choices, then a Bash call left running. The replay holds at the answer's `next` steer, which
//      the card writes when the person clicks a choice; after its `queued`, it holds again at a `get_context_usage` of
//      the test's own (reads.jsonl seq 56-57, as e2e/composer.spec.ts's held rewind does), so the card reads Queued until
//      the test lets the engine start it. Then the tool result, the steer's `started`, a short reply and the turn's end.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './launch';
import { directStatus, PRELUDE_STATUS_ANSWER } from './side-replay';

type Row = { seq: number; direction: 'in' | 'out' | 'meta'; at: string; frame: Record<string, unknown> };
const rowsOf = (path: string): Row[] => readFileSync(join(REPO_ROOT, path), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Row);

export const TO_HUMAN = {
  first: 'Tell me the one thing I must not miss about the migration.',
  second: 'Ask me which README tone to use, then run the tests.',
  essential: 'The migration drops the legacy_users table. Back it up before you run it.',
  question: 'Which tone should the README use?',
  recommended: 'Concise reference style',
  other: 'Friendly guide style',
  reply: 'Using the concise reference style.',
};

const m5 = () => rowsOf('test/fixtures/engine/p2c-report-marks.jsonl');
// The engine session the journal's frames name: main's replay seam pins it, so the session on disk the test resumes
// carries it too.
export const toHumanSessionId = (): string => m5().find((row) => row.seq === 8)!.frame.session_id as string;

// The row writer both journals share (P2-C2): `push` dates each row 50 ms after the last, from `startAt`; the helpers
// write the frames a turn is made of, in the M5 fixture's shapes, under its engine session.
function scribe(startAt: number) {
  const rows0 = m5();
  const frame = (seq: number) => structuredClone(rows0.find((row) => row.seq === seq)!.frame);
  const session = frame(8).session_id as string;
  const rows: Row[] = [];
  let seq = 0;
  let clock = startAt;
  const now = () => new Date(clock).toISOString();
  const push = (direction: Row['direction'], f: Record<string, unknown>) => rows.push({ seq: ++seq, direction, at: new Date((clock += 50)).toISOString(), frame: f });
  const id = (n: number) => `7c2f0e10-0000-4000-8000-${String(n).padStart(12, '0')}`;
  let ids = 100;
  const lifecycle = (command: string, state: string) => push('in', { type: 'command_lifecycle', command_uuid: command, state, uuid: id(++ids), session_id: session });
  const running = (state: 'running' | 'idle' | 'requires_action') => push('in', { type: 'system', subtype: 'session_state_changed', state, uuid: id(++ids), session_id: session });
  const prompt = (uuid: string, content: string, priority?: 'next') => push('out', { type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' }, ...(priority && { priority }) });
  const echo = (uuid: string, content: string) => push('in', { type: 'user', message: { role: 'user', content }, session_id: session, parent_tool_use_id: null, uuid, timestamp: now(), isReplay: true, origin: { kind: 'human' } });
  const text = (message: string, uuid: string, body: string, user: string) => {
    const f = frame(12);
    Object.assign(f, { uuid, user_message_uuid: user, user_message_uuids: [user], timestamp: now() });
    Object.assign(f.message as Record<string, unknown>, { id: message, content: [{ type: 'text', text: body }] });
    push('in', f);
  };
  const result = (user: string, body: string) => push('in', { ...frame(13), uuid: id(++ids), result: body, user_message_uuid: user, user_message_uuids: [user], num_turns: 1 });
  // C3's handshake prelude, its `get_status` answered as a direct session's (side-replay.ts's rule): no gateway notice.
  // `afterInitialize` writes what the engine sends between MAWS's `initialize` and its answer.
  const prelude = (afterInitialize: () => void = () => undefined) => {
    for (const row of rowsOf('test/fixtures/engine/replay-handshake.jsonl')) {
      if (row.direction === 'meta') continue;
      push(row.direction, row.seq === PRELUDE_STATUS_ANSWER ? directStatus(row.frame) : row.frame);
      if (row.direction === 'out' && (row.frame.request as { subtype?: string } | undefined)?.subtype === 'initialize') afterInitialize();
    }
  };
  const write = (dir: string, name: string) => {
    const path = join(dir, `${name}-${Date.now()}.jsonl`);
    writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    return path;
  };
  return { frame, session, push, now, id, lifecycle, running, prompt, echo, text, result, prelude, write };
}

// `startAt`: the first row's time. A replayed event keeps its row's time, and a mark raises an attention item only when
// its message comes at or after the session's watermark (its first lane-on launch, Design §5), so the test dates the
// rows after the launch it is about to make.
export function toHumanJournal(dir: string, startAt: number): string {
  const { frame, push, now, id, lifecycle, running, prompt, echo, text, result, prelude, write } = scribe(startAt);
  const reads = rowsOf('spikes/protocol-probe/fixtures/reads.jsonl');

  push('meta', { event: 'provenance', charter: 'docs/charter.md', child: 'P2-C', spec: 'docs/doperpowers/plans/2026-10-08-p2-c-to-human.md', source: 'test/fixtures/engine/p2c-report-marks.jsonl', note: 'Synthetic (P2-C M6), built by e2e/support/to-human-replay.ts for e2e/to-human.spec.ts.' });
  prelude();

  // Turn 1: a must-read
  const u1 = id(1);
  prompt(u1, TO_HUMAN.first);
  running('running');
  lifecycle(u1, 'queued');
  lifecycle(u1, 'started');
  push('in', { ...frame(8), permissionMode: 'default' }); // the session's own mode (the test's settings say so): no mode to correct
  echo(u1, TO_HUMAN.first);
  const essential = `<essential>\n${TO_HUMAN.essential}\n</essential>`;
  text('msg_01P2cM6Essential', id(2), essential, u1);
  result(u1, essential);
  lifecycle(u1, 'completed');
  running('idle');

  // Turn 2: a question, then a tool left running while the person answers
  const u2 = id(3);
  prompt(u2, TO_HUMAN.second);
  running('running');
  lifecycle(u2, 'queued');
  lifecycle(u2, 'started');
  echo(u2, TO_HUMAN.second);
  text('msg_01P2cM6Question', id(4), `<need-input>${TO_HUMAN.question}\n<choice recommended>${TO_HUMAN.recommended}</choice>\n<choice>${TO_HUMAN.other}</choice>\n</need-input>`, u2);
  const tool = frame(10);
  Object.assign(tool, { uuid: id(5), user_message_uuid: u2, user_message_uuids: [u2] });
  Object.assign(tool.message as Record<string, unknown>, { id: 'msg_01P2cM6Tool', content: [{ type: 'tool_use', id: 'toolu_01P2cM6Tests', name: 'Bash', input: { command: 'sleep 20 && pnpm test', description: 'Run the tests' } }] });
  push('in', tool);
  const answer = id(6); // the card's answer, written as a `next` steer while the turn runs
  prompt(answer, `Answering "${TO_HUMAN.question}": ${TO_HUMAN.recommended}`, 'next');
  lifecycle(answer, 'queued');
  push('out', reads.find((row) => row.seq === 56)!.frame); // held: the test's own read lets the engine go on
  push('in', reads.find((row) => row.seq === 57)!.frame);
  const toolResult = frame(11);
  Object.assign(toolResult, { uuid: id(7), timestamp: now(), tool_use_result: { stdout: 'Tests 12 passed (12)', stderr: '', interrupted: false, isImage: false, noOutputExpected: false } });
  Object.assign(toolResult.message as Record<string, unknown>, { content: [{ tool_use_id: 'toolu_01P2cM6Tests', type: 'tool_result', content: 'Tests 12 passed (12)', is_error: false }] });
  push('in', toolResult);
  echo(answer, `Answering "${TO_HUMAN.question}": ${TO_HUMAN.recommended}`);
  lifecycle(answer, 'started');
  const reply = `<to-human>\n${TO_HUMAN.reply}\n</to-human>`;
  text('msg_01P2cM6Reply', id(8), reply, answer);
  result(u2, reply);
  lifecycle(answer, 'completed');
  lifecycle(u2, 'completed');
  running('idle');

  return write(dir, 'p2c-to-human');
}

// P2-C2 start: the journal of a session whose user output style declares contract 4 (a message-only style whose
// questions go through a tool), for e2e/to-human.spec.ts's supplement case. The launch is the decided one, as above.
// The engine reports the style it was given (`output_style`, so no mismatch is recorded) and the host's `maws` server,
// whose MCP handshake it runs between MAWS's `initialize` and its answer; the handshake, the async ask and the steer
// the sheet's answer writes are the frames of pass3/p1-maws-ask-async.jsonl (seq 4 to 20, 95, 104 to 107, 120) with only
// the session id changed, and the native question the frames of question-roundtrip.jsonl (seq 136 to 140) cut to one
// question. Two human turns:
//   1. a `<message>`, then an async `mcp__maws__ask`: the host answers its call `asked` at once, and the replay holds at
//      the steer the sheet writes when the person submits; the first turn ends, and the steer's turn replies;
//   2. a native AskUserQuestion: the engine's `can_use_tool` for it, held until the person answers its request card.
export const SUPPLEMENT = {
  style: 'report',
  first: 'Tell me how the migration went, then ask me whether to go on.',
  message: 'The migration ran: two columns added, nothing dropped.',
  askQuestion: 'Proceed?', // the recorded ask's one question (choices Yes and No)
  askReply: 'Going on with the next step.',
  second: 'Ask me which colour to use.',
  question: 'Which color do you prefer?',
  choices: ['Red', 'Blue'],
  reply: 'Using red.',
};

export function supplementJournal(dir: string, startAt: number): string {
  const { frame, session, push, id, lifecycle, running, prompt, echo, text, result, prelude, write } = scribe(startAt);
  const async = rowsOf('spikes/protocol-probe/fixtures/pass3/p1-maws-ask-async.jsonl');
  const recordedSession = async.find((row) => row.seq === 30)!.frame.session_id as string;
  // a recorded frame under this journal's engine session
  const ask = (seq: number) => JSON.parse(JSON.stringify(async.find((row) => row.seq === seq)!.frame).replaceAll(recordedSession, session)) as Record<string, unknown>;
  const native = rowsOf('spikes/protocol-probe/fixtures/question-roundtrip.jsonl');
  const nativeFrame = (seq: number) => structuredClone(native.find((row) => row.seq === seq)!.frame);

  push('meta', { event: 'provenance', charter: 'docs/charter.md', child: 'P2-C2', spec: 'docs/doperpowers/plans/2026-10-08-p2-daily-driver.md', source: 'test/fixtures/engine/p2c-report-marks.jsonl, spikes/protocol-probe/fixtures/pass3/p1-maws-ask-async.jsonl, spikes/protocol-probe/fixtures/question-roundtrip.jsonl', note: 'Synthetic (P2-C2), built by e2e/support/to-human-replay.ts for e2e/to-human.spec.ts.' });
  prelude(() => {
    for (const seq of [4, 5, 9, 10, 11, 15, 16, 17, 20]) push(async.find((row) => row.seq === seq)!.direction, ask(seq)); // the `maws` server's handshake
  });

  // Turn 1: a message, then an async ask answered from its sheet
  const u1 = id(1);
  prompt(u1, SUPPLEMENT.first);
  running('running');
  lifecycle(u1, 'queued');
  lifecycle(u1, 'started');
  const init = frame(8);
  Object.assign(init, { permissionMode: 'default', output_style: SUPPLEMENT.style, mcp_servers: [{ name: 'maws', status: 'connected' }] });
  push('in', init);
  echo(u1, SUPPLEMENT.first);
  text('msg_01P2c2Message', id(2), `<message>\n${SUPPLEMENT.message}\n</message>`, u1);
  const call = ask(95); // the assistant's mcp__maws__ask tool_use (blocking: false)
  Object.assign(call, { uuid: id(3), user_message_uuid: u1, user_message_uuids: [u1] });
  push('in', call);
  push('in', ask(104)); // the engine's tools/call
  push('out', ask(105)); // the host's answer: asked
  push('in', ask(106));
  push('in', ask(107)); // the tool result
  const steer = ask(120); // the sheet's answer, a `next` steer
  prompt(steer.uuid as string, (steer.message as { content: string }).content, 'next');
  lifecycle(steer.uuid as string, 'queued');
  result(u1, `<message>\n${SUPPLEMENT.message}\n</message>`);
  lifecycle(u1, 'completed');
  lifecycle(steer.uuid as string, 'started');
  echo(steer.uuid as string, (steer.message as { content: string }).content);
  text('msg_01P2c2AskReply', id(4), `<message>\n${SUPPLEMENT.askReply}\n</message>`, steer.uuid as string);
  result(steer.uuid as string, SUPPLEMENT.askReply);
  lifecycle(steer.uuid as string, 'completed');
  running('idle');

  // Turn 2: the native AskUserQuestion, which a headless launch keeps
  const u2 = id(5);
  prompt(u2, SUPPLEMENT.second);
  running('running');
  lifecycle(u2, 'queued');
  lifecycle(u2, 'started');
  echo(u2, SUPPLEMENT.second);
  const questions = [{ question: SUPPLEMENT.question, header: 'Color', options: SUPPLEMENT.choices.map((label) => ({ label, description: `${label}, the colour` })), multiSelect: false }];
  const toolUse = nativeFrame(136);
  const toolUseId = 'toolu_01P2c2NativeAsk';
  Object.assign(toolUse, { uuid: id(6), session_id: session, user_message_uuid: u2, user_message_uuids: [u2] });
  Object.assign(toolUse.message as Record<string, unknown>, { id: 'msg_01P2c2NativeAsk', content: [{ type: 'tool_use', id: toolUseId, name: 'AskUserQuestion', input: { questions } }] });
  push('in', toolUse);
  running('requires_action');
  const request = nativeFrame(137);
  Object.assign(request.request as Record<string, unknown>, { input: { questions }, tool_use_id: toolUseId });
  push('in', request);
  const answers = { [SUPPLEMENT.question]: SUPPLEMENT.choices[0]! };
  const response = nativeFrame(138); // matched by request id and behaviour (allow)
  Object.assign((response.response as { response: Record<string, unknown> }).response, { updatedInput: { questions, answers } });
  push('out', response);
  running('running');
  const toolResult = nativeFrame(140);
  Object.assign(toolResult, { uuid: id(7), session_id: session, tool_use_result: { questions, answers } });
  Object.assign(toolResult.message as Record<string, unknown>, { content: [{ type: 'tool_result', content: `Your questions have been answered: "${SUPPLEMENT.question}"="${SUPPLEMENT.choices[0]}". You can now continue with these answers in mind.`, tool_use_id: toolUseId }] });
  push('in', toolResult);
  text('msg_01P2c2NativeReply', id(8), `<message>\n${SUPPLEMENT.reply}\n</message>`, u2);
  result(u2, SUPPLEMENT.reply);
  lifecycle(u2, 'completed');
  running('idle');

  return write(dir, 'p2c2-supplement');
}
// P2-C2 end
