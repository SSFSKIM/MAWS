// The renderer's side of X2 validation: every command output and every event payload is checked on receipt, so
// nothing malformed reaches a caller or a listener. Invalid outputs come back as `invalid_output`; invalid events are
// dropped with a `console.error` naming the event and the issues. Components and stores use `ipc`, never
// `window.maws` directly.
//
// P5 O6 M2 (OX2; docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The renderer client"): the page holds only
// addresses (`<machine>/<id>`, src/shared/machine/address.ts). The client lowers every input to bare ids, sends it to the
// machine its addresses name (all must agree; else the explicit `opts.machine`; else the local machine), validates the
// output on its bare form, as main logged it, then lifts it with that machine. An event is validated, then lifted with the
// machine it came from (none: the local machine). The local machine is no exception: its ids are addressed too. An input
// that mixes machines, or whose explicit machine disagrees with its addresses, or that holds a bare id, is refused
// `invalid_input` with one `console.error`, and nothing is sent.
// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The checkout rule and its boundary"): a command
// made from a session (`opts.session`, a panel tool's) is sent with that session, bare, beside its machine
// (`InvokeTarget`), which main sends on as the call's session to a machine that bounds a path read by it.
import { CommandResultEnvelopeSchema, ipcError } from '@shared/ipc/errors';
import { REGISTRY } from '@shared/ipc/registry';
import { routeOf } from '@shared/ipc/routes';
import type { CommandName, CommandResult, IpcError, MawsBridge, PreloadBridge } from '@shared/ipc/schema';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { addressingOf, bareOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import * as z from 'zod';

// E10: main's own refusals, heard app-wide by what must react to one wherever it was asked (a launch refused while an
// incompatible supervisor is waited for shows its banner again, `app/supervisor-notices.ts`).
type RefusalListener = (name: CommandName, error: IpcError) => void;
const refusalListeners = new Set<RefusalListener>();
export function onCommandRefused(listener: RefusalListener): () => void {
  refusalListeners.add(listener);
  return () => void refusalListeners.delete(listener);
}

const addressing = addressingOf(REGISTRY);

// The refusal of an input the client will not send: logged once, answered `invalid_input`.
function refused(message: string): CommandResult<CommandName> {
  console.error(`[ipc] ${message}`);
  return { ok: false, error: ipcError('invalid_input', message) };
}

// `bridge` is read on every call, so a client can be created before the preload's bridge is reachable (tests).
export function createClient(bridge: () => PreloadBridge): MawsBridge {
  return {
    get localMachine() {
      return bridge().localMachine;
    },
    async invoke(name, input, ...[opts]) {
      let lowered: { value: unknown; machines: ReadonlySet<MachineRef> };
      try {
        lowered = addressing.input(name).lower(input);
      } catch (error) {
        return refused(`${name}: ${error instanceof Error ? error.message : String(error)}`) as CommandResult<typeof name>;
      }
      const named = [...lowered.machines];
      if (named.length > 1) return refused(`${name}: its input names machines ${named.join(' and ')}; a command goes to one`) as CommandResult<typeof name>;
      const explicit = opts?.machine;
      if (explicit !== undefined && named.length === 1 && named[0] !== explicit) {
        return refused(`${name}: its input names machine ${named[0]} but it was sent to ${explicit}`) as CommandResult<typeof name>;
      }
      // M4: a `path` command whose input holds no address names its machine explicitly; a path is no machine's by itself.
      if (named.length === 0 && explicit === undefined && routeOf(name) === 'path') return refused(`${name}: its input names no machine`) as CommandResult<typeof name>;
      const machine = named[0] ?? explicit ?? bridge().localMachine;
      // P5 O7 M4: the session the command is made from goes bare beside its machine, and must be that machine's session.
      const session = opts?.session;
      if (session !== undefined && (!isAddress(session) || machineOf(session) !== machine)) {
        return refused(`${name}: it is made from session ${session}, which is not a session of machine ${machine}`) as CommandResult<typeof name>;
      }
      // M4c fix wave 2: a machine-wide act made from one of this Mac's tabs (`session.spawn`'s New chat tab) names it the
      // same way, so main keeps the act by the tab, which outlives a reload of the page
      const from = opts !== undefined && 'from' in opts ? opts.from : undefined;
      if (from !== undefined && (session !== undefined || !isAddress(from) || machineOf(from) !== bridge().localMachine)) {
        return refused(`${name}: it is made from tab ${from}, which is not a tab of this Mac or names a session as well`) as CommandResult<typeof name>;
      }
      const made = session ?? from;
      const target = made === undefined ? machine : { machine, session: bareOf(made) };
      const envelope = CommandResultEnvelopeSchema.safeParse(await bridge().invoke(name, lowered.value as never, target));
      if (!envelope.success) {
        const message = `malformed result for ${name}: ${z.prettifyError(envelope.error)}`;
        return { ok: false, error: ipcError('invalid_output', message, envelope.error.issues) };
      }
      if (!envelope.data.ok) {
        // A listener's fault is its own: the caller still gets the refusal, and the other listeners still hear it.
        for (const listener of refusalListeners) {
          try {
            listener(name, envelope.data.error);
          } catch (error) {
            console.error(`[ipc] a refusal listener failed on ${name}`, error);
          }
        }
        return envelope.data;
      }
      const output = validateCommandOutput(name, envelope.data.value);
      if (!output.ok) return output;
      try {
        return { ok: true, value: addressing.output(name).lift(output.value, machine) };
      } catch (error) {
        const message = `${name}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[ipc] ${message}`);
        return { ok: false, error: ipcError('invalid_output', message) };
      }
    },
    on(name, listener) {
      return bridge().on(name, (payload, machine) => {
        const checked = validateEventPayload(name, payload);
        if (!checked.ok) {
          console.error(`[ipc] dropped invalid ${name} event`, checked.issues);
          return;
        }
        const from = machine ?? bridge().localMachine;
        let lifted: typeof checked.value;
        try {
          lifted = addressing.event(name).lift(checked.value, from);
        } catch (error) {
          console.error(`[ipc] dropped ${name} event from ${from}`, error);
          return;
        }
        listener(lifted, { machine: from });
      });
    },
    pathForFile: (file) => bridge().pathForFile(file), // C7: no IPC; the preload asks Electron
  };
}

export const ipc: MawsBridge = createClient(() => window.maws);
