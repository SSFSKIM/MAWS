import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE_REFUSAL, hostModeFromEnv, testLaunchRefusal } from './mode';

describe('hostModeFromEnv', () => {
  // P5 O2 M7: with no override and no harness the shape decides
  it('runs the hosts under the machine daemon on the daemon shape, and the engine host detached on the embedded one', () => {
    expect(hostModeFromEnv({}, 'daemon')).toBe('daemon');
    expect(hostModeFromEnv({}, 'embedded')).toBe('detached');
  });

  // P5 O3-B: the suites run the shape the owner runs, the daemon's unless the setting says embedded
  it('lets the shape decide under the e2e harness and the component harness, as for the owner', () => {
    for (const harness of [{ MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }, { MAWS_E2E: '1', MAWS_HARNESS: '1' }]) {
      expect(hostModeFromEnv(harness, 'daemon')).toBe('daemon');
      expect(hostModeFromEnv(harness, 'embedded')).toBe('detached');
    }
  });

  it('honours MAWS_HOST_MODE over every default, the shape and the harnesses alike', () => {
    for (const shape of ['daemon', 'embedded'] as const) {
      expect(hostModeFromEnv({ MAWS_HOST_MODE: 'utility' }, shape)).toBe('utility');
      expect(hostModeFromEnv({ MAWS_HOST_MODE: 'detached', MAWS_E2E: '1' }, shape)).toBe('detached');
      expect(hostModeFromEnv({ MAWS_HOST_MODE: 'detached', MAWS_HARNESS: '1' }, shape)).toBe('detached');
      expect(hostModeFromEnv({ MAWS_HOST_MODE: 'daemon', MAWS_E2E: '1' }, shape)).toBe('daemon'); // P5 O2 M7
      expect(hostModeFromEnv({ MAWS_HOST_MODE: 'daemon' }, shape)).toBe('daemon');
    }
    expect(hostModeFromEnv({ MAWS_HOST_MODE: 'detached' }, 'daemon')).toBe('detached');
  });

  it('ignores a value it does not know and falls back to the default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(hostModeFromEnv({ MAWS_HOST_MODE: 'socket' }, 'embedded')).toBe('detached');
    expect(hostModeFromEnv({ MAWS_HOST_MODE: 'socket' }, 'daemon')).toBe('daemon');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    expect(hostModeFromEnv({ MAWS_HOST_MODE: '', MAWS_E2E: '1' }, 'embedded')).toBe('detached');
  });
});

// P5 O2 landing (O3's planner, P9): a test or harness launch on the default profile would plan against the owner's
// daemon (leave it, or install or uninstall the owner's unit), so it refuses before any host work, whatever the mode
describe('testLaunchRefusal', () => {
  const MODES = [undefined, 'utility', 'detached', 'daemon', 'socket'] as const;
  const HARNESSES: NodeJS.ProcessEnv[] = [{}, { MAWS_E2E: '1' }, { MAWS_HARNESS: '1' }, { MAWS_E2E: '1', MAWS_HARNESS: '1' }, { MAWS_E2E: '0', MAWS_HARNESS: 'true' }];
  for (const asked of MODES)
    for (const harness of HARNESSES)
      for (const defaultProfile of [false, true]) {
        const refused = (harness.MAWS_E2E === '1' || harness.MAWS_HARNESS === '1') && defaultProfile;
        it(`${refused ? 'refuses' : 'lets'} ${JSON.stringify(harness)} MAWS_HOST_MODE=${asked ?? '(unset)'} on ${defaultProfile ? 'the default' : 'another'} profile`, () => {
          const env = { ...harness, ...(asked ? { MAWS_HOST_MODE: asked } : {}) };
          expect(testLaunchRefusal(env, defaultProfile)).toBe(refused ? DEFAULT_PROFILE_REFUSAL : null);
        });
      }

  it('says so in one line naming MAWS_USER_DATA', () => {
    expect(DEFAULT_PROFILE_REFUSAL).toContain('MAWS_USER_DATA');
    expect(DEFAULT_PROFILE_REFUSAL).not.toContain('\n');
  });
});
