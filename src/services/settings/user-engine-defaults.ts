// What the engine will use when MAWS passes nothing (W3; charter §5.4 and D-18 as amended 2026-10-01): the user's own
// `model`, `effortLevel` and `permissions.defaultMode`, read from `<config home>/settings.json` (CLAUDE_CONFIG_DIR, else
// ~/.claude). Read only, never written (the waves document §1 item 4). An unstarted tab's model chip names the model and
// effort from it, and a new intent's permission mode is seeded from it. A missing or unreadable file, or a key whose
// value the engine would not take, answers null for that key.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EffortSchema } from '@shared/engine/launch-spec';
import { PermissionModeSchema } from '@shared/graph/enums';
import type { UserEngineDefaults } from '@shared/ipc/schema/settings';

export const NO_USER_DEFAULTS: UserEngineDefaults = Object.freeze({ model: null, effortLevel: null, defaultMode: null }) as UserEngineDefaults;

export function userEngineDefaultsOf(raw: unknown): UserEngineDefaults {
  if (typeof raw !== 'object' || raw === null) return NO_USER_DEFAULTS;
  const file = raw as { model?: unknown; effortLevel?: unknown; permissions?: unknown };
  const permissions = typeof file.permissions === 'object' && file.permissions !== null ? (file.permissions as { defaultMode?: unknown }) : {};
  const effort = EffortSchema.safeParse(file.effortLevel);
  const mode = PermissionModeSchema.safeParse(permissions.defaultMode);
  return {
    model: typeof file.model === 'string' && file.model.trim() !== '' ? file.model.trim() : null,
    effortLevel: effort.success ? effort.data : null,
    defaultMode: mode.success ? mode.data : null,
  };
}

export async function readUserEngineDefaults(configHome: string): Promise<UserEngineDefaults> {
  try {
    return userEngineDefaultsOf(JSON.parse(await readFile(join(configHome, 'settings.json'), 'utf8')));
  } catch {
    return NO_USER_DEFAULTS;
  }
}
