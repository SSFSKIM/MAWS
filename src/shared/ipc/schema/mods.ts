// X2 `mods.*` (X20; the P2-C document, §9 and Interfaces X2): MAWS's built-in mods. `mods.list` answers one row per
// entry of the registry (src/shared/mods/registry.ts); with a session, the row carries that session's override, its last
// applied state, what is pending and the style mismatch. `mods.setSessionOverride` writes a session's override of the
// to-human lane, kept in the index (`owner_channel_sessions`), never in the settings file; the app's switch is
// `settings.set` on `mods.toHuman.enabled`. Both owned by main.
import * as z from 'zod';
import { AppSessionIdSchema } from '../../graph/ids';
import { ModIdSchema, ModRowSchema } from '../../mods/registry';
import { LaneOverrideSchema } from '../../owner/state';
import type { CommandSpec } from './common';

export const commands = {
  'mods.list': { input: z.strictObject({ appSessionId: AppSessionIdSchema.optional() }), output: z.array(ModRowSchema), owner: 'main' },
  // An unknown session (one the index has no record of) fails `internal`, naming it.
  'mods.setSessionOverride': { input: z.strictObject({ appSessionId: AppSessionIdSchema, id: ModIdSchema, value: LaneOverrideSchema }), output: z.void(), owner: 'main' },
} as const satisfies Record<`mods.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`mods.${string}`, z.ZodType>;
