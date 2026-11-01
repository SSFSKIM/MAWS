// X2 `remote.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/remote.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P5 O7 M2.
export const commands = [] as const;

export const events = ['remote.session', 'remote.gap', 'remote.historyTooLarge', 'remote.upload'] as const;
