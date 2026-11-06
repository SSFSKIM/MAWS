// The homes the home-root rule and a home spawn read (2026-11-06): `os.homedir()`'s realpath, where a `~` spawn starts,
// and beside it the passwd entry's home when `$HOME` names another; the roots that reach either.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coversHome, machineHome, machineHomes } from './machine-home';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the machine’s home', () => {
  it('is os.homedir()’s native realpath, read once, and the rule’s homes hold it and the account’s', () => {
    expect(machineHome()).toBe(realpathSync.native(homedir()));
    expect(machineHome()).toBe(machineHome());
    expect(machineHomes()).toEqual([...new Set([machineHome(), realpathSync.native(userInfo().homedir)])]);
  });

  // The desk track's review (P3 a): Node's os.homedir() is `$HOME` when it is set, so a process whose `$HOME` names another
  // folder starts its `~` chats there, and still keeps its account's home out of a remote member's reach.
  it('keeps the account’s home among the rule’s homes when `$HOME` names another folder', async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'machine-home-')));
    try {
      vi.stubEnv('HOME', elsewhere);
      vi.resetModules();
      const fresh = await import('./machine-home');
      expect(fresh.machineHome()).toBe(elsewhere);
      expect(fresh.machineHomes()).toEqual([elsewhere, realpathSync.native(userInfo().homedir)]);
      expect(fresh.coversHome(realpathSync.native(userInfo().homedir))).toBe(true);
      expect(fresh.coversHome(elsewhere)).toBe(true);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('is covered by itself and every ancestor, at a segment boundary, and by nothing below it or beside it', () => {
    const home = '/Users/kim';
    for (const root of ['/Users/kim', '/Users', '/']) expect([root, coversHome(root, home)]).toEqual([root, true]);
    for (const root of ['/Users/kim/proj', '/Users/ki', '/Users/kimberly', '/opt']) expect([root, coversHome(root, home)]).toEqual([root, false]);
    expect(coversHome('/home', ['/Users/kim', '/home/kim'])).toBe(true);
  });
});
