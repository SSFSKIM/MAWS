import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from '@shared/ipc/schema/settings';
import { NO_USER_DEFAULTS, readUserEngineDefaults, userEngineDefaultsOf } from './user-engine-defaults';

describe('userEngineDefaultsOf', () => {
  it('reads model, effortLevel and permissions.defaultMode', () => {
    expect(userEngineDefaultsOf({ model: 'fable', effortLevel: 'xhigh', permissions: { defaultMode: 'auto', allow: [] } })).toEqual({ model: 'fable', effortLevel: 'xhigh', defaultMode: 'auto' });
  });

  it('answers null for a key it does not find or the engine would not take', () => {
    expect(userEngineDefaultsOf({ model: '', effortLevel: 'extreme', permissions: { defaultMode: 'sometimes' } })).toEqual(NO_USER_DEFAULTS);
    expect(userEngineDefaultsOf({ permissions: null })).toEqual(NO_USER_DEFAULTS);
    expect(userEngineDefaultsOf('not an object')).toEqual(NO_USER_DEFAULTS);
  });
});

describe('readUserEngineDefaults', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const home = () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-user-defaults-'));
    dirs.push(dir);
    return dir;
  };

  it('reads the config home settings file and validates as the command answers', async () => {
    const dir = home();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'sonnet', effortLevel: 'high', permissions: { defaultMode: 'acceptEdits' } }));
    const read = await readUserEngineDefaults(dir);
    expect(read).toEqual({ model: 'sonnet', effortLevel: 'high', defaultMode: 'acceptEdits' });
    expect(commands['settings.userEngineDefaults'].output.safeParse(read).success).toBe(true);
  });

  it('answers nulls for a missing or malformed file', async () => {
    expect(await readUserEngineDefaults(home())).toEqual(NO_USER_DEFAULTS);
    const dir = home();
    writeFileSync(join(dir, 'settings.json'), '{ not json');
    expect(await readUserEngineDefaults(dir)).toEqual(NO_USER_DEFAULTS);
  });
});
