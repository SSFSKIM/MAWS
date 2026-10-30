// X2 `machine.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/machine.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P5 O6 M1.
export const commands = ['machine.identity'] as const;

export const events = [] as const;

// P5 O3-D: the services front's own, sent by main (the browser's socket) and by the endpoint (the services' ledger)
export const mainOnlyCommands = ['machine.client', 'machine.op', 'machine.opQuery'] as const;
