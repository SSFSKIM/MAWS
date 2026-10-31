// The services bus (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §A): how the
// machine's services (the spine and the checkouts, O3 §5) register their commands, install their intercepts, emit their
// events and tap them, with no import of main's IPC. Each root binds one and injects it into the modules it composes:
// main's embedded root binds it to its router and `emit` (src/main/ipc/), O3-D's `mawsd` to its services front. A
// handler that must fail with a specific `IpcError` throws `HostCommandError` (@shared/host/runtime), which main's
// router and every host runtime answer intact. Its members are free functions: a module may take one alone
// (`Pick<ServicesBus, 'register'>`, or `bus.emit` as an `emit` dependency) and call it detached from the bus.
import type { HandlerContext } from '@shared/ipc/client';
import type { CommandInput, CommandName, CommandOutput, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';

// A command handler as the library writes it: the asker's ClientRef in `context`, no machine (a library handler
// always answers its own machine's).
export type ServiceHandler<N extends CommandName> = (input: CommandInput<N>, context: HandlerContext) => CommandOutput<N> | Promise<CommandOutput<N>>;

export interface ServicesBus {
  // A command the library answers; throws for a name registered twice. The spine's commands are `machine`-owned (O3-D
  // M1), and the checkouts' with them from O3-E: main binds a `machine` name to its router's embedded machine binding and
  // a `main` one to its main handlers; `mawsd` binds both to its services front.
  register<N extends CommandName>(name: N, handler: ServiceHandler<N>): void;
  // Answers a command another owner would answer, before that owner (session.answer's pending check, the scenario
  // stub, O9's reroute); the function returned removes it.
  intercept<N extends CommandName>(name: N, handler: ServiceHandler<N>): () => void;
  // To every client, validated: false, and nothing sent, for a payload its schema refuses. Every tap hears what was sent.
  emit<N extends EventName>(name: N, payload: EventPayload<N>): boolean;
  // An in-process tap on what `emit` sent, from any emitter on this bus.
  onEmitted<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void;
  // P5 O3-D M2 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §H): a command the root registered,
  // run in process as a client's would be (its intercept first, its output validated), for the services' ledger
  // (`machine.op`, M4) to run a claimed command through. Main binds it to its router's local route over the embedded
  // machine handlers; `mawsd` to its services front's table.
  invoke<N extends CommandName>(name: N, input: unknown, context: HandlerContext): Promise<CommandResult<N>>;
}
