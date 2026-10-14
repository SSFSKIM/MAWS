// X2 `library.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`,
// exactly the keys of `../schema/library.ts`, pinned at compile time in `../schema.ts` and per namespace in
// `../schema.test.ts`.
export const commands = [
  'library.list', 'library.get', 'library.spaces',
  'library.exportFormats', 'library.content', 'library.openExternally', 'library.reveal', 'library.saveAs', // M5b
  'library.testImport', // M6b, e2e only
] as const;

export const events = ['library.changed'] as const;

// The engine host's reads main rebuilds its index from (P3-L Decision Log 2): main's alone to send, so no window can
// read the host's store around the index.
export const mainOnlyCommands = ['library.snapshot', 'library.entry', 'library.text'] as const;
