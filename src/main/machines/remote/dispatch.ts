// The router's path to an RL2 machine (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The router's
// path", Interfaces §F): `MachineLink.dispatch` for a remote link. A command whose grade is plainly `list` or `view` goes
// as an RL2 `call` and its output is read with the link surface's codec; every other command needs an action, whose
// context and digest come from what the person saw (M2 builds those for lane B), so it is refused here without a round
// trip. `ClientRef` is not sent: the channel's member and device are the caller (RL §5.5).
//
// P5 O7 M4 ("The checkout rule and its boundary"): the session a path-class command is made from (`MainContext.session`,
// from the preload envelope) goes as the call's `session`, which the endpoint's `checkout` rule bounds a `git.*` read by.
// The link sends it only to a peer that listed `rl2.call-session`; without it such a read is the endpoint's `no-target`
// (a current endpoint) or `not-offered` (an older one, which offers no checkout row).
//
// A refusal keeps the IPC error codes as they are, since an added code is breaking (O1): `offline` and `unavailable` are
// `host_unavailable`, `timeout` is `timeout`, an `IPC_ERROR_CODES` member passes through, and anything else is `internal`
// with the machine's word in `issues.refusal`.
import { ipcError, IPC_ERROR_CODES, type IpcErrorCode } from '@shared/ipc/errors';
import type { AppSessionId } from '@shared/graph/ids';
import { gradeOf } from '@shared/ipc/grades';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { codecOf } from '@shared/ipc/validate';
import { LINK_REGISTRY, onLink } from '../link-surface';
import type { SessionRef } from '../../../../apps/org-protocol/src/index.ts';
import type { CallResult } from './link';

const codec = codecOf(LINK_REGISTRY);
const isIpcCode = (code: string): code is IpcErrorCode => (IPC_ERROR_CODES as readonly string[]).includes(code);

/** A refusal of `name` by machine `machine` as the router's IPC error (§F). */
export function refusalError(name: string, machine: string, error: { code: string; message?: string }): CommandResult<CommandName> {
  const { code } = error;
  if (code === 'offline' || code === 'unavailable') return { ok: false, error: ipcError('host_unavailable', `${name}: machine ${machine} is ${code === 'offline' ? 'not reachable' : 'unavailable'}`) };
  if (code === 'timeout') return { ok: false, error: ipcError('timeout', error.message ?? `${name}: machine ${machine} did not answer in time`) };
  if (isIpcCode(code)) return { ok: false, error: ipcError(code, error.message ?? `${name}: ${code} on machine ${machine}`) };
  return { ok: false, error: ipcError('internal', `${name}: refused ${code} by machine ${machine}`, { refusal: code }) };
}

/**
 * JSON has no undefined: the endpoint answers a command that returned nothing as `output: null` (calls.ts), so a null
 * where the command's output takes no null but takes undefined is that nothing.
 */
function voidAsUndefined(name: CommandName, output: unknown): unknown {
  if (output !== null) return output;
  const schema = LINK_REGISTRY.commands[name]!.output;
  return !schema.safeParse(null).success && schema.safeParse(undefined).success ? undefined : output;
}

type Caller = { readonly name: string; call(name: string, input: unknown, options?: { session?: SessionRef }): Promise<CallResult> };

export async function dispatchOverLink(link: Caller, name: CommandName, input: unknown, session?: AppSessionId): Promise<CommandResult<CommandName>> {
  if (!onLink(name)) return { ok: false, error: ipcError('host_unavailable', `${name}: machine ${link.name} cannot answer it: ${name} does not cross a machine link`) };
  const grade = gradeOf(name);
  if (grade !== 'list' && grade !== 'view') return { ok: false, error: ipcError('internal', `${name}: refused act-required by machine ${link.name}`, { refusal: 'act-required' }) };
  // A remote session's checkout is lane B's: lane A's roots are sminos's, which no `checkout` row reads.
  const result = await (session === undefined ? link.call(name, input) : link.call(name, input, { session: { lane: 'B', id: session } }));
  if (!result.ok) return refusalError(name, link.name, result.error);
  const output = codec.readCommandOutput(name, voidAsUndefined(name, result.output));
  if (!output.ok) return { ok: false, error: ipcError('internal', output.error.message, output.error.issues) };
  return { ok: true, value: output.value } as CommandResult<CommandName>;
}
