// The O17 footprint fix (patches/zod@4.6.5.patch): the installed zod's CommonJS entries load its 62 non-English locales
// only when `locales` is read, not with zod, which mawsd and the engine host require (about 0.7 MiB of heap each). Run in
// a child Node so its module cache is zod's alone. e2e/supervisor-packaged.spec.ts runs the same script over the zod the
// packaged app ships.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runZodLocales, zodLocaleProblems } from '../e2e/support/zod-locales';

const ROOT = resolve(__dirname, '..');

describe('zod’s locales, loaded at their first read', () => {
  it('requiring zod and parsing load no non-English locale, the English messages read as before, and a read of locales loads them', () => {
    const result = runZodLocales(process.execPath, process.env, ROOT);
    expect(zodLocaleProblems(result)).toEqual([]);
    expect(result.loaded).toEqual([]);
  });
});
