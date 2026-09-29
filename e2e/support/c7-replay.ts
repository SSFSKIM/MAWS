// C7's replay launches for its end-to-end specs: every `LaunchSpec` spreads from C7's one list of launch fields
// (`src/shared/composer/launch-defaults.ts`, which the Diagnostics launcher uses too; C10 is about to make new X6 fields
// mandatory, and the rebase is a change there), the bridge helpers, and the journal builders that put synthetic turns
// behind C3's handshake prelude.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { launchDefaults } from '../../src/shared/composer/launch-defaults';
import { REPO_ROOT } from './launch';

export const replaySpec = (appSessionId: string, replay: string, over: Partial<LaunchSpec> = {}): LaunchSpec => ({
  ...launchDefaults(appSessionId as AppSessionId, '/tmp/maws-e2e-replay'),
  ...over,
  appSessionId: appSessionId as AppSessionId,
  replay,
});

export function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as Promise<CommandResult<N>>;
}
export function value<N extends CommandName>(result: CommandResult<N>) {
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
  const rows = rowsOf('spikes/protocol-probe/fixtures/queue-and-interrupt.jsonl').filter((r) => ![146, 150, 191].includes(r.seq));
  return writeJournal(dir, `${name}-queue-interrupt`, rows);
}
