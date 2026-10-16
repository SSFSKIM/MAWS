// X2 `presentations.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/presentations.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`.
// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M6, D13; H1's IPC line).
export const commands = ['presentations.present'] as const;

export const events = [] as const;
