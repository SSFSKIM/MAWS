// X2 `designSystems.*` (docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D9; the P3 spec's Decision Log 61; the
// ledger's X28): the renderer's reads of P3-D's host module. `designSystems.house` answers the house system's id, the
// default chain's last link before the bundled floor, as the host's chain resolves it (the earliest-created live system
// whose origin key is `maws`; null when none is left). A window draws a scope by re-running the portable
// `governingSystem` with this as its `house`; it reads again at every `artifacts.changed` of a design system, since a
// deletion or a new house system changes the answer. Writes stay `artifacts.*` (P3-A's).
import * as z from 'zod';
import type { CommandSpec } from './common';

const host = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'engine-host' as const });

export const commands = {
  'designSystems.house': host(z.void(), z.strictObject({ houseId: z.uuid().nullable() })),
} as const satisfies Record<`designSystems.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`designSystems.${string}`, z.ZodType>;
