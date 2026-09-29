// X2 `settings.*`: the persisted app settings and the theme resolved from them (charter §12 C1 *Theme switching*).
// Version 2 (C5): the keymap overrides and the notification policy. C11 extends the object later with its own step.
import * as z from 'zod';
import { ACTION_IDS } from '../../keymap/actions';
import { CHORD_PATTERN } from '../../keymap/chord';
import type { CommandSpec } from './common';

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

export const commands = {
  'settings.get': { input: z.void(), output: SettingsStateSchema, owner: 'main' },
  'settings.set': { input: SettingsPatchSchema, output: SettingsStateSchema, owner: 'main' },
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'settings.changed': SettingsStateSchema,
} as const satisfies Record<`settings.${string}`, z.ZodType>;
