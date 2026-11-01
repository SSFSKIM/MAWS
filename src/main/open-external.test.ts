import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../test/support/index-fixture';

const opened = vi.hoisted(() => [] as string[]);
vi.mock('electron', () => ({
  shell: {
    openExternal: async (url: string) => {
      if (url.includes('unopenable')) throw new Error('no application knows this URL');
      opened.push(url);
    },
  },
}));

import type { MachineRef } from '@shared/machine/ref';
import { bindLocalMachine } from './machine/local';
import { forwardedElsewhere, openExternalUrl } from './open-external';

describe('openExternalUrl', () => {
  beforeEach(() => {
    opened.length = 0;
    vi.restoreAllMocks();
    vi.stubEnv('MAWS_E2E', undefined);
    vi.stubEnv('MAWS_E2E_OPEN_LOG', undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('opens http, https and mailto links', () => {
    for (const url of ['https://example.com/a', 'http://localhost:8641/x', 'mailto:someone@example.com']) expect(openExternalUrl(url), url).toBe(true);
    expect(opened).toHaveLength(3);
  });

  it('records e2e hand-offs without opening the system browser, keeping scheme checks', async () => {
    const dir = tempDir('maws-open-external-');
    try {
      const log = join(dir.path, 'open.log');
      vi.stubEnv('MAWS_E2E', '1');
      vi.stubEnv('MAWS_E2E_OPEN_LOG', log);
      expect(openExternalUrl('https://example.com/a')).toBe(true);
      expect(openExternalUrl('file:///etc/passwd')).toBe(false);
      expect(opened).toEqual([]);
      await vi.waitFor(() => expect(existsSync(log) ? readFileSync(log, 'utf8') : '').toBe('openExternal https://example.com/a\n'));
    } finally {
      dir.dispose();
    }
  });

  it('uses the real hand-off unless both e2e flags are set', () => {
    vi.stubEnv('MAWS_E2E_OPEN_LOG', '/unused/open.log');
    expect(openExternalUrl('https://example.com/not-e2e')).toBe(true);
    vi.stubEnv('MAWS_E2E', '1');
    vi.stubEnv('MAWS_E2E_OPEN_LOG', undefined);
    expect(openExternalUrl('https://example.com/no-log')).toBe(true);
    expect(opened).toEqual(['https://example.com/not-e2e', 'https://example.com/no-log']);
  });

  it('refuses every other scheme and malformed input, with a log line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'vscode://x', 'not a url']) expect(openExternalUrl(url), url).toBe(false);
    expect(opened).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('logs a failure to open instead of leaving the rejection unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(openExternalUrl('https://unopenable.example/')).toBe(true);
    await vi.waitFor(() => expect(error).toHaveBeenCalledExactlyOnceWith('[open-external] could not open the URL', expect.any(Error)));
  });

  // P5 O7 M3: a loopback link of a session on another machine opens through a forward, never here
  it('tells a loopback link of another machine’s session from one of this Mac’s, and from any other link', () => {
    const local = 'LocalMachineRef0000000' as MachineRef;
    const other = 'OtherMachineRef0000000' as MachineRef;
    bindLocalMachine(local);
    expect(forwardedElsewhere('http://localhost:5173/', other)).toBe(true);
    expect(forwardedElsewhere('http://0.0.0.0:8000/x', other)).toBe(true);
    expect(forwardedElsewhere('http://localhost:5173/', local)).toBe(false);
    expect(forwardedElsewhere('https://example.com:8443/', other)).toBe(false);
    expect(forwardedElsewhere('http://localhost/', other)).toBe(false);
  });
});
