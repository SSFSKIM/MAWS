import { describe, expect, it, vi } from 'vitest';
import { hostModeFromEnv } from './mode';

describe('hostModeFromEnv', () => {
  it('runs the engine host detached by default', () => {
    expect(hostModeFromEnv({})).toBe('detached');
  });

  it('keeps the utility process under the e2e harness and the component harness (G5: no script changes)', () => {
    expect(hostModeFromEnv({ MAWS_E2E: '1' })).toBe('utility');
    expect(hostModeFromEnv({ MAWS_HARNESS: '1' })).toBe('utility');
  });

  it('honours MAWS_HOST_MODE over every default', () => {
    expect(hostModeFromEnv({ MAWS_HOST_MODE: 'utility' })).toBe('utility');
    expect(hostModeFromEnv({ MAWS_HOST_MODE: 'detached', MAWS_E2E: '1' })).toBe('detached');
    expect(hostModeFromEnv({ MAWS_HOST_MODE: 'detached', MAWS_HARNESS: '1' })).toBe('detached');
  });

  it('ignores a value it does not know and falls back to the default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(hostModeFromEnv({ MAWS_HOST_MODE: 'socket' })).toBe('detached');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(hostModeFromEnv({ MAWS_HOST_MODE: '', MAWS_E2E: '1' })).toBe('utility');
  });

  it('reads the flags as exactly "1"', () => {
    expect(hostModeFromEnv({ MAWS_E2E: '0' })).toBe('detached');
    expect(hostModeFromEnv({ MAWS_HARNESS: 'true' })).toBe('detached');
  });
});
