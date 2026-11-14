// X2 `remote.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/remote.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P5 O7 M2.
export const commands = ['remote.forward.open', 'remote.forward.close', 'remote.openCopy'] as const; // P5 O7 M3; remote.openCopy: M5a

export const events = ['remote.session', 'remote.gap', 'remote.historyTooLarge', 'remote.reopened', 'remote.upload', 'remote.attention', 'remote.settled'] as const; // remote.attention: P5 O7 M6; remote.reopened: M8 (m8-3's task review); remote.settled: the UX wave, U9
