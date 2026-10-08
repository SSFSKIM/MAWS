// E11's sitting (owner-notes 00-consolidated-plan §2.7, report A): a rebuilt app launched while an older process is alive
// exited silently under the profile lock, and nothing said which build main was. Main's own build (commit and time,
// stamped by electron.vite.config.ts) is logged at startup and shown in Diagnostics; a second launch hands its build to
// the running instance, which says so when it is the older one.
import { describe, expect, it } from 'vitest';
import { describeMainBuild, launchedBuildOf, olderInstanceNotice, type MainBuild } from './build-identity';

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
