// X2 `settings.*`: the persisted app settings and the theme resolved from them (charter §12 C1 *Theme switching*).
// Version 2 (C5): the keymap overrides and the notification policy. C11 extends the object later with its own step.
import * as z from 'zod';
import { ACTION_IDS } from '../../keymap/actions';
import { CHORD_PATTERN } from '../../keymap/chord';
import type { CommandSpec } from './common';
// C7 start
import { UsageSnapshotSchema } from '../../usage/types';
// C7 end

export const ThemeSettingSchema = z.enum(['light', 'dark', 'system']);
export type ThemeSetting = z.infer<typeof ThemeSettingSchema>;

export const ChordSchema = z.string().regex(CHORD_PATTERN); // Electron accelerator syntax, readable by parseChord

export const SettingsSchema = z.strictObject({
  version: z.literal(2),
  theme: ThemeSettingSchema,
  // Overrides only; null unbinds; absent means the default. `partialRecord`, because zod 4's enum-keyed `record` is
  // exhaustive and would reject `{}` and every single override; unknown keys are still rejected.
  keymap: z.partialRecord(z.enum(ACTION_IDS), ChordSchema.nullable()),
  notifications: z.strictObject({ enabled: z.boolean(), sound: z.boolean() }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = SettingsSchema.omit({ version: true }).partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const SettingsStateSchema = z.strictObject({ settings: SettingsSchema, resolvedTheme: z.enum(['light', 'dark']) });
export type SettingsState = z.infer<typeof SettingsStateSchema>;

// C7 start: the account usage main reads from ClaudeUsage's files (C7 execution document, Interfaces "Status line
// popovers and usage"). `settings.usage` answers the snapshot with `pinsFor` filled for the engine session ids it names;
// `settings.usageChanged` carries the next snapshot when the files change, `pinsFor` for the ids the last call named.
const c7Commands = {
  'settings.usage': { input: z.strictObject({ engineSessionIds: z.array(z.string()).max(64) }), output: UsageSnapshotSchema, owner: 'main' },
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
const c7Events = {
  'settings.usageChanged': UsageSnapshotSchema,
} as const satisfies Record<`settings.${string}`, z.ZodType>;
// C7 end

export const commands = {
  'settings.get': { input: z.void(), output: SettingsStateSchema, owner: 'main' },
  'settings.set': { input: SettingsPatchSchema, output: SettingsStateSchema, owner: 'main' },
  ...c7Commands, // C7
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'settings.changed': SettingsStateSchema,
  ...c7Events, // C7
} as const satisfies Record<`settings.${string}`, z.ZodType>;
