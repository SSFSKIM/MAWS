// E11's sitting (owner-notes 00-consolidated-plan §2.7, report A): a rebuilt app launched while an older process is alive
// exited silently under the profile lock, and nothing said which build main was. Main's own build (commit and time,
// stamped by electron.vite.config.ts) is logged at startup and shown in Diagnostics; a second launch hands its build to
// the running instance, which says so when it is the older one.
import { describe, expect, it, vi } from 'vitest';
import { describeMainBuild, launchedBuildOf, loadedBundlePath, olderInstanceNotice, staleBuildCheck, type MainBuild } from './build-identity';

const RUNNING: MainBuild = { version: '0.0.0', commit: '5dcddd70', builtAt: '2026-10-04T23:41:00.000Z' };
const NEWER: MainBuild = { version: '0.0.0', commit: 'ac8724a6', builtAt: '2026-10-08T09:05:53.000Z' };
const at = (iso: string) => `<${iso}>`; // the time as the dialog would format it

describe("main's build identity", () => {
  it('describes itself by version, commit and build time', () => {
    expect(describeMainBuild(RUNNING)).toBe('MAWS 0.0.0 · build 5dcddd70 · built 2026-10-04T23:41:00.000Z');
  });

  it('reads the build a second launch handed over, and nothing else', () => {
    expect(launchedBuildOf({ build: NEWER })).toEqual(NEWER);
    expect(launchedBuildOf({ build: { commit: 'x' } })).toBeNull();
    expect(launchedBuildOf(null)).toBeNull();
    expect(launchedBuildOf({})).toBeNull();
  });

  it('a launch of a newer build tells the running, older one to quit; the same build, an older one or an unknown one only focuses it', () => {
    expect(olderInstanceNotice(RUNNING, NEWER, at)).toBe('An older MAWS is running (built <2026-10-04T23:41:00.000Z>); quit it to use this build');
    expect(olderInstanceNotice(RUNNING, RUNNING, at)).toBeNull();
    expect(olderInstanceNotice(NEWER, RUNNING, at)).toBeNull();
    expect(olderInstanceNotice(RUNNING, null, at)).toBeNull();
    expect(olderInstanceNotice(RUNNING, { ...NEWER, builtAt: 'not a time' }, at)).toBeNull();
  });
});

// E11 F2b (plan 2.7b; the owner's actual case): a rebuild at the same bundle path, then opening the app, activates the
// running copy and starts no second process, so no second launch hands a build over. The running instance compares the
// bundle it loaded, as it is on disk now, against its own start: a newer bundle says so, once per build on disk.
describe('the build on disk against the running process', () => {
  const STARTED = Date.parse('2026-10-08T09:24:19.000Z');

  it('names the bundle main loaded: the packaged app.asar, or the development build of main', () => {
    expect(loadedBundlePath({ packaged: true, resourcesPath: '/Applications/MAWS.app/Contents/Resources', appPath: '/x' })).toBe('/Applications/MAWS.app/Contents/Resources/app.asar');
    expect(loadedBundlePath({ packaged: false, resourcesPath: '/electron/Resources', appPath: '/repo' })).toBe('/repo/out/main/index.js');
  });

  it('a bundle written after the process started is a newer build: said once per build on disk, then again for the next one', () => {
    let mtime: number | null = STARTED - 60_000;
    const stat = vi.fn(() => mtime);
    const check = staleBuildCheck({ bundlePath: '/b/app.asar', stat, startedAt: STARTED, running: RUNNING, formatTime: at });
    expect(check(), 'the bundle it started from').toBeNull();
    mtime = STARTED + 3_600_000;
    expect(check()).toBe('An older MAWS is running, built <2026-10-04T23:41:00.000Z>; the build on disk is newer; quit to use it');
    expect(check(), 'the same build on disk, already said').toBeNull();
    mtime += 60_000;
    expect(check(), 'another rebuild').not.toBeNull();
    expect(stat).toHaveBeenCalledWith('/b/app.asar');
  });

  it('a bundle that cannot be read says nothing', () => {
    expect(staleBuildCheck({ bundlePath: '/gone', stat: () => null, startedAt: STARTED, running: RUNNING, formatTime: at })()).toBeNull();
  });
});
