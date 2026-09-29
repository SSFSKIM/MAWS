// C7's replay launches for its end-to-end specs: one shared `LaunchSpec` builder (C10 is about to make new X6 fields
// mandatory, so no C7 spec lists the fields itself; the rebase is a change here), the bridge helpers, and the journal
// builder that puts synthetic turns behind C3's handshake prelude.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { REPO_ROOT } from './launch';

const BASE: Omit<LaunchSpec, 'appSessionId' | 'replay'> = {
  cwd: '/tmp/maws-e2e-replay', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
  resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null,
};

export const replaySpec = (appSessionId: string, replay: string, over: Partial<LaunchSpec> = {}): LaunchSpec => ({ ...BASE, ...over, appSessionId: appSessionId as AppSessionId, replay });

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
  const rows: Row[] = [...rowsOf('test/fixtures/engine/replay-handshake.jsonl')];
  const init = rowsOf('spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl').find((r) => r.seq === 9)!;
  const bash = rowsOf('spikes/protocol-probe/fixtures/pass2/bash-context-echoed.jsonl');
  const result = bash.find((r) => r.seq === 30)!.frame;
  const session = init.frame.session_id as string;
  let seq = rows.at(-1)!.seq;
  const at = '2026-09-29T12:00:00.000Z';
  const push = (direction: Row['direction'], frame: Record<string, unknown>) => rows.push({ seq: ++seq, direction, at, frame });
  for (let k = 1; k <= turns; k++) {
    const uuid = `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
    push('out', { type: 'user', uuid, message: { role: 'user', content: `turn ${k}` }, parent_tool_use_id: null, origin: { kind: 'human' } });
    push('in', { type: 'command_lifecycle', command_uuid: uuid, state: 'started', uuid: `10000000-0000-4000-8000-${String(k).padStart(12, '0')}`, session_id: session });
    if (k === 1) push('in', init.frame);
    push('in', { ...result, session_id: session, uuid: `20000000-0000-4000-8000-${String(k).padStart(12, '0')}`, user_message_uuid: uuid, user_message_uuids: [uuid] });
    push('in', { type: 'command_lifecycle', command_uuid: uuid, state: 'completed', uuid: `30000000-0000-4000-8000-${String(k).padStart(12, '0')}`, session_id: session });
  }
  const path = join(dir, `${name}-${turns}-${Date.now()}.jsonl`);
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}
