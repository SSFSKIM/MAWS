// X2 `attention.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/attention.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'attention.list', 'attention.request', 'attention.pendingNavigate',
] as const;

export const events = [
  'attention.changed', 'attention.notified', 'attention.navigate',
] as const;
