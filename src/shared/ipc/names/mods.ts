// X2 `mods.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/mods.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = ['mods.list', 'mods.setSessionOverride'] as const;

export const events = [] as const;
