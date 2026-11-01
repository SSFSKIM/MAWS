// X2 `browserEngine.*` names without their schemas (`../names.ts`; P5 O17, D8). Every command is main-only: a tab engine
// sends it to `mawsd` over machine.sock, never a window; `mawsd`'s request to it is an event to that connection alone (P5 O17 M4).
export const commands = [] as const;

export const events = ['browserEngine.request' /* P5 O17 M4 */] as const;

export const mainOnlyCommands = ['browserEngine.work' /* P5 O17 M3 */, 'browserEngine.answer', 'browserEngine.state' /* P5 O17 M4 */, 'browserEngine.frame', 'browserEngine.ended' /* P5 O17 M6 */] as const;
