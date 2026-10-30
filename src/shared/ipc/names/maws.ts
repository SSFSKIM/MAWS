// X2 `maws.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands` (E3), exactly the keys of
// `../schema/maws.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = ['maws.asks.list', 'maws.ask.answer', 'maws.pane.answer'] as const;

export const events = [
  'maws.pane.show',
  'maws.artifact.capture', // E2
  'maws.artifact.export', // P3-A M7
  'maws.artifact.datasetRefresh', // E3: a refresh request's id alone
] as const;

// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): main's answer to an agent's dataset refresh, never
// bridged to a window (no window can settle a session's request). P3-F (artifact-protocol finding 6): so is main's
// answer to an export (P3-A M7), whose request every window sees.
// P5 O3-D (P5 Decision Log 36): so are main's capture's answer (E2) and the browser's download record (E13).
export const mainOnlyCommands = ['maws.artifact.datasetRefreshed', 'maws.artifact.exported', 'maws.artifact.captured', 'maws.download.recorded'] as const;
