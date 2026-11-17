// C7's replay launches for its end-to-end specs: every `LaunchSpec` spreads from C7's one list of launch fields
// (`src/shared/composer/launch-defaults.ts`, which the Diagnostics launcher uses too; C10 is about to make new X6 fields
// mandatory, and the rebase is a change there), the bridge helpers, and the journal builders that put synthetic turns
// behind C3's handshake prelude.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { AskQuestion } from '@shared/maws/tools';
import { launchDefaults } from '../../src/shared/composer/launch-defaults';
import { consentMessage } from '../../src/shared/engine/arrival';
import { REPO_ROOT } from './launch';

export const replaySpec = (appSessionId: string, replay: string, over: Partial<LaunchSpec> = {}): LaunchSpec => ({
  ...launchDefaults(appSessionId as AppSessionId, '/tmp/maws-e2e-replay'),
  ...over,
  appSessionId: appSessionId as AppSessionId,
  replay,
});

export function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name as string, input as unknown] as const) as Promise<CommandResult<N>>;
}
export function value<N extends CommandName>(result: CommandResult<N>): CommandOutput<N> {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

export async function launchReady(page: Page, appSessionId: string, replay: string, over: Partial<LaunchSpec> = {}): Promise<void> {
  expect(value(await invoke(page, 'session.launch', { spec: replaySpec(appSessionId, replay, over) }))).toMatchObject({ status: 'launching' });
  await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId })).process).toBe('ready');
}

type Row = { seq: number; direction: 'in' | 'out' | 'meta'; at: string; frame: Record<string, unknown> };
const rowsOf = (path: string): Row[] =>
  readFileSync(join(REPO_ROOT, path), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Row);

// C3's handshake prelude, then `turns` human turns: the `user` write the replay holds at, the engine's `started`, a
// `result` and `completed`, so each turn ends and the next message is written rather than queued. The first turn
// carries `pass2/auto-routed`'s first `system/init` after its `started`, as the engine sends it (the catalogue's skills
// and terminal-only commands arrive there); an init before any prompt would open an engine turn.
export function turnsJournal(dir: string, name: string, turns: number): string {
  const journal = humanTurns();
  for (let k = 1; k <= turns; k++) journal.turn(k);
  return writeJournal(dir, `${name}-${turns}`, journal.rows);
}

// P5 O16 M3c (e2e/supervisor.spec.ts (f)'s deferred handover): one human turn in which the engine calls the `maws`
// server's `tool` and waits for its answer, which the journal holds as the `out` row the replay waits on, then ends.
export function toolCallJournal(dir: string, name: string, tool: string, args: Record<string, unknown> = {}): string {
  const journal = humanTurns();
  const at = journal.rows.length;
  journal.turn(1);
  const [user, started, init, result, completed] = journal.rows.splice(at) as [Row, Row, Row, Row, Row];
  const requestId = 'e2e-tool-call-0000-4000-8000-000000000001';
  const call = { type: 'control_request', request_id: requestId, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: tool, arguments: args, _meta: { 'claudecode/toolUseId': 'toolu_e2e_tool_call_01' } } } } };
  const answer = { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { mcp_response: { jsonrpc: '2.0', id: 7, result: { content: [] } } } } };
  let seq = user.seq;
  const rows: Row[] = [user, started, init, { ...init, direction: 'in', frame: call }, { ...init, direction: 'out', frame: answer }, result, completed];
  journal.rows.push(...rows.map((row) => ({ ...row, seq: seq++ })));
  return writeJournal(dir, name, journal.rows);
}

// The prelude and a builder of human turns behind it (turnsJournal's), for journals that add rows between turns.
function humanTurns() {
  const rows: Row[] = [...rowsOf('test/fixtures/engine/replay-handshake.jsonl')];
  const init = rowsOf('spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl').find((r) => r.seq === 9)!;
  const bash = rowsOf('spikes/protocol-probe/fixtures/pass2/bash-context-echoed.jsonl');
  const result = bash.find((r) => r.seq === 30)!.frame;
  const session = init.frame.session_id as string;
  let seq = rows.at(-1)!.seq;
  const at = '2026-09-29T12:00:00.000Z';
  const push = (direction: Row['direction'], frame: Record<string, unknown>) => rows.push({ seq: ++seq, direction, at, frame });
  const uuidOf = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
  const turn = (k: number) => {
    const uuid = uuidOf(k);
    push('out', { type: 'user', uuid, message: { role: 'user', content: `turn ${k}` }, parent_tool_use_id: null, origin: { kind: 'human' } });
    push('in', { type: 'command_lifecycle', command_uuid: uuid, state: 'started', uuid: `10000000-0000-4000-8000-${String(k).padStart(12, '0')}`, session_id: session });
    if (k === 1) push('in', init.frame);
    push('in', { ...result, session_id: session, uuid: `20000000-0000-4000-8000-${String(k).padStart(12, '0')}`, user_message_uuid: uuid, user_message_uuids: [uuid] });
    push('in', { type: 'command_lifecycle', command_uuid: uuid, state: 'completed', uuid: `30000000-0000-4000-8000-${String(k).padStart(12, '0')}`, session_id: session });
  };
  return { rows, push, turn, uuidOf };
}

function writeJournal(dir: string, name: string, rows: Row[]): string {
  const path = join(dir, `${name}-${Date.now()}.jsonl`);
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}

// Edit-and-resubmit against the replay: two turns, the `rewind_conversation` to turn 2 (the edited message), its
// answer as each case needs it, then the resent prompt as turn 3. `answered`: `rewound: true` at once. `held`: no
// answer before C3's 8 s bound, so the replay holds past it (C3 then withdraws the request with a
// `control_cancel_request`, recorded here) until the test issues a `get_context_usage` of its own (reads.jsonl seq
// 56-57), whose answer is followed by the late `rewound: true`, as a response inside C3's 60 s late table arrives.
// `withheld`: the cancel, and no answer at all. The replay matches the `user` write by type, so the resend's text is
// read from the `user.message` event, and a second `rewind_conversation` would end the replay as a mismatch.
export type RewindReplay = 'answered' | 'held' | 'withheld';
export function rewindJournal(dir: string, name: string, replay: RewindReplay): string {
  const journal = humanTurns();
  journal.turn(1);
  journal.turn(2);
  const requestId = '40000000-0000-4000-8000-000000000001';
  const target = journal.uuidOf(2);
  journal.push('out', { type: 'control_request', request_id: requestId, request: { subtype: 'rewind_conversation', target_message_uuid: target, last_seen_user_message_uuid: target, interrupt_if_running: false } });
  const answer = { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { rewound: true, targetMessageUuid: target, prefillText: 'turn 2', precedingAssistantUuid: null } } };
  if (replay === 'answered') journal.push('in', answer);
  else {
    journal.push('out', { type: 'control_cancel_request', request_id: requestId });
    if (replay === 'held') {
      const reads = rowsOf('spikes/protocol-probe/fixtures/reads.jsonl');
      journal.push('out', reads.find((r) => r.seq === 56)!.frame);
      journal.push('in', reads.find((r) => r.seq === 57)!.frame);
      journal.push('in', answer);
    }
  }
  journal.turn(3);
  return writeJournal(dir, `${name}-rewind-${replay}`, journal.rows);
}

// `queue-and-interrupt` (pass 1) as MAWS's app queue meets it: the probe wrote its second prompt into the running turn
// (seq 146; the engine queued it, seq 150, and cancelled it at the interrupt, seq 191), where MAWS holds a message sent
// during a turn in its own queue and writes it only when the queue releases it. Without those three rows the replay
// holds at the interrupt (seq 190) through the turn, and after it at the next prompt (seq 199), which the released
// entry is.
export function queueInterruptJournal(dir: string, name: string): string {
  const rows = rowsOf('spikes/protocol-probe/fixtures/queue-and-interrupt.jsonl').map((row) => {
    // App recording variant: the interrupt is a person cancelling, not the probe's diagnostic interrupt.
    if (row.direction !== 'out' || row.seq !== 190) return row;
    const frame = row.frame as { request: Record<string, unknown> };
    return { ...row, frame: { ...frame, request: { ...frame.request, reason: 'user-cancel', cancel_queued: false } } };
  }).filter((r) => ![146, 150, 191].includes(r.seq));
  return writeJournal(dir, `${name}-queue-interrupt`, rows);
}

// W10: `queue-and-interrupt` as the one Send meets it. The probe's second prompt, written into the running turn (seq
// 146) and queued by the engine (seq 150), is the Send's `next` steer; the plain stop (⌘.) first withdraws it into
// MAWS's queue with `cancel_async_message`, answered as `pass3/steer-next-cancelled` answers one (seq 34-36: the
// steer's `cancelled`, then `cancelled: true`), then interrupts (seq 190, its answer cancelling nothing, since the
// steer is already withdrawn; the probe's own cancel of it at seq 191 is dropped); Resume releases the held entry as the
// next prompt (seq 199). UX wave U4a (M8, the Stop scene): with `releases: 2` a second held message follows the first
// once its turn ends, as one more human turn in place of the probe's `bash_command` (seq 233, 235 to 237) and its exit
// (238), so the queue's second release is a recorded write.
export function steerStopJournal(dir: string, name: string, releases: 1 | 2 = 1): string {
  const rows = rowsOf('spikes/protocol-probe/fixtures/queue-and-interrupt.jsonl').map((row) => {
    // App recording variant: the interrupt is a person cancelling, not the probe's diagnostic interrupt.
    if (row.direction !== 'out' || row.seq !== 190) return row;
    const frame = row.frame as { request: Record<string, unknown> };
    return { ...row, frame: { ...frame, request: { ...frame.request, reason: 'user-cancel', cancel_queued: false } } };
  }).filter((r) => r.seq !== 191);
  const steer = rows.find((r) => r.seq === 146)!;
  steer.frame = { ...steer.frame, priority: 'next' };
  const session = rows.find((r) => r.seq === 150)!.frame.session_id;
  const interrupt = rows.findIndex((r) => r.seq === 190);
  const answer = rows.find((r) => r.seq === 192)!;
  answer.frame = { ...answer.frame, response: { ...(answer.frame.response as Record<string, unknown>), response: { still_queued: [], cancelled: [] } } };
  const withdrawal = rowsOf('spikes/protocol-probe/fixtures/pass3/steer-next-cancelled.jsonl')
    .filter((r) => [34, 35, 36].includes(r.seq))
    .map((r, k) => {
      const text = JSON.stringify(r.frame).replaceAll('d7fade79-6f39-40b6-91f3-9998597857b4', steer.frame.uuid as string);
      const frame = JSON.parse(text) as Record<string, unknown>;
      return { ...r, seq: 189 * 10 + k, frame: 'session_id' in frame ? { ...frame, session_id: session } : frame };
    });
  rows.splice(interrupt, 0, ...withdrawal);
  if (releases === 2) {
    const kept = rows.filter((r) => ![233, 235, 236, 237, 238].includes(r.seq)); // the first release's turn to its `completed` (234), without the exit
    const result = rowsOf('spikes/protocol-probe/fixtures/pass2/bash-context-echoed.jsonl').find((r) => r.seq === 30)!.frame;
    const uuid = '00000000-0000-4000-8000-000000000233';
    const at = kept.at(-1)!.at;
    const turn: Row[] = [
      { seq: 240, direction: 'out', at, frame: { type: 'user', uuid, message: { role: 'user', content: 'the second release' }, parent_tool_use_id: null, origin: { kind: 'human' } } },
      { seq: 241, direction: 'in', at, frame: { type: 'command_lifecycle', command_uuid: uuid, state: 'started', uuid: '10000000-0000-4000-8000-000000000233', session_id: session } },
      { seq: 242, direction: 'in', at, frame: { ...result, session_id: session, uuid: '20000000-0000-4000-8000-000000000233', user_message_uuid: uuid, user_message_uuids: [uuid] } },
      { seq: 243, direction: 'in', at, frame: { type: 'command_lifecycle', command_uuid: uuid, state: 'completed', uuid: '30000000-0000-4000-8000-000000000233', session_id: session } },
    ];
    return writeJournal(dir, `${name}-steer-stop-2`, [...kept, ...turn]);
  }
  return writeJournal(dir, `${name}-steer-stop`, rows);
}

// UX wave U4b (M4, the waiting answer's scene; the architect's ruling after the cascade merge with board ticket 711):
// `steerStopJournal` with the agent's async ask in its running turn, so the window holds the ask's row and a waiting
// answer to it reads through the ask's questions. The ask is `pass3/p1-maws-ask-async`'s: its call (seq 95, the
// assistant's `mcp__maws__ask` tool use) and the host's acknowledgement as the engine echoes it (107, `asked`), placed
// after the prompt's echo (9) and before the turn's first message starts (10), under this recording's session. The host
// serves no call here (the `tools/call` and its permission are not replayed): the transcript reads the ask from the call
// and its result, as a session read from the engine's transcript does.
const ASK_ASYNC = 'spikes/protocol-probe/fixtures/pass3/p1-maws-ask-async.jsonl';
const asyncAskRows = () => {
  const rows = rowsOf(ASK_ASYNC);
  return [rows.find((r) => r.seq === 95)!, rows.find((r) => r.seq === 107)!];
};
/** The recorded async ask's id (its call's tool use id) and questions, as its call holds them. */
export function asyncAsk(): { askId: string; questions: AskQuestion[] } {
  const [call] = asyncAskRows();
  const use = (call!.frame.message as { content: { id: string; input: { questions: AskQuestion[] } }[] }).content[0]!;
  return { askId: use.id, questions: use.input.questions };
}
export function askedSteerStopJournal(dir: string, name: string): string {
  const rows = (readFileSync(steerStopJournal(dir, name), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Row));
  const echo = rows.findIndex((r) => r.seq === 9);
  const session = rows.find((r) => r.seq === 150)!.frame.session_id;
  const asked = asyncAskRows().map((r, k): Row => ({ ...r, seq: 9 * 100 + k, at: rows[echo]!.at, frame: { ...r.frame, session_id: session } }));
  rows.splice(echo + 1, 0, ...asked);
  return writeJournal(dir, `${name}-asked-steer-stop`, rows);
}

// UX wave U4a (M8, the Send now scene): Send now behind a running command, as `uxwave/u4p2-a-1` recorded it on engine
// 2.1.322 under the environment MAWS's launch sets. C3's prelude stands in for the probe's handshake (seq 3 to 11, and
// the answer to its thinking-display write at 14, which the host's own write is answered in place of); then the probe's
// prompt (seq 12) and its Bash call running a long `node` command, the message at the next step (37), the engine's own
// send-now request (40) answered `delivering` (41), the command moved to the background (43 to 46), the cut turn's end
// (`success`, `aborted_tools`, 47), the message's own turn (49 to 193), and the moved command's end (194, 195) with the
// engine's turn after it. The meta rows go, the exit (239) with them, so the replay waits for the test's end.
export function sendNowJournal(dir: string, name: string): string {
  const rows = rowsOf('spikes/protocol-probe/fixtures/uxwave/u4p2-a-1.jsonl').filter((r) => r.seq >= 12 && r.seq !== 14 && r.direction !== 'meta');
  return writeJournal(dir, `${name}-send-now`, [...rowsOf('test/fixtures/engine/replay-handshake.jsonl'), ...rows]);
}

// UX wave U1b (decision 22, probe 8): Stop while the main loop's permission prompt waits, as
// `uxwave/u1b-intpend-main-r1` recorded it on engine 2.1.322 under MAWS's launch: the probe's prompt (seq 18), its Bash
// call and the call's `can_use_tool` (39); the replay then holds at Stop's interrupt (43), recorded as the plain stop
// writes it; after it the engine's `control_cancel_request` for the request (44), the interrupt's answer (45), the
// rejected call's result (48), the turn's end (`error_during_execution`, 50) and idle (52). C3's prelude stands in for
// the probe's handshake (3 to 16); the maws server's tool listing (19, its answer 20 and its echo 24) and the answer to
// the thinking-display write (21) go, as do the meta rows; the probe's late allow (54) and its next prompt are cut, so
// the replay waits for the test's end.
export function stopPendingJournal(dir: string, name: string): string {
  const rows = rowsOf('spikes/protocol-probe/fixtures/uxwave/u1b-intpend-main-r1.jsonl').filter((r) => r.seq >= 18 && r.seq <= 52 && ![19, 20, 21, 24].includes(r.seq) && r.direction !== 'meta');
  return writeJournal(dir, `${name}-stop-pending`, [...rowsOf('test/fixtures/engine/replay-handshake.jsonl'), ...rows]);
}

// UX wave U1b (acceptance 8's first sentence, probe 9a): a message sent while MAWS's blocking ask waits, as
// `uxwave/u1b-askwait-mcp-answer-r1` recorded it on engine 2.1.322 under MAWS's launch. C3's prelude stands in for the
// probe's handshake (its initialize 3 and answer 6, the surface's attach and panes 7, 11 to 13 and 15, the
// thinking-display write 16 and its answer 21); the engine's own handshake with the `maws` server stays (4, 5, 8 to 10,
// 14; the tool listing 19, 20, 24), answered by the host's real server. Then the probe's prompt (18), the ask's
// `tools/call` (58), held; the message (63), which the engine queues (64); the ask's answer (66), its result (68), the
// message's replay (69) and start (70), the reply and the turn's end (80) and idle (82). The meta rows go, and the
// probe's end_session and exit (85 to 87), so the replay waits for the test's end.
export function askWaitJournal(dir: string, name: string): string {
  const prelude = new Set([3, 6, 7, 11, 12, 13, 15, 16, 21]);
  const rows = rowsOf('spikes/protocol-probe/fixtures/uxwave/u1b-askwait-mcp-answer-r1.jsonl').filter((r) => r.direction !== 'meta' && !prelude.has(r.seq) && r.seq <= 82);
  return writeJournal(dir, `${name}-ask-wait`, [...rowsOf('test/fixtures/engine/replay-handshake.jsonl'), ...rows]);
}

// UX wave U4b (M3's conditional step; the Decision Log's line on the first Mac run): Send now on a row that waits after
// the turn while a turn runs is a promote at `next` and then the engine's send-now request for the uuid it answered, as
// `uxwave/u4b-two-1` recorded it early in a shell call with a message already waiting (spikes/protocol-probe/
// findings-uxwave-u4b-send-now-early.txt): the probe's prompt (seq 12) and its Bash call (32); the message at the next
// step (37, queued 39); the promoted message at `next` (40) and the request naming it (41), answered `delivering` with
// both still queued (44); the command moved (46 to 48) and the turn cut (`success`, `aborted_tools`, 50); both messages
// `started` (53, 54) and read as one turn (the joined replay, 58). The replay matches a user write by its type and maps
// each recorded uuid onto the one the host minted, so the request's `message_uuid` is held to the promoted message's own.
// C3's prelude stands in for the probe's handshake, and the answer at 14 and the meta rows go, as in `sendNowJournal`.
export function sendNowAfterJournal(dir: string, name: string): string {
  const rows = rowsOf('spikes/protocol-probe/fixtures/uxwave/u4b-two-1.jsonl').filter((r) => r.seq >= 12 && r.seq !== 14 && r.direction !== 'meta');
  return writeJournal(dir, `${name}-send-now-after`, [...rowsOf('test/fixtures/engine/replay-handshake.jsonl'), ...rows]);
}

// UX wave U1c (M5, scenes S1 and S2): a call auto mode blocked, its grant and what followed, as the probe recorded them on
// engine 2.1.322 under MAWS's launch (`uxwave/u1-soft-seeded-1`: the block, the grant, the retry that ran;
// `uxwave/u1-hard-seeded-1`: the block, the grant, the retry blocked again). C3's prelude stands in for the probe's
// handshake, and the probe's prompt is the first write; the answer to its thinking-display write goes (the host's own
// write is answered in its place), and the meta rows with it, the exit included, so the replay waits for the test's end.
// The replay holds at the grant's `user` write until the press writes it.
export function recordedBlockJournal(dir: string, name: string, fixture: 'u1-soft-seeded-1' | 'u1-hard-seeded-1'): string {
  const rows = rowsOf(`spikes/protocol-probe/fixtures/uxwave/${fixture}.jsonl`);
  const thinking = rows.find((r) => r.direction === 'out' && r.frame.type === 'control_request' && (r.frame.request as { subtype?: string }).subtype === 'set_max_thinking_tokens')!.frame.request_id;
  const answersThinking = (r: Row) => r.direction === 'in' && r.frame.type === 'control_response' && (r.frame.response as { request_id?: string }).request_id === thinking;
  const prompt = rows.findIndex((r) => r.direction === 'out' && r.frame.type === 'user');
  const kept = rows.slice(prompt).filter((r) => r.direction !== 'meta' && !answersThinking(r));
  return writeJournal(dir, `${name}-${fixture}`, [...rowsOf('test/fixtures/engine/replay-handshake.jsonl'), ...kept]);
}

// UX wave U1c (M5, scene S3): a blocked command of two lines whose turn runs on, built from `uxwave/u1c-b-1` (engine
// 2.1.322, probe B: in one turn the model runs the marker command, auto mode blocks it, and a 30 s foreground call
// follows; the grant written at the next step is read at that call's result, in the same turn). No recording holds a
// command of two lines, so the recorded command, the grant's sentence for it and the prompt are swapped for the scene's,
// wherever a frame holds one of them whole; the streamed deltas, the thinking and the task file's read go, so no frame
// holds the recorded command in part. The prompt's turn, the block (the call, the engine's `permission_denied` and the
// result marked `automode-blocked`) and the model's step past it, then the held call started (seq 12 to 201). The replay
// holds there, at the grant written at the next step (the recorded write, seq 137), until the press writes it; then the
// engine queues it (143), Delete withdraws it as `pass3/steer-next-cancelled` answers a withdrawal (seq 34 to 36), and
// the second press writes it again under a uuid of its own, which the engine queues. The held call's result, the grant
// read at it (the replay of its frame and its `started`, 205 and 206), the retry, which runs, and the turn's end follow
// (202 to 278), naming the second write.
export function blockedTurnJournal(dir: string, name: string, prompt: string, command: string): string {
  const recorded = rowsOf('spikes/protocol-probe/fixtures/uxwave/u1c-b-1.jsonl');
  const at = (seq: number) => recorded.find((r) => r.seq === seq)!;
  const recordedPrompt = (at(12).frame.message as { content: string }).content;
  const marker = (at(133).frame.message as { content: { input: { command: string } }[] }).content[0]!.input.command;
  const first = at(137).frame.uuid as string; // the grant's recorded write
  const second = '00000000-0000-4000-8000-0000000001c3'; // the second press's write
  const session = at(15).frame.session_id as string;
  const scene = swapping([[recordedPrompt, prompt], [marker, command], [consentMessage('command', marker), consentMessage('command', command)]]);
  const head = [12, 14, 15, 16, 17, 18, 133, 135, 140, 142, 183, 197, 201].map((seq) => scene(at(seq)));
  const grant = scene(at(137));
  const queued = at(143);
  const withdrawal = rowsOf('spikes/protocol-probe/fixtures/pass3/steer-next-cancelled.jsonl')
    .filter((r) => [34, 35, 36].includes(r.seq))
    .map(swapping([['d7fade79-6f39-40b6-91f3-9998597857b4', first], ['31f347b4-c94c-4fe7-a295-65e7667a8d76', session]]));
  const again = [{ ...grant, frame: { ...grant.frame, uuid: second } }, { ...queued, frame: { ...queued.frame, command_uuid: second, uuid: '10000000-0000-4000-8000-0000000001c3' } }];
  const named = swapping([[first, second]]);
  const tail = [202, 203, 204, 205, 206, 207, 262, 266, 267, 271, 275, 276, 278].map((seq) => named(scene(at(seq))));
  const prelude = rowsOf('test/fixtures/engine/replay-handshake.jsonl');
  const rows = [...head, grant, queued, ...withdrawal, ...again, ...tail].map((row, k) => ({ ...row, seq: prelude.at(-1)!.seq + 1 + k }));
  return writeJournal(dir, `${name}-blocked-turn`, [...prelude, ...rows]);
}

// A row with every string value that equals one of the pairs' first members replaced by its second, at any depth.
function swapping(pairs: [string, string][]): (row: Row) => Row {
  const map = new Map(pairs);
  const walk = (value: unknown): unknown =>
    typeof value === 'string' ? (map.get(value) ?? value)
      : Array.isArray(value) ? value.map(walk)
        : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]))
          : value;
  return (row) => ({ ...row, frame: walk(row.frame) as Row['frame'] });
}

// The UX wave, ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M3's scene): a prompt and MAWS's answer
// envelope waiting together, which the engine joined into one message, as probe 1 recorded it on engine 2.1.322 with a
// real non-blocking ask served by a `maws` server (`uxwave/u704-end-prompt-first-1`; spikes/protocol-probe/
// findings-uxwave-u704-envelope-split.txt). C3's prelude stands in for the probe's handshake (seq 3 to 17, the `maws`
// server's own MCP handshake among them, which the host's server does not need: it answers each message by itself);
// then the first prompt (18), the engine's `tools/list` (20) and its `ask` call (109) for the host's server to answer,
// the prompt at the next step (159) and the envelope after it (161) for the host to write, the turn's end (673, 674) and
// the joined replay (680) under the envelope's uuid, read as the second turn. The answer to the probe's thinking-display
// write (22) goes, as the host's own write is answered in place of it, and so do the meta rows, the exit (730) with them,
// so the replay waits for the test's end. The replay maps each recorded uuid onto the one the host minted.
export const JOINED_ANSWER_RECORDING = 'spikes/protocol-probe/fixtures/uxwave/u704-end-prompt-first-1.jsonl';
export function joinedAnswerJournal(dir: string, name: string): string {
  const rows = rowsOf(JOINED_ANSWER_RECORDING).filter((r) => r.seq >= 18 && r.seq !== 22 && r.direction !== 'meta');
  return writeJournal(dir, `${name}-joined-answer`, [...rowsOf('test/fixtures/engine/replay-handshake.jsonl'), ...rows]);
}
/** What the recording holds that the scene writes or reads: the frame MAWS wrote at `seq`, and the answers the host journaled. */
export function joinedAnswerRecorded(): { first: string; prompt: string; answers: unknown[] } {
  const rows = rowsOf(JOINED_ANSWER_RECORDING);
  const content = (seq: number) => ((rows.find((r) => r.seq === seq)!.frame as { message: { content: string } }).message.content);
  const answered = rows.find((r) => r.direction === 'meta' && r.frame.event === 'maws_ask_answered')!.frame as { answers: unknown[] };
  return { first: content(18), prompt: content(159), answers: answered.answers };
}
