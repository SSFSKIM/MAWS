// X2 `files.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/files.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'files.list', 'files.read', 'files.watch', 'files.unwatch', 'files.openExternal',
  'files.write', // E5
  'files.reveal', // E1
  'files.upload', // P5 O3-E: bridged, no caller yet (O7 M4's drag and drop)
] as const;

// P5 O3-E (Interfaces §D): `library.read`'s reach to a path main resolved, main's alone to send
export const mainOnlyCommands = ['files.readResolved'] as const;

export const events = [
  'files.changed',
] as const;
