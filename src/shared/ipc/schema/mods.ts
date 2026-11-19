// X2 `mods.*` (X20; the P2-C document, §9 and Interfaces X2): MAWS's built-in mods. `mods.list` answers one row per
// entry of the registry (src/shared/mods/registry.ts); with a session, the row carries that session's override, its last
// applied state, what is pending and the style mismatch. `mods.setSessionOverride` writes a session's override of the
// to-human lane, kept in the index (`owner_channel_sessions`), never in the settings file; the app's switch is
// `settings.set` on `mods.toHuman.enabled`. Both owned by main. The UX wave, U2b (docs/doperpowers/plans/2026-11-15-ux-
// wave-U2b-to-human-view.md, Interfaces §M, "The switch"): `mods.setFoldSummaries` writes the machine's switch for new
// fold summaries, kept in the index's own facts, which the to-human row answers as `summaries`.
import * as z from 'zod';
import { AppSessionIdSchema } from '../../graph/ids';
import { ModIdSchema, ModRowSchema } from '../../mods/registry';
import { LaneOverrideSchema } from '../../owner/state';
import type { CommandSpec } from './common';

export const commands = {
  'mods.list': { input: z.strictObject({ appSessionId: AppSessionIdSchema.optional() }), output: z.array(ModRowSchema), owner: 'machine' },
  // An unknown session (one the index has no record of) fails `internal`, naming it.
  'mods.setSessionOverride': { input: z.strictObject({ appSessionId: AppSessionIdSchema, id: ModIdSchema, value: LaneOverrideSchema }), output: z.void(), owner: 'machine' },
  'mods.setFoldSummaries': { input: z.strictObject({ on: z.boolean() }), output: z.void(), owner: 'machine' }, // U2b
} as const satisfies Record<`mods.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

// UX wave U2b (panel finding 3, the coordinator's ruling): the machine's summaries switch was written (`mods.setFoldSummaries`).
// Empty: `mods.list` stays the one source of the value, which every mounted mods list reads again.
export const events = {
  'mods.foldSummariesChanged': z.strictObject({}),
} as const satisfies Record<`mods.${string}`, z.ZodType>;
