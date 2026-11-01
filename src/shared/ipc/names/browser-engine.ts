// X2 `browserEngine.*` names without their schemas (`../names.ts`; P5 O17, D8). Every command is main-only: a tab engine
// sends it to `mawsd` over machine.sock, never a window.
export const commands = [] as const;

export const events = [] as const;

export const mainOnlyCommands = ['browserEngine.work' /* P5 O17 M3 */] as const;
