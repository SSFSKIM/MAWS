// X2 `machineSettings.*` (P5 O3-D, docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §G; contract O3X3):
// the machine half of the settings (`machine-settings.json`, O3-A's split) as the spine serves it, `mawsd`'s on the daemon
// shape, so main composes the renderer's one `Settings` from it over the services front. `machine`-owned; graded
// `machine-admin`, the settings' own grade. The renderer's `settings.*` is unchanged.
// P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9 "The default, without a v2"): `defaultRoute`,
// the machine's default route as resolved (`machine-route.json`'s, else the rule over `gateway.defaultRoute`), beside
// the file, which gains no property. A `mawsd` from M9 on writes it on every answer and change; one that predates it
// writes none, and acts on `gateway.defaultRoute` alone. `set`'s own `defaultRoute` chooses the default (after the
// patch); it goes only to a `mawsd` whose answers carry one.
import * as z from 'zod';
import { RouteSchema } from '../../engine/route';
import type { CommandSpec } from './common';
import { MachineSettingsPatchSchema, MachineSettingsSchema } from './settings';

export const commands = {
  // `version`: the machine half's revision, bumped at each persisted change
  'machineSettings.get': { input: z.void(), output: z.strictObject({ settings: MachineSettingsSchema, version: z.number().int().nonnegative(), defaultRoute: RouteSchema.optional() }), owner: 'machine' },
  // answered once the write persisted and every listener was told; refused (nothing changed) when the file may not be written
  'machineSettings.set': { input: z.strictObject({ patch: MachineSettingsPatchSchema, defaultRoute: RouteSchema.optional() }), output: z.strictObject({ settings: MachineSettingsSchema, defaultRoute: RouteSchema.optional() }), owner: 'machine' },
} as const satisfies Record<`machineSettings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'machineSettings.changed': z.strictObject({ settings: MachineSettingsSchema, defaultRoute: RouteSchema.optional() }), // the whole machine half, after each persisted change
} as const satisfies Record<`machineSettings.${string}`, z.ZodType>;
