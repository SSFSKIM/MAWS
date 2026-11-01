// X2 `host.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`, exactly
// the keys of `../schema/host.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`.
export const commands = ['host.supervisorStatus', 'host.status', 'host.restart', 'host.openLog'] as const;

export const events = ['host.supervisorStatus', 'host.status'] as const;

// Only main configures, stops or arms the supervisor (E10): its transport tells a stop it asked for from a crash. P5 O2
// M2: and reports its interest, which the renderer never sends.
// P5 O10 M7: `host.op` and `host.opQuery` are the endpoint's (lane B's operation ledger), sent from `mawsd`, never a window.
// P5 O3-D: `host.attachment`, `mawsd`'s signal of an app's attachment, which the relay refuses from an app.
export const mainOnlyCommands = ['host.configure', 'host.stopAll', 'host.exitWhenIdle', 'host.interest' /* P5 O2 M2 */, 'host.op', 'host.artifactOp' /* P5 O7 M5a */, 'host.opQuery', 'host.attachment' /* P5 O3-D */] as const;
