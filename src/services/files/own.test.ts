// MAWS's own folders (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, decision 8):
// the profile folder, the bundle the daemon runs from and the bundle each attached app told it, as real paths. Every
// folder here is a scratch folder handed to the function as MAWS's own.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ownFolders } from './own';

let base: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-own-')));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));
const at = (...parts: string[]) => join(base, ...parts);
const folder = (...parts: string[]) => (mkdirSync(at(...parts), { recursive: true }), at(...parts));

describe('ownFolders', () => {
  it('answers the profile and the outermost bundle above the executable, through nested bundles, as real paths', () => {
    const profile = folder('profile');
    const exec = join(folder('Apps', 'MAWS.app', 'Contents', 'Frameworks', 'MAWS Helper.app', 'Contents', 'MacOS'), 'MAWS Helper');
    writeFileSync(exec, '');
    symlinkSync(at('Apps'), at('via'));
    expect(ownFolders(join(base, 'profile'), exec, () => [])()).toEqual([profile, at('Apps', 'MAWS.app')]);
    expect(ownFolders(at('profile'), join(at('via'), 'MAWS.app', 'Contents', 'Frameworks', 'MAWS Helper.app', 'Contents', 'MacOS', 'MAWS Helper'), () => [])()).toEqual([profile, at('Apps', 'MAWS.app')]);
  });

  it('answers the profile alone for an executable in no bundle', () => {
    folder('profile');
    expect(ownFolders(at('profile'), '/usr/local/bin/node', () => [])()).toEqual([at('profile')]);
  });

  it('adds each told bundle that is an absolute path to a folder named *.app, read at each call, once, and ignores the rest', () => {
    folder('profile');
    const app = folder('Other', 'MAWS Dev.app');
    folder('Other', 'plain');
    writeFileSync(at('Other', 'file.app'), '');
    symlinkSync(at('Other', 'plain'), at('Other', 'Linked.app')); // named *.app, but the folder it leads to is not
    let told: string[] = [];
    const own = ownFolders(at('profile'), '/usr/local/bin/node', () => told);
    expect(own()).toEqual([at('profile')]);
    told = [app, 'Other/MAWS Dev.app', at('Other', 'plain'), at('Other', 'file.app'), at('Other', 'gone.app'), at('Other', 'Linked.app'), `${at('Other')}/../Other/MAWS Dev.app`, ''];
    expect(own()).toEqual([at('profile'), app]);
    told = [];
    expect(own()).toEqual([at('profile')]);
  });

  it('leaves out a folder that does not resolve', () => {
    expect(ownFolders(at('no-profile'), join(at('Gone.app'), 'Contents', 'MacOS', 'x'), () => [])()).toEqual([]);
  });
});
