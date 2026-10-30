// X2 `machineSettings.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/machine-settings.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`.
// P5 O3-D.
export const commands = ['machineSettings.get', 'machineSettings.set'] as const;

export const events = ['machineSettings.changed'] as const;
