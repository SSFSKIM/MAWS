// Which other profiles' machines this app links to (P5 O6 M3, "Configuration").
import { describe, expect, it, vi } from 'vitest';
import { configuredMachines } from './config';

describe('configuredMachines', () => {
  it('reads MAWS_LOCAL_MACHINES as a colon-separated list of absolute serve directories, each once', () => {
    const log = vi.fn();
    expect(configuredMachines({ packaged: false, env: { MAWS_LOCAL_MACHINES: '/b/machine-serve::/c/machine-serve/:/b/machine-serve' }, log })).toEqual(['/b/machine-serve', '/c/machine-serve']);
    expect(configuredMachines({ packaged: false, env: {}, log })).toEqual([]);
    expect(configuredMachines({ packaged: false, env: { MAWS_LOCAL_MACHINES: '' }, log })).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('skips a relative directory, saying so', () => {
    const log = vi.fn();
    expect(configuredMachines({ packaged: false, env: { MAWS_LOCAL_MACHINES: 'relative/serve:/b/machine-serve' }, log })).toEqual(['/b/machine-serve']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('relative/serve'));
  });

  it('ignores the variable in a packaged build, with one log line', () => {
    const log = vi.fn();
    expect(configuredMachines({ packaged: true, env: { MAWS_LOCAL_MACHINES: '/b/machine-serve' }, log })).toEqual([]);
    expect(log).toHaveBeenCalledOnce();
    expect(configuredMachines({ packaged: true, env: {}, log })).toEqual([]);
    expect(log).toHaveBeenCalledOnce();
  });
});
