import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_REFUSAL, RETIRED_HOST_MODE, retiredHostModeNotice, testLaunchRefusal } from './mode';

// P5 O15 M2: MAWS_HOST_MODE chooses nothing; a value other than `daemon` is said once, in one line
describe('retiredHostModeNotice', () => {
  it('names the variable retired for every value but daemon, and says nothing when it is unset or daemon', () => {
    for (const asked of ['utility', 'detached', 'embedded', 'socket']) expect(retiredHostModeNotice({ MAWS_HOST_MODE: asked })).toBe(RETIRED_HOST_MODE);
    for (const env of [{}, { MAWS_HOST_MODE: '' }, { MAWS_HOST_MODE: 'daemon' }]) expect(retiredHostModeNotice(env)).toBeNull();
    expect(RETIRED_HOST_MODE).toBe('[hosts] MAWS_HOST_MODE is retired and ignored: the app runs on mawsd');
  });
});

// P5 O2 landing (O3's planner, P9): a test or harness launch on the default profile would plan against the owner's
// daemon (install, repair or start the owner's unit), so it refuses before any host work, whatever the environment
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
