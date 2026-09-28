import { beforeEach, describe, expect, it, vi } from 'vitest';

const opened = vi.hoisted(() => [] as string[]);
vi.mock('electron', () => ({ shell: { openExternal: async (url: string) => void opened.push(url) } }));

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
});
