// X2 `machineSettings.*` (P5 O3-D, docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §G; contract O3X3):
// the machine half of the settings (`machine-settings.json`, O3-A's split) as the spine serves it, `mawsd`'s on the daemon
// shape, so main composes the renderer's one `Settings` from it over the services front. `machine`-owned; graded
// `machine-admin`, the settings' own grade. The renderer's `settings.*` is unchanged.
import * as z from 'zod';
import type { CommandSpec } from './common';
import { MachineSettingsPatchSchema, MachineSettingsSchema } from './settings';

export const commands = {
  // `version`: the machine half's revision, bumped at each persisted change
  'machineSettings.get': { input: z.void(), output: z.strictObject({ settings: MachineSettingsSchema, version: z.number().int().nonnegative() }), owner: 'machine' },
  // answered once the write persisted and every listener was told; refused (nothing changed) when the file may not be written
  'machineSettings.set': { input: z.strictObject({ patch: MachineSettingsPatchSchema }), output: z.strictObject({ settings: MachineSettingsSchema }), owner: 'machine' },
} as const satisfies Record<`machineSettings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'machineSettings.changed': z.strictObject({ settings: MachineSettingsSchema }), // the whole machine half, after each persisted change
} as const satisfies Record<`machineSettings.${string}`, z.ZodType>;
