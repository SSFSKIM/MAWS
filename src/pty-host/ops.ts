// The pty host's operation ledger (P5 O7 M3; docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M3 "Acts, then
// streams", Interfaces §O): a remote act on a terminal ends here, where its effect lands, as a lane B act ends at the
// engine host's `host.op` (src/engine-host/ops.ts) and a services act at `machine.op` (src/services/machine-ops.ts), so
// the claim and the result are one process's. The endpoint in `mawsd` sends `pty.op` for an authorized act and
// `pty.opQuery` for a device's query. The ledger is `<pty host directory>/pty-ops.jsonl` (`<profile>/mawsd/pty-host/`),
// opened by the register once the host holds its directory's lock, so no second process reads or compacts it.
//
// `pty.op {opId, opCreated, claim, name, input, action?}` (`machine.op`'s shape):
//   - runs exactly `pty.spawn`, `pty.attach`, `pty.kill` and `pty.listFor` (any other name `unavailable`), its input held
//     to the command's schema (`malformed`); the sealed `action` is not kept, since no reader of a terminal's act needs
//     its proof;
//   - an attach takes no credit whatever its args say and is kept and answered as `{info, ringStart, nextOffset}`
//     (`PtyOpAttachSchema`): no bytes and no checkpoint, so it reads back whole after a reopen and a reseal answers the
//     metadata the act saw; the ring crosses as the stream, read by `pty.replay` from the viewer's own offset;
//   - a known opId answers what the ledger holds and runs nothing (op-ledger.ts: its result, `in-progress` while claimed,
//     `op-conflict` under another fingerprint or member, `tombstoned`); one past the horizon is `expired`;
//   - else the claim is fsynced (its `target` the act's session for a spawn or a listing, its pty for an attach or a
//     kill), the command runs on the table, and its answer (`{ok, value}` or `{ok: false, error}`, a throw included: it
//     was tried) is kept and returned.
// `pty.opQuery {opId, opCreated, tombstoneIfAbsent}`: RL4's states with the stored binding.
//
// A claim found unfinished at open is orphaned (`orphanAtOpen`) and answers `expired`, never run again: the ledger
// outlives the process only across the pty host's own restart (a mawsd restart adopts the host, ledger and table
// intact, and a park waits for every request in flight), and the table is that process's memory, so whatever the last
// process's act made (a pty it spawned) ended with it and nothing here can say its outcome. Nothing is read back.
// While the ledger is closed every answer says why (`ledger`), as the others do. A utility pty host (forked by main,
// which no endpoint reaches) has no directory and no ledger: every op is `unavailable`.
import { thrownError } from '@shared/host/runtime';
import { OpLedger } from '@shared/host/op-ledger';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import { PtyOpAttachSchema, type CommandInput, type CommandOutput } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import type { PtyTable } from './table';

type OpInput = CommandInput<'pty.op'>;
type OpOutput = CommandOutput<'pty.op'>;
type OpQueryInput = CommandInput<'pty.opQuery'>;
type OpQueryOutput = CommandOutput<'pty.opQuery'>;

export const PTY_OPS_FILE = 'pty-ops.jsonl';

/** The ledger in the pty host's directory, a claim the last process left unfinished orphaned. */
export function openPtyOpsLedger(dir: string, log: (line: string) => void = (line) => console.warn(`[pty-ops] ${line}`)): OpLedger {
  return OpLedger.open(dir, PTY_OPS_FILE, { log, orphanAtOpen: true });
}

export type PtyOpsTable = Pick<PtyTable, 'spawn' | 'kill' | 'attachMetadata' | 'listFor'>;

type ActName = 'pty.spawn' | 'pty.attach' | 'pty.kill' | 'pty.listFor';
type Run = { target(input: never): string; run(table: PtyOpsTable, input: never): Promise<unknown>; check(output: unknown): { ok: true; value: unknown } | { ok: false; error: IpcError } };
const checked = (name: 'pty.spawn' | 'pty.kill' | 'pty.listFor') => (output: unknown) => validateCommandOutput(name, output);

// The four acts, each with what its claim targets and how it runs.
const RUNS: Record<ActName, Run> = {
  'pty.spawn': { target: (input: CommandInput<'pty.spawn'>) => input.appSessionId, run: (table, input: CommandInput<'pty.spawn'>) => table.spawn(input), check: checked('pty.spawn') },
  'pty.kill': { target: (input: CommandInput<'pty.kill'>) => input.ptyId, run: (table, input: CommandInput<'pty.kill'>) => table.kill(input), check: checked('pty.kill') },
  'pty.listFor': { target: (input: CommandInput<'pty.listFor'>) => input.appSessionId, run: async (table, input: CommandInput<'pty.listFor'>) => table.listFor(input), check: checked('pty.listFor') },
  // `credit` is read and never used: the metadata is taken without stepping the flow, whatever the args say
  'pty.attach': {
    target: (input: CommandInput<'pty.attach'>) => input.ptyId,
    run: async (table, input: CommandInput<'pty.attach'>) => table.attachMetadata(input.ptyId),
    check: (output) => {
      const parsed = PtyOpAttachSchema.safeParse(output);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: ipcError('invalid_output', 'output of a remote pty.attach') };
    },
  },
};

const isAct = (name: string): name is ActName => Object.hasOwn(RUNS, name);

export function ptyOps(deps: { ledger: OpLedger | null; table: PtyOpsTable }): { op(input: OpInput): Promise<OpOutput>; opQuery(input: OpQueryInput): OpQueryOutput } {
  const { ledger, table } = deps;
  const refused = (reason: string): OpOutput => ({ state: 'refused', reason });

  async function op(input: OpInput): Promise<OpOutput> {
    const { opId, opCreated, claim, name } = input;
    if (!isAct(name) || ledger === null) return refused('unavailable');
    const spec = RUNS[name];
    const args = validateCommandInput(name, input.input);
    if (!args.ok) return refused('malformed');

    const begun = ledger.begin(opId, opCreated, { ...claim, target: spec.target(args.value as never), name }, () => null);
    if (begun.kind === 'answered') return closedSaid(ledger, begun.answer as OpOutput);

    let result: { ok: true; value: unknown } | { ok: false; error: IpcError };
    try {
      result = spec.check(await spec.run(table, args.value as never));
      if (!result.ok) result = { ok: false, error: ipcError('internal', result.error.message) };
    } catch (error) {
      result = { ok: false, error: thrownError(error) };
    }
    ledger.finish(opId, result);
    return closedSaid(ledger, { state: 'done', result } as OpOutput);
  }

  function opQuery({ opId, opCreated, tombstoneIfAbsent }: OpQueryInput): OpQueryOutput {
    if (ledger === null) return { state: 'unavailable' };
    return closedSaid(ledger, ledger.query(opId, opCreated, tombstoneIfAbsent));
  }

  return { op, opQuery };
}

/** An answer, with why the ledger is closed while it is. */
function closedSaid<T extends object>(ledger: OpLedger, answer: T): T {
  return ledger.closed !== null ? { ...answer, ledger: ledger.closed } : answer;
}
