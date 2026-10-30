// spineFilesOpen's Linux branch (P5 O3-D M6 fix round 3 review): a descriptor that closed between the listing and its read
// is skipped, but a read that fails for any other reason is an error, never an empty answer that certifies no spine file is
// open.
import { afterEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ links: new Map<string, string | NodeJS.ErrnoException>(), fds: [] as string[] }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: ((path: string, ...rest: unknown[]) =>
      String(path).startsWith('/proc/') ? fs.fds : (actual.readdirSync as (...args: unknown[]) => unknown)(path, ...rest)) as typeof actual.readdirSync,
    readlinkSync: ((path: string, ...rest: unknown[]) => {
      if (!String(path).startsWith('/proc/')) return (actual.readlinkSync as (...args: unknown[]) => unknown)(path, ...rest);
      const link = fs.links.get(String(path));
      if (link instanceof Error) throw link;
      return link;
    }) as typeof actual.readlinkSync,
  };
});

import { spineFilesOpen } from './spine-files';

const platform = process.platform;
const errno = (code: string) => Object.assign(new Error(code), { code });

describe('spineFilesOpen on Linux', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    fs.links.clear();
    fs.fds = [];
  });

  it('skips a descriptor that vanished between the listing and its read, and keeps an unlinked one', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    fs.fds = ['3', '4'];
    fs.links.set('/proc/7/fd/3', errno('ENOENT'));
    fs.links.set('/proc/7/fd/4', '/p/sessions/a.json (deleted)');
    expect(spineFilesOpen(7, '/p')).toEqual(['/p/sessions/a.json']);
  });

  it('throws on a descriptor read that fails for another reason', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    fs.fds = ['3'];
    fs.links.set('/proc/7/fd/3', errno('EACCES'));
    expect(() => spineFilesOpen(7, '/p')).toThrow('EACCES');
  });
});
