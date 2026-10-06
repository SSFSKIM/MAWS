// X2 `files.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/files.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'files.list', 'files.read', 'files.watch', 'files.unwatch', 'files.openExternal',
  'files.reveal', // E1
] as const;

export const events = [
  'files.changed',
] as const;
