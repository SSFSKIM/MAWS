// X2 `marketplaces.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/marketplaces.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an
// entry added there adds its name here.
export const commands = [
  'marketplaces.list', 'marketplaces.add', 'marketplaces.update', 'marketplaces.remove',
] as const;

export const events = [] as const;
