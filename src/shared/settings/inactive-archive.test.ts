import { expect, it } from 'vitest';
import { SettingsPatchSchema } from '../ipc/schema/settings';
import { applySettingsPatch, migrateSettings, SETTINGS_DEFAULTS_V18 } from './defaults';

it('keeps existing installs opted out and persists only the chosen inactivity threshold', () => {
  const saved = structuredClone(SETTINGS_DEFAULTS_V18) as Record<string, unknown>;
  saved.version = 17;
  delete saved.sessions;
  const migrated = migrateSettings(saved);
  expect(migrated.sessions).toEqual({ archiveInactiveDays: null });
  const patch = SettingsPatchSchema.parse({ sessions: { archiveInactiveDays: 14 } });
  expect(applySettingsPatch(migrated, patch).sessions).toEqual({ archiveInactiveDays: 14 });
  expect(SettingsPatchSchema.safeParse({ sessions: { archiveInactiveDays: 1 } }).success).toBe(false);
});
