// X2 `remote.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/remote.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P5 O7 M2.
export const commands = ['remote.forward.open', 'remote.forward.close'] as const; // P5 O7 M3

export const events = ['remote.session', 'remote.gap', 'remote.historyTooLarge', 'remote.upload', 'remote.attention'] as const; // remote.attention: P5 O7 M6
