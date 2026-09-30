// X2 `layout.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/layout.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'layout.get', 'layout.set', 'layout.list', 'layout.openExternal', 'layout.setEnabledActions', 'layout.pickFiles',
  'layout.saveTextFile', 'layout.captureChords',
] as const;

export const events = [
  'layout.action',
] as const;
