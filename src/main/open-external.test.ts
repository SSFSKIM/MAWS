import { beforeEach, describe, expect, it, vi } from 'vitest';

const opened = vi.hoisted(() => [] as string[]);
vi.mock('electron', () => ({
  shell: {
    openExternal: async (url: string) => {
      if (url.includes('unopenable')) throw new Error('no application knows this URL');
      opened.push(url);
    },
  },
}));

import { openExternalUrl } from './open-external';

describe('openExternalUrl', () => {
  beforeEach(() => {
    opened.length = 0;
    vi.restoreAllMocks();
  });

  it('opens http, https and mailto links', () => {
    for (const url of ['https://example.com/a', 'http://localhost:8641/x', 'mailto:someone@example.com']) expect(openExternalUrl(url), url).toBe(true);
    expect(opened).toHaveLength(3);
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
});
