// X2 `maws.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/maws.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'maws.asks.list', 'maws.ask.answer', 'maws.pane.answer',
  'maws.artifact.captured', // E2
  'maws.download.recorded', // E13
  'maws.artifact.exported', // P3-A M7
] as const;

export const events = [
  'maws.pane.show',
  'maws.artifact.capture', // E2
  'maws.artifact.export', // P3-A M7
] as const;
