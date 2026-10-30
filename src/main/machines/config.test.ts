// Which other profiles' machines this app links to (P5 O6 M3, "Configuration").
import { describe, expect, it, vi } from 'vitest';
import { configuredMachines } from './config';

describe('configuredMachines', () => {
  it('reads MAWS_LOCAL_MACHINES as a colon-separated list of absolute profile directories, each once', () => {
    const log = vi.fn();
    expect(configuredMachines({ packaged: false, env: { MAWS_LOCAL_MACHINES: '/profiles/b::/profiles/c/:/profiles/b' }, log })).toEqual(['/profiles/b', '/profiles/c']);
    expect(configuredMachines({ packaged: false, env: {}, log })).toEqual([]);
    expect(configuredMachines({ packaged: false, env: { MAWS_LOCAL_MACHINES: '' }, log })).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('skips a relative directory, saying so', () => {
    const log = vi.fn();
    expect(configuredMachines({ packaged: false, env: { MAWS_LOCAL_MACHINES: 'relative/profile:/profiles/b' }, log })).toEqual(['/profiles/b']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('relative/profile'));
  });

  it('ignores the variable in a packaged build, with one log line', () => {
    const log = vi.fn();
    expect(configuredMachines({ packaged: true, env: { MAWS_LOCAL_MACHINES: '/profiles/b' }, log })).toEqual([]);
    expect(log).toHaveBeenCalledOnce();
    expect(configuredMachines({ packaged: true, env: {}, log })).toEqual([]);
    expect(log).toHaveBeenCalledOnce();
  });
});
