// The services' operation ledger (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §H; O3X7):
// a remote act on the spine ends here, where its effect lands, as a lane B act ends at the engine host's `host.op`
// (src/engine-host/ops.ts), so the claim and the result are one process's and no crash window splits them. The ledger is
// `<profile>/spine-ops.jsonl`, a spine file under `spine.lock` (a refused run opens none).
//
// `machine.op {opId, opCreated, claim, name, input, action?}` runs only a `machine`-owned command whose grade is an act (any but
// `list`, `view`, `client` and `internal`; a grade that follows its effect counts as an act), never itself, and never the
// daemon's own namespace, which is no service's (a `daemon.restart` would end the process before its result is kept)
// (`unavailable`); its input must hold to the command's schema (`malformed`). A known op id answers what the ledger holds
// and runs nothing; else the claim is fsynced (with the sealed `action` beside it, P5 O7 M4), the command runs through the
// bus's `invoke` (the table the root registered, its intercept first, its output validated) with the claim in its
// context (`HandlerContext.op`), and its answer (`{ok, value}` or `{ok: false, error}`, a throw
// included: it was tried) is kept and returned. `machine.opQuery` answers RL4's states with the stored binding, as
// `host.opQuery` does. A local client's own acts (the app's, through its router) run unclaimed, as the engine host's
// local acts run beside `host.op` (D17). P5 O7 M4: the ledger opens with `orphanAtOpen`: a claim the last process left with
// no result answers `expired` (its outcome unknown, never run again) until an outcome read back replaces it (`LateOutcome`).
// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §O): the claim's `target`, the artifact
// the endpoint resolved an artifact-targeted act to, is the binding's (else the session its input names, or none), and the
// input's bytes crossed in json-bytes' tagged form: a decoded copy is validated and run, the claim and action kept as sent.
import { fromWire } from '@shared/host/json-bytes';
import { thrownError } from '@shared/host/runtime';
import type { OpLedger } from '@shared/host/op-ledger';
import type { HandlerContext, HandlerOp } from '@shared/ipc/client';
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
  if (!Object.hasOwn(REGISTRY.commands, name) || REGISTRY.commands[name as CommandName].owner !== 'machine' || name.startsWith('daemon.')) return false;
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
    const { opId, opCreated, name } = input;
    const { target: claimed, ...claim } = input.claim;
    if (!claimable(name)) return refused('unavailable');
    const checked = validateCommandInput(name, fromWire(input.input)); // P5 O7 M5a: a decoded copy
    if (!checked.ok) return refused('malformed');
    const appSessionId = (checked.value as { appSessionId?: unknown } | undefined)?.appSessionId;
    const target = claimed ?? (typeof appSessionId === 'string' ? appSessionId : null);

    // P5 O7 M4: the sealed action, when the endpoint sent it, is kept with the claim (a query never says it) and handed to
    // the handler with the claim, so a handler can record who asked and keep the proof (`session.spawn`'s `launchedBy`)
    const action = input.action;
    const begun = ledger.begin(opId, opCreated, { ...claim, target, name, ...(action !== undefined && { action }) }, () => null);
    if (begun.kind === 'answered') return closedSaid(begun.answer as OpOutput);

    let result: { ok: true; value: unknown } | { ok: false; error: ReturnType<typeof thrownError> };
    try {
      const op: HandlerOp = { opId, opCreated, ...claim, ...(action !== undefined && { action }) };
      const answer = await deps.invoke(name, checked.value, { ...context, op });
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

/**
 * P5 O7 M4: the outcome of an act the last process claimed and never kept (the ledger's orphans, `orphanAtOpen`), read
 * back where the act left it, or null when nothing says. A spawn that reached `launching` left its record, under its
 * `launchedBy.opId`, whatever became of the process that ran it (the engine host it launched on may have been adopted
 * across the restart); another act leaves nothing to read back, and stays unknown.
 */
export type LateOutcome = (name: string, opId: string) => { ok: true; value: unknown } | null;

/** Registers `machine.op` and `machine.opQuery` over the ledger, running each claimed act through the bus's `invoke`. Each
 * orphan whose outcome `lateOutcome` reads back is kept as that outcome, so a query answers it and nothing runs it again. */
export function registerMachineOps(bus: Pick<ServicesBus, 'register' | 'invoke'>, ledger: OpLedger, lateOutcome?: LateOutcome): void {
  for (const { opId, claim } of ledger.orphans()) {
    const outcome = lateOutcome?.(claim.name, opId) ?? null;
    if (outcome !== null) ledger.finish(opId, outcome);
  }
  const { op, opQuery } = machineOps({ ledger, invoke: bus.invoke });
  bus.register('machine.op', (input, context) => op(input, context));
  bus.register('machine.opQuery', (input) => opQuery(input));
}
