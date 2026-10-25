// X2 `catalog.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/catalog.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P4-AGG M2.
export const commands = ['catalog.home', 'catalog.query', 'catalog.item', 'catalog.refresh', 'catalog.sources', 'catalog.icon', 'catalog.postures'] as const;

export const events = ['catalog.changed'] as const;
