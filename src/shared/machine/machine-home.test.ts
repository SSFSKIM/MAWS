// The home the home-root rule and a home spawn read (2026-11-06): one realpath of os.homedir(), and the roots that reach it.
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { coversHome, machineHome } from './machine-home';

describe('the machine’s home', () => {
  it('is os.homedir()’s native realpath, read once', () => {
    expect(machineHome()).toBe(realpathSync.native(homedir()));
    expect(machineHome()).toBe(machineHome());
  });

  it('is covered by itself and every ancestor, at a segment boundary, and by nothing below it or beside it', () => {
    const home = '/Users/kim';
    for (const root of ['/Users/kim', '/Users', '/']) expect([root, coversHome(root, home)]).toEqual([root, true]);
    for (const root of ['/Users/kim/proj', '/Users/ki', '/Users/kimberly', '/opt']) expect([root, coversHome(root, home)]).toEqual([root, false]);
  });
});
