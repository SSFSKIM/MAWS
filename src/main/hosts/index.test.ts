// The launch's preflight and outcome in main as the app calls them (P5 O15 M2 fix wave 2; the architect's rule: nothing
// between the launch's start and the repair window's first paint throws past it). Where the account's home cannot be
// read (no usable HOME and a failed account lookup, `homedir()` throws), an ordinary launch passes the test-launch
// preflight without reading it and reaches prepareLaunch's outcome, `install-refused` with the lookup's words, never an
// exception; a test or harness launch fails closed, refused as on the default profile.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE_REFUSAL } from './mode';

const lookup = vi.hoisted(() => ({ fails: false }));
const HOME_ERROR = 'ENOENT: no such file or directory, uv_os_homedir returned ENOENT';
vi.mock('node:os', async (original) => {
  const real = await original<typeof import('node:os')>();
  const failing = <T,>(read: () => T) => () => {
    if (lookup.fails) throw new Error(HOME_ERROR);
    return read();
  };
  return { ...real, homedir: failing(real.homedir), userInfo: failing(() => real.userInfo()) };
});
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp/maws-preflight-profile' }, shell: {} }));
vi.mock('../../engine-host/index?modulePath', () => ({ default: '/out/main/engine-host.js' }));
vi.mock('../../pty-host/index?modulePath', () => ({ default: '/out/main/pty-host.js' }));

class Exited extends Error {}
let exit: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  lookup.fails = true;
  vi.stubEnv('MAWS_E2E', '0');
  vi.stubEnv('MAWS_HARNESS', '0');
  exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Exited();
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  lookup.fails = false;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the launch’s preflight and outcome where the home cannot be read', () => {
  it('an ordinary launch passes the preflight and reaches prepareLaunch’s outcome: install-refused with the lookup’s words', async () => {
    const { prepareLaunch, refuseTestLaunchOnDefaultProfile } = await import('./index');
    expect(() => refuseTestLaunchOnDefaultProfile()).not.toThrow();
    let outcome: unknown;
    expect(() => void (outcome = prepareLaunch())).not.toThrow();
    expect(await outcome).toEqual({ ok: false, unavailable: { kind: 'install-refused', why: HOME_ERROR } });
    expect(exit).not.toHaveBeenCalled();
  });

  it.each(['MAWS_E2E', 'MAWS_HARNESS'])('a %s launch fails closed: refused as on the default profile, exiting 1', async (name) => {
    vi.stubEnv(name, '1');
    const { refuseTestLaunchOnDefaultProfile } = await import('./index');
    expect(() => refuseTestLaunchOnDefaultProfile()).toThrow(Exited);
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(DEFAULT_PROFILE_REFUSAL));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(HOME_ERROR));
  });
});
