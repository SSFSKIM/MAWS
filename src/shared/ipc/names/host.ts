// X2 `host.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`, exactly
// the keys of `../schema/host.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`.
export const commands = ['host.supervisorStatus', 'host.status', 'host.restart', 'host.openLog'] as const;

export const events = ['host.supervisorStatus', 'host.status'] as const;

// Only main configures, stops or arms the supervisor (E10): its transport tells a stop it asked for from a crash.
// P5 O10 M7: `host.op` and `host.opQuery` are the endpoint's (lane B's operation ledger), sent from `mawsd`, never a window.
export const mainOnlyCommands = ['host.configure', 'host.stopAll', 'host.exitWhenIdle', 'host.op', 'host.opQuery'] as const;
