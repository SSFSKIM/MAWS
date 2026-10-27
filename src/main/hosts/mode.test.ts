import { describe, expect, it, vi } from 'vitest';
import { hostModeFromEnv } from './mode';

describe('hostModeFromEnv', () => {
  // P5 O2 M7: with no override and no harness the shape decides
  it('runs the hosts under the machine daemon on the daemon shape, and the engine host detached on the embedded one', () => {
    expect(hostModeFromEnv({}, 'daemon')).toBe('daemon');
    expect(hostModeFromEnv({}, 'embedded')).toBe('detached');
  });

  it('keeps the utility process under the e2e harness and the component harness, whatever the shape (G5: no script changes)', () => {
    for (const shape of ['daemon', 'embedded'] as const) {
      expect(hostModeFromEnv({ MAWS_E2E: '1' }, shape)).toBe('utility');
      expect(hostModeFromEnv({ MAWS_HARNESS: '1' }, shape)).toBe('utility');
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
    expect(hostModeFromEnv({ MAWS_HOST_MODE: '', MAWS_E2E: '1' }, 'daemon')).toBe('utility');
  });

  it('reads the flags as exactly "1"', () => {
    expect(hostModeFromEnv({ MAWS_E2E: '0' }, 'embedded')).toBe('detached');
    expect(hostModeFromEnv({ MAWS_HARNESS: 'true' }, 'daemon')).toBe('daemon');
  });
});
