// Keeping a path out of Time Machine (P5-O10, the device key's follow-up): NSURLIsExcludedFromBackupKey, the sticky
// exclusion that rides on the item itself, set through osascript on macOS only.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { excludeFromBackup } from './backup-exclusion';

const STICKY_EXCLUSION = 'com.apple.metadata:com_apple_backup_excludeItem';
// A relative path osascript would read as one more script, its own `run` answering in place of ours.
const SCRIPT_SHAPED = '-efunction run(){return true;}let device=1;0/device';

describe('excludeFromBackup', () => {
  it('on macOS sets NSURLIsExcludedFromBackupKey on the path, passed as an argument and bounded by a timeout', async () => {
    const runs: { file: string; args: string[]; timeoutMs: number }[] = [];
    expect(await excludeFromBackup('/profile/device', { platform: 'darwin', run: async (file, args, timeoutMs) => void runs.push({ file, args, timeoutMs }) })).toBe(true);
    expect(runs).toHaveLength(1);
    const [{ file, args, timeoutMs }] = runs as [(typeof runs)[number]];
    expect(file).toBe('/usr/bin/osascript');
    expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
    expect(args[3]).toContain('NSURLIsExcludedFromBackupKey');
    expect(args[3]).not.toContain('/profile/device');
    expect(args.slice(4)).toEqual(['--', '/profile/device']);
    expect(timeoutMs).toBeGreaterThan(0);
  });

  it('hands osascript a path that looks like an option as data: absolute, after `--`', async () => {
    const runs: string[][] = [];
    await excludeFromBackup(SCRIPT_SHAPED, { platform: 'darwin', run: async (_file, args) => void runs.push(args) });
    const [args] = runs as [string[]];
    expect(args.slice(4)).toEqual(['--', resolve(SCRIPT_SHAPED)]);
    expect(args.filter((arg) => arg === '-e')).toHaveLength(1);
  });

  it('elsewhere does nothing, and says it excluded nothing', async () => {
    const runs: string[] = [];
    expect(await excludeFromBackup('/profile/device', { platform: 'linux', run: async (file) => void runs.push(file) })).toBe(false);
    expect(runs).toEqual([]);
  });

  it('fails when the exclusion is not set', async () => {
    const failing = async () => Promise.reject(new Error('execution error: Error: Error: the file could not be saved (-2700)'));
    await expect(excludeFromBackup('/profile/device', { platform: 'darwin', run: failing })).rejects.toThrow('-2700');
  });

  // tmpdir is already outside Time Machine on macOS (`tmutil isexcluded` says so of anything in it), so the proof is the
  // sticky attribute itself, absent before and present after.
  it.runIf(process.platform === 'darwin')('sets the sticky exclusion attribute on a scratch directory, with the real osascript', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'maws-backup-exclusion-'));
    const attributes = (path: string) => execFileSync('/usr/bin/xattr', [path], { encoding: 'utf8' }).split('\n');
    try {
      const dir = join(scratch, 'device');
      await mkdir(dir, { mode: 0o700 });
      expect(attributes(dir)).not.toContain(STICKY_EXCLUSION);
      await excludeFromBackup(dir);
      expect(attributes(dir)).toContain(STICKY_EXCLUSION);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'darwin')('rejects, with the real osascript, a script-shaped path that is not there', async () => {
    await expect(excludeFromBackup(SCRIPT_SHAPED)).rejects.toThrow();
  });

  it.runIf(process.platform === 'darwin')('rejects, with the real osascript, for a path that is not there', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'maws-backup-exclusion-'));
    try {
      await expect(excludeFromBackup(join(scratch, 'missing'))).rejects.toThrow();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
