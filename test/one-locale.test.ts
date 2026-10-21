// English throughout's lint half (P4 Decision Log 4): an age, date or time is written only by src/shared/app/date-format.ts
// in its one display locale, so a formatter built elsewhere is refused in MAWS's src/ and in the desk's web app, which
// writes its counts through the module too and so is refused a number's toLocaleString and an Intl.NumberFormat as
// well; proven by linting scratch sources at paths the repository's eslint.config.js governs.
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

async function rulesFired(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.map((message) => message.ruleId ?? message.message);
}

const DATES = [
  "export const t = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });\n",
  'export const d = (iso: string) => new Date(iso).toLocaleDateString();\n',
  "export const f = new Intl.DateTimeFormat(undefined, { month: 'short' });\n",
  'export const r = new Intl.RelativeTimeFormat();\n',
];
const COUNTS = [
  'export const n = (count: number) => count.toLocaleString();\n',
  "export const c = new Intl.NumberFormat('en-US', { notation: 'compact' });\n",
];
const DESK = 'apps/desk-web/src/views/__lint_fixture__.tsx';
const RENDERER = 'src/renderer/src/__lint_fixture__.ts';

describe('the one-locale rule', () => {
  it.each([RENDERER, DESK, 'apps/desk-web/src/depth/view/__lint_fixture__.ts'])('refuses a date formatter of its own at %s', async (file) => {
    for (const code of DATES) expect(await rulesFired(code, file)).toEqual(['maws-dates/one-locale']);
  });

  it("refuses the desk's own counts too; MAWS's src/ still writes its counts in an explicit locale", async () => {
    for (const code of COUNTS) {
      expect(await rulesFired(code, DESK)).toEqual(['maws-dates/one-locale']);
      expect(await rulesFired(code, RENDERER)).toEqual([]);
    }
  });

  it('leaves the module itself and the suites alone', async () => {
    for (const file of ['src/shared/app/date-format.ts', 'apps/desk-web/src/views/__lint_fixture__.test.tsx', 'src/renderer/src/__lint_fixture__.test.ts']) {
      for (const code of [...DATES, ...COUNTS]) expect(await rulesFired(code, file)).toEqual([]);
    }
  });
});
