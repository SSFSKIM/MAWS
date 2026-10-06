// X2 `maws.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/maws.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'maws.asks.list', 'maws.ask.answer', 'maws.pane.answer',
] as const;

export const events = [
  'maws.pane.show',
] as const;
