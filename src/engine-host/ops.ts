// Lane B's operation ledger (P5 O10 M7; RL §4.7; Interfaces §H): the remote layer's actions end here, where their
// effect lands, so the claim and the result are one process's and no crash window splits them. The endpoint in `mawsd`
// sends `host.op` for an authorized remote action on a lane B session and `host.opQuery` for a device's query.
//
// `host.op {opId, opCreated, member, device, fingerprint, name, input, context, requestDigest?}`:
//   - runs only an engine-host command on a session (`appSessionId` in its input) that this host has a handler for, never
//     a `host.*` one (`unavailable`); a main-owned one waits for O3; its input must hold to the command's schema
//     (`malformed`);
//   - a known opId answers what the ledger holds and runs nothing (`op-ledger.ts`: its result, `in-progress` while
//     claimed, `op-conflict` under another fingerprint or member, `tombstoned`); one past the horizon is `expired`;
//   - else, in the same turn as the claim: the action's context against the session now (`context`: an action sealed
//     before a resume, a new launch, or a `/clear`, a new engine session id), and an answer's request digest against the
//     broker's pending item (`digest-mismatch`, a missing digest included);
//   - the claim is fsynced, the command runs through the host's own handler, and its answer (`{ok, value}` or
//     `{ok: false, error}`, a throw included: it was tried) is kept and returned.
// `host.opQuery {opId, opCreated, tombstoneIfAbsent}`: RL4's states with the stored binding; an absent id tombstoned
// first when asked, under the same synchronous turn as every claim.
// While the ledger is closed every answer says so (`ledger`: op-ledger.ts's word), `done` included (a run that ended
// after another op's claim closed it, or whose own result could not be kept), so its absence means the ledger answers:
// the route by which the endpoint in `mawsd` shows this process's ledger in its status. A restart of the engine host
// reopens it.
import { thrownError, type HostOn } from '@shared/host/runtime';
import type { OpLedger } from '@shared/host/op-ledger';
import { requestDigestOf, type RequestDigest } from '@shared/host/request-digest';
import type { SessionEvent } from '@shared/graph/events';
import type { HandlerContext } from '@shared/ipc/client';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import { commands, type CommandInput, type CommandOutput } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';

type Handler = (input: unknown, ctx: HandlerContext) => Promise<unknown>;
type OpInput = CommandInput<'host.op'>;
type OpOutput = CommandOutput<'host.op'>;
type OpQueryInput = CommandInput<'host.opQuery'>;
type OpQueryOutput = CommandOutput<'host.opQuery'>;

export type OpsDeps = {
  ledger: OpLedger;
  /** The handler this host registered for `name`, if any. */
  handler(name: string): Handler | undefined;
  /** The session's launch and engine session now; null for a session this host holds no row for. */
  status(appSessionId: string): { launchId: string; engineSessionId: string | null } | null;
  /** The originating event of a pending request (the broker's item), or null. */
  pending(appSessionId: string, requestId: string): SessionEvent | null;
  log?(line: string): void;
};

const refused = (reason: string): OpOutput => ({ state: 'refused', reason });
const sameDigest = (a: RequestDigest | undefined, b: RequestDigest | null) =>
  a !== undefined && b !== null && a.session === b.session && a.request === b.request && a.tool === b.tool && a.input_sha256 === b.input_sha256;

export function opCommands(deps: OpsDeps): { op(input: OpInput, ctx: HandlerContext): Promise<OpOutput>; opQuery(input: OpQueryInput): OpQueryOutput } {
  const { ledger } = deps;

  async function op(input: OpInput, ctx: HandlerContext): Promise<OpOutput> {
    const { opId, opCreated, member, device, fingerprint, name, context, requestDigest } = input;
    const spec = Object.hasOwn(commands, name) ? commands[name as keyof typeof commands] : undefined;
    const handler = spec?.owner === 'engine-host' && !name.startsWith('host.') ? deps.handler(name) : undefined;
    if (handler === undefined) return refused('unavailable');
    const checked = validateCommandInput(name as keyof typeof commands, input.input);
    if (!checked.ok) return refused('malformed');
    const appSessionId = (checked.value as { appSessionId?: unknown } | undefined)?.appSessionId;
    if (typeof appSessionId !== 'string') return refused('unavailable');

    const begun = ledger.begin(opId, opCreated, { member, device, fingerprint, target: appSessionId, name, context }, () => {
      const now = deps.status(appSessionId);
      if (now === null || now.launchId !== context.launchId || now.engineSessionId !== context.engineSessionId) return 'context';
      if (name === 'session.answer') {
        const requestId = (checked.value as { requestId: string }).requestId;
        const pending = deps.pending(appSessionId, requestId);
        if (!sameDigest(requestDigest, pending === null ? null : requestDigestOf(appSessionId, pending))) return 'digest-mismatch';
      }
      return null;
    });
    if (begun.kind === 'answered') return closedSaid(begun.answer as OpOutput);

    let result: { ok: true; value: unknown } | { ok: false; error: IpcError };
    try {
      const value = await handler(checked.value, ctx);
      const output = validateCommandOutput(name as keyof typeof commands, value);
      result = output.ok ? { ok: true, value: output.value } : { ok: false, error: ipcError('internal', output.error.message) };
    } catch (error) {
      result = { ok: false, error: thrownError(error) };
    }
    ledger.finish(opId, result);
    return closedSaid({ state: 'done', result });
  }

  function opQuery({ opId, opCreated, tombstoneIfAbsent }: OpQueryInput): OpQueryOutput {
    return closedSaid(ledger.query(opId, opCreated, tombstoneIfAbsent));
  }

  /** An answer, with why the ledger is closed while it is. */
  function closedSaid<T extends object>(answer: T): T {
    return ledger.closed !== null ? { ...answer, ledger: ledger.closed } : answer;
  }

  return { op, opQuery };
}

/** Registers `host.op` and `host.opQuery` over `deps`. */
export function registerOps(on: HostOn, deps: OpsDeps): void {
  const { op, opQuery } = opCommands(deps);
  on('host.op', async (input, ctx) => op(input, ctx));
  on('host.opQuery', async (input) => opQuery(input));
}
