import type { StatusRead } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { contextLine, costLine, refreshError, statusLines } from './session-info';

describe('context use and cost, as session info draws them', () => {
  it('reads a full usage', () => {
    const usage = { context: { tokens: 36820, window: 1_000_000, percent: 4 }, cost: { usd: 0.003228125 } };
    expect(contextLine(usage)).toBe('36.8K of 1M (4%)');
    expect(costLine(usage)).toBe('$0.0032');
    expect(costLine({ ...usage, cost: { usd: 1.5 } })).toBe('$1.50');
  });

  it('says unavailable (no bridge) for a null usage, and unavailable for each piece it leaves out', () => {
    expect(contextLine(null)).toBe('unavailable (no bridge)');
    expect(costLine(null)).toBe('unavailable (no bridge)');
    expect(contextLine({ context: { window: 200_000 }, cost: null })).toBe('unavailable · 200K window');
    expect(costLine({ context: { window: 200_000 }, cost: null })).toBe('unavailable');
    expect(contextLine({ context: { tokens: 50_000, window: 200_000 }, cost: null })).toBe('50K of 200K (25%)');
  });

  it('does not infer no bridge from missing usage when the session is bridged', () => {
    expect(contextLine(null, true)).toBe('not reported yet');
    expect(costLine(null, true)).toBe('not reported yet');
    expect(contextLine(null, false)).toBe('unavailable (no bridge)');
  });

  it('says nothing yet before the snapshot', () => {
    expect(contextLine(undefined)).toBe('…');
    expect(costLine(undefined)).toBe('…');
  });
});

describe("the engine's status lines, from `read status`", () => {
  const STATUS: StatusRead = { version: { version: '2.1.307', base: '2.1.300' }, model: 'claude-opus-5-5', cwd: '/w/maws', root: '/w/maws', repo: { remote: 'https://github.com/SSFSKIM/maws.git', branch: 'master' }, surfaces: ['cli', 'desk'], override: null };
  const can = { can: true, reason: null };

  it('reads an answer: the version and its base, the root, the repository, the surfaces', () => {
    expect(statusLines({ pending: false, answer: STATUS, error: null }, can, true)).toEqual({ engine: '2.1.307 (base 2.1.300)', root: '/w/maws', repo: 'https://github.com/SSFSKIM/maws.git · master', surfaces: 'cli, desk' });
    const bare = { ...STATUS, version: { version: '2.1.307' }, repo: null, surfaces: [] };
    expect(statusLines({ pending: true, answer: bare, error: null }, can, true)).toEqual({ engine: '2.1.307', root: '/w/maws', repo: 'none', surfaces: 'none' });
  });

  it('says nothing yet while the first answer is awaited, and the refusal when there is none', () => {
    expect(statusLines(null, can, true).engine).toBe('…');
    expect(statusLines({ pending: true, answer: null, error: null }, can, true).root).toBe('…');
    expect(statusLines({ pending: false, answer: null, error: 'no read status' }, can, true).surfaces).toBe('unavailable (no read status)');
    expect(refreshError({ pending: false, answer: null, error: 'no read status' })).toBeNull(); // said in the fields
  });

  it('keeps the last answer through a failed Refresh, and says beside it that it is the last one', () => {
    const failed = { pending: false, answer: STATUS, error: 'no answer within 15 s' };
    expect(statusLines(failed, can, true).engine).toBe('2.1.307 (base 2.1.300)');
    expect(refreshError(failed)).toBe('Refresh failed (no answer within 15 s): showing the last answer');
    expect(refreshError({ pending: false, answer: STATUS, error: null })).toBeNull();
    expect(refreshError(null)).toBeNull();
  });

  it("says a bridged session's plugin lacks it and the version it would need, never a spinner; any other session's reason", () => {
    const older = { can: false, reason: "mini's plugin is older than the desk's controls: update sminos on mini" };
    expect(statusLines(null, older, true)).toEqual(Object.fromEntries(['engine', 'root', 'repo', 'surfaces'].map((k) => [k, 'not available from this plugin (needs sminos ≥ 1.7.0)'])));
    expect(statusLines(null, { can: false, reason: 'maws-45 runs without the bridge' }, false).engine).toBe('unavailable (maws-45 runs without the bridge)');
  });
});
