// X2 `files.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/files.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'files.list', 'files.read', 'files.watch', 'files.unwatch', 'files.openExternal',
  'files.write', // E5
  'files.writeOutside', // UX wave U6e: the save of a file outside the session's directories
  'files.readOutside', 'files.listOutside', 'files.chooseOutside', // UX wave U6f: the open, the chooser's listing and the pick, from another machine
  'files.reveal', // E1
  'files.upload', // P5 O3-E: bridged, no caller yet (O7 M4's drag and drop)
] as const;

// P5 O3-E (Interfaces §D): `library.read`'s reach to a path main resolved, main's alone to send
// P5 O7 M8: the machine's endpoint's read of a send's uploads, which no page sends
// UX wave U6e: the grant of a file the person chose in main's chooser
// UX wave U6b-4a: "Open in"'s admission of the path main hands another app
export const mainOnlyCommands = ['files.readResolved', 'files.readUploads', 'files.grant', 'files.admit'] as const;

export const events = [
  'files.changed',
] as const;
