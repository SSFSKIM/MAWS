// The local machine's link (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The local link"):
// in-process, through the router's own local path (`dispatchLocal`), so behaviour with one machine stays M2's. Always up.
// Its events need no relay: main's own services emit them to the windows with the local machine already (src/main/ipc/events.ts).
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { MainContext } from '../ipc/router';
import type { MachineLink } from './manager';

export function createLocalLink({ ref, name, dispatchLocal }: { ref: MachineRef; name: string; dispatchLocal(name: CommandName, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>> }): MachineLink {
  return {
    machine: ref,
    name,
    state: () => 'up',
    dispatch: (command, input, client) => dispatchLocal(command, input, { client, target: ref }),
    onState: () => () => {},
    onEvent: () => () => {},
    close: () => {},
  };
}
