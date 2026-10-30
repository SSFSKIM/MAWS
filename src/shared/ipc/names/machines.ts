// X2 `machines.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/machines.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P5 O6 M3.
export const commands = ['machines.list'] as const;

export const events = ['machines.changed'] as const;
