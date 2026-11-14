import { describe, expect, it } from 'vitest';
import { launchMode, scenarioClock, scenarioPath, stubLongHistory } from './select-source';

describe('launch mode', () => {
  it('is scenario only for a stub source in dev or under the e2e switch', () => {
    expect(launchMode({ MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json' }, false)).toBe('scenario');
    expect(launchMode({ MAWS_SESSION_SOURCE: 'stub:x.json' }, true)).toBe('index');
    expect(launchMode({ MAWS_SESSION_SOURCE: 'stub:x.json', MAWS_E2E: '1' }, true)).toBe('scenario');
    expect(launchMode({}, false)).toBe('index');
    expect(launchMode({ MAWS_SESSION_SOURCE: 'index' }, false)).toBe('index');
  });

  it('resolves a relative scenario against the repository root in dev and refuses it when packaged without the e2e switch', () => {
    const env = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json' };
    expect(scenarioPath(env, { packaged: false, appRoot: '/repo' })).toBe('/repo/test/fixtures/shell/nine-sessions.json');
    expect(scenarioPath({ MAWS_SESSION_SOURCE: 'stub:/abs/s.json' }, { packaged: true, appRoot: '/app' })).toBe('/abs/s.json');
    expect(() => scenarioPath(env, { packaged: true, appRoot: '/app' })).toThrow(/relative/);
    expect(scenarioPath({ ...env, MAWS_E2E: '1' }, { packaged: true, appRoot: '/app' })).toBe('/app/test/fixtures/shell/nine-sessions.json');
  });

  it('uses the manual clock only under the e2e switch', () => {
    expect(scenarioClock({ MAWS_SCENARIO_CLOCK: 'manual', MAWS_E2E: '1' })).toEqual({ kind: 'manual' });
    expect(scenarioClock({ MAWS_SCENARIO_CLOCK: 'manual' })).toEqual({ kind: 'wall' });
    expect(scenarioClock({})).toEqual({ kind: 'wall' });
  });

  it('gives one session a long history only when a scene asks for it under the e2e switch', () => {
    expect(stubLongHistory({ MAWS_STUB_LONG_HISTORY: 'app-9a1d4262', MAWS_E2E: '1' })).toBe('app-9a1d4262');
    expect(stubLongHistory({ MAWS_STUB_LONG_HISTORY: 'app-9a1d4262' })).toBeNull();
    expect(stubLongHistory({ MAWS_STUB_LONG_HISTORY: '', MAWS_E2E: '1' })).toBeNull();
    expect(stubLongHistory({ MAWS_E2E: '1' })).toBeNull();
  });
});
