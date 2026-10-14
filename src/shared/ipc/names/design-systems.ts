// X2 `designSystems.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/design-systems.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`.
export const commands = ['designSystems.house'] as const;

export const events = [] as const;
