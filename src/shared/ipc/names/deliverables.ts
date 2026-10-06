// X2 `deliverables.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/deliverables.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`.
export const commands = [
  'deliverables.list', 'deliverables.listAll', 'deliverables.get',
] as const;

export const events = [
  'deliverables.changed', 'deliverables.console',
] as const;
