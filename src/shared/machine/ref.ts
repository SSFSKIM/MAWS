// A machine's ref (P5 OX2; RL5's `ref`, docs/doperpowers/specs/2026-10-26-remote-layer-design.md §2.3 and its Decision
// Log 19): the identity a machine mints once at its first run (identity-file.ts) and keeps, independent of its key and
// never its display name. Every contract field named `machine` carries one. The schema accepts RL5's whole range, so a
// ref another daemon minted reads here. RL5's alphabet has no `/`, which is what lets an address be `<ref>/<id>`
// (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, M1).
import * as z from 'zod';

export const MachineRefSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).brand<'MachineRef'>(); // RL5's `ref`
export type MachineRef = z.infer<typeof MachineRefSchema>;
