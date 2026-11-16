// X2 `spaces.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/spaces.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`.
export const commands = ['spaces.list', 'spaces.create', 'spaces.update', 'spaces.delete', 'spaces.instructions', 'spaces.setInstructions' /* UX wave U10b */] as const;

export const events = ['spaces.changed'] as const;
