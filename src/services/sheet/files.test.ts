// The inbox's preflight (§C, "Confinement"): only an inbox that is not there counts as absent; one that cannot be looked
// at for any other reason is refused, as a link is. The other failures of `lstat` are not ones a scratch record can
// produce, so `lstat` answers them here.
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const failures = new Map<string, string>();
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    lstat: (path: string) => {
      const code = failures.get(path);
      return code === undefined ? actual.lstat(path) : Promise.reject(Object.assign(new Error(code), { code }));
    },
  };
});
const { isInboxConfined } = await import('./files');

afterEach(() => failures.clear());
const RECORD = '/nowhere/sheet/5eed0000-0000-4000-8000-000000000004';

describe('the inbox preflight', () => {
  it('takes an inbox that is not there', async () => {
    failures.set(join(RECORD, 'inbox.jsonl'), 'ENOENT');
    expect(await isInboxConfined(RECORD)).toBe(true);
  });

  it.each(['EACCES', 'EIO', 'ELOOP', 'ENOTDIR'])('refuses an inbox it cannot look at (%s)', async (code) => {
    failures.set(join(RECORD, 'inbox.jsonl'), code);
    expect(await isInboxConfined(RECORD)).toBe(false);
  });
});
