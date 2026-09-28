// X2 `settings.*`: the persisted app settings and the theme resolved from them (charter §12 C1 *Theme switching*).
import * as z from 'zod';
import type { CommandSpec } from './common';

export const ThemeSettingSchema = z.enum(['light', 'dark', 'system']);
export type ThemeSetting = z.infer<typeof ThemeSettingSchema>;

export const SettingsSchema = z.strictObject({ version: z.literal(1), theme: ThemeSettingSchema });
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
