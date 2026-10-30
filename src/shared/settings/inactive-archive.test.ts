import { expect, it } from 'vitest';
import { SettingsPatchSchema } from '../ipc/schema/settings';
import { applySettingsPatch, migrateSettings, SETTINGS_DEFAULTS_V21 } from './defaults';

it('keeps existing installs opted out and persists only the chosen inactivity threshold', () => {
  const saved = structuredClone(SETTINGS_DEFAULTS_V21) as Record<string, unknown>;
  saved.version = 17;
  saved.engine = { ...SETTINGS_DEFAULTS_V21.engine, launchProfile: { ...SETTINGS_DEFAULTS_V21.engine.launchProfile, outputStyle: 'user' } }; // a v17 file's profile had a style
  delete saved.sessions;
  saved.supervisor = { ...SETTINGS_DEFAULTS_V21.supervisor, shape: undefined }; // P5 O2 M7: a v17 file has no shape
  delete (saved.supervisor as Record<string, unknown>).shape;
  const migrated = migrateSettings(saved);
  expect(migrated.sessions).toEqual({ archiveInactiveDays: null });
  const patch = SettingsPatchSchema.parse({ sessions: { archiveInactiveDays: 14 } });
  expect(applySettingsPatch(migrated, patch).sessions).toEqual({ archiveInactiveDays: 14 });
  expect(SettingsPatchSchema.safeParse({ sessions: { archiveInactiveDays: 1 } }).success).toBe(false);
});
