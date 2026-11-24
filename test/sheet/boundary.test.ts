// The question sheet's boundary (the C3 plan's §G; eslint.config.js's SHEET block), proven by linting scratch sources at
// paths the repository's ESLint config governs, as test/services/boundary.test.ts does: the sheet's components and their
// suites reach none of the app's IPC, stores, panel, sessions, lanes or tools, nor Electron or Node, by a static import
// or by `import()`; the transcript's view and the shared sheet stay theirs to import.
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

async function rulesFired(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return [...new Set(result.messages.map((message) => message.ruleId ?? message.message))];
}

const COMPONENT = 'src/renderer/src/sheet/__lint_fixture__.tsx';
const SUPPORT = 'src/renderer/src/sheet/test-support/__lint_fixture__.ts';

describe("the sheet's boundary", () => {
  it.each([
    [COMPONENT, '../stores/sessions'],
    [COMPONENT, '../ipc/client'],
    [COMPONENT, '../tools/sheet/host'],
    [SUPPORT, '../../stores/sessions'],
    [SUPPORT, '../../ipc/client'],
  ])('refuses at %s a static and a dynamic import of %s', async (file, name) => {
    expect(await rulesFired(`import x from '${name}';\nexport default x;\n`, file)).toEqual(['no-restricted-imports']);
    expect(await rulesFired(`export const load = () => import('${name}');\n`, file)).toEqual(['no-restricted-syntax']);
  });

  it.each(['electron', 'node:fs'])('refuses a dynamic import of %s', async (name) => {
    expect(await rulesFired(`export const load = () => import('${name}');\n`, COMPONENT)).toEqual(['no-restricted-syntax']);
  });

  it('lets the sheet import itself, the shared sheet and the transcript’s Markdown, statically and dynamically', async () => {
    const code = [
      "import { SHEET_WORDS } from './copy';",
      "import { sendOf } from '@shared/sheet/words';",
      "import { Markdown } from '../transcript/view/markdown/Markdown';",
      "export const parts = [SHEET_WORDS, sendOf, Markdown];",
      "export const load = () => import('./memory');",
      '',
    ].join('\n');
    expect(await rulesFired(code, COMPONENT)).toEqual([]);
  });
});
