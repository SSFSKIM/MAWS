// X2 `designSystems.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`,
// exactly the keys of `../schema/design-systems.ts`, pinned at compile time in `../schema.ts` and per namespace in
// `../schema.test.ts`.
export const commands = ['designSystems.house'] as const;
// Main's alone (the export service's), never bridged to a window.
export const mainOnlyCommands = ['designSystems.governing'] as const;

export const events = [] as const;
