// The services' operation ledger (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §H; O3X7):
// a remote act on the spine ends here, where its effect lands, as a lane B act ends at the engine host's `host.op`
// (src/engine-host/ops.ts), so the claim and the result are one process's and no crash window splits them. The ledger is
// `<profile>/spine-ops.jsonl`, a spine file under `spine.lock` (a refused run opens none).
//
// `machine.op {opId, opCreated, claim, name, input}` runs only a `machine`-owned command whose grade is an act (any but
// `list`, `view`, `client` and `internal`; a grade that follows its effect counts as an act), never itself
// (`unavailable`); its input must hold to the command's schema (`malformed`). A known op id answers what the ledger holds
// and runs nothing; else the claim is fsynced, the command runs through the bus's `invoke` (the table the root
// registered, its intercept first, its output validated), and its answer (`{ok, value}` or `{ok: false, error}`, a throw
// included: it was tried) is kept and returned. `machine.opQuery` answers RL4's states with the stored binding, as
// `host.opQuery` does. A local client's own acts (the app's, through its router) run unclaimed, as the engine host's
// local acts run beside `host.op` (D17).
import { thrownError } from '@shared/host/runtime';
import type { OpLedger } from '@shared/host/op-ledger';
import type { HandlerContext } from '@shared/ipc/client';
import { gradeOf } from '@shared/ipc/grades';
import { REGISTRY } from '@shared/ipc/registry';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import type { ServicesBus } from '@shared/spine/bus';

type OpInput = CommandInput<'machine.op'>;
type OpOutput = CommandOutput<'machine.op'>;
type OpQueryInput = CommandInput<'machine.opQuery'>;
type OpQueryOutput = CommandOutput<'machine.opQuery'>;

const NOT_ACTS: ReadonlySet<string> = new Set(['list', 'view', 'client', 'internal']);

/** Whether `machine.op` claims `name`: a `machine`-owned act. */
export function claimable(name: string): name is CommandName {
  if (!Object.hasOwn(REGISTRY.commands, name) || REGISTRY.commands[name as CommandName].owner !== 'machine') return false;
  const grade = gradeOf(name);
  if (grade === undefined) return false;
  return typeof grade === 'object' || !NOT_ACTS.has(grade);
}

export interface MachineOpsDeps {
  ledger: OpLedger;
  invoke: ServicesBus['invoke'];
}

export function machineOps(deps: MachineOpsDeps): { op(input: OpInput, context: HandlerContext): Promise<OpOutput>; opQuery(input: OpQueryInput): OpQueryOutput } {
  const { ledger } = deps;
  const refused = (reason: string): OpOutput => ({ state: 'refused', reason });

  async function op(input: OpInput, context: HandlerContext): Promise<OpOutput> {
    const { opId, opCreated, claim, name } = input;
    if (!claimable(name)) return refused('unavailable');
    const checked = validateCommandInput(name, input.input);
    if (!checked.ok) return refused('malformed');
    const appSessionId = (checked.value as { appSessionId?: unknown } | undefined)?.appSessionId;
    const target = typeof appSessionId === 'string' ? appSessionId : null;

    const begun = ledger.begin(opId, opCreated, { ...claim, target, name }, () => null);
    if (begun.kind === 'answered') return closedSaid(begun.answer as OpOutput);

    let result: { ok: true; value: unknown } | { ok: false; error: ReturnType<typeof thrownError> };
    try {
      const answer = await deps.invoke(name, checked.value, context);
      result = answer.ok ? { ok: true, value: answer.value } : { ok: false, error: answer.error };
    } catch (error) {
      result = { ok: false, error: thrownError(error) };
    }
    ledger.finish(opId, result);
    return closedSaid({ state: 'done', result } as OpOutput);
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

/** Registers `machine.op` and `machine.opQuery` over the ledger, running each claimed act through the bus's `invoke`. */
export function registerMachineOps(bus: Pick<ServicesBus, 'register' | 'invoke'>, ledger: OpLedger): void {
  const { op, opQuery } = machineOps({ ledger, invoke: bus.invoke });
  bus.register('machine.op', (input, context) => op(input, context));
  bus.register('machine.opQuery', (input) => opQuery(input));
}
