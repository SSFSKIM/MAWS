// X2 `layout.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/layout.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'layout.get', 'layout.set', 'layout.list', 'layout.openExternal', 'layout.setEnabledActions', 'layout.pickFiles',
  'layout.saveTextFile', 'layout.captureChords',
  'layout.quitWait', 'layout.quitWaitAnswer', // C12
  'layout.unsavedFiles', 'layout.saveAllDone', // E5
  'layout.captureRegion', // P3-G
  'layout.nativeEdit', // P4-B2 K6
  'layout.openFile', // UX wave U6e: Open File…
  'layout.frameFile', 'layout.releaseFrame', // UX wave U6b-2
  'layout.openInApps', 'layout.openIn', // UX wave U6b-4a: Open in
  'layout.zoom', // UX wave U6b-5b
] as const;

export const events = [
  'layout.action',
  'layout.quitWait', // C12
  'layout.selectAll', // Edit ▸ Select All (sitting finding, 2026-09-30)
  'layout.saveAll', // E5
  'layout.edit', // P4-B2 K6: Edit ▸ Undo and Redo
  'layout.frameFailed', // UX wave U6b-2
  'layout.zoomChanged', // UX wave U6b-5b
] as const;
