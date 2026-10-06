// X2 `side.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/side.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'side.thread.open', 'side.sendToMain', 'side.question.list', 'side.question.clear',
] as const;

export const events = [] as const;
