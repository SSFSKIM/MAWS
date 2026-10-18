// X2 `maws.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands` (E3), exactly the keys of
// `../schema/maws.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'maws.asks.list', 'maws.ask.answer', 'maws.pane.answer',
  'maws.artifact.captured', // E2
  'maws.download.recorded', // E13
] as const;

export const events = [
  'maws.pane.show',
  'maws.artifact.capture', // E2
  'maws.artifact.export', // P3-A M7
  'maws.artifact.datasetRefresh', // E3: a refresh request's id alone
] as const;

// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): main's answer to an agent's dataset refresh, never
// bridged to a window (no window can settle a session's request). P3-F (artifact-protocol finding 6): so is main's
// answer to an export (P3-A M7), whose request every window sees.
export const mainOnlyCommands = ['maws.artifact.datasetRefreshed', 'maws.artifact.exported'] as const;
