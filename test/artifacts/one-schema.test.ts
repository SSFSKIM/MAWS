// Schema parity's lint half (D4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the document's schema is
// built only in src/artifacts/document/schema.ts, proven by linting scratch sources at paths the repository's
// eslint.config.js governs, and held on the production source by linting every file of src/ that could trip it; the
// composer's own Tiptap schema stays outside the rule.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

async function rulesFired(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.map((message) => message.ruleId ?? message.message);
}

const SECOND_SCHEMA = [
  "import { getSchema } from '@tiptap/core';\nexport const schema = getSchema([]);\n",
  "import { Mark } from '@tiptap/core';\nexport const Note = Mark.create({ name: 'note' });\n",
  "import { Node } from '@tiptap/core';\nexport const Box = Node.create({ name: 'box' });\n",
];

describe('the one-schema rule', () => {
  it.each([
    'src/artifacts/document/__lint_fixture__.ts',
    'src/artifacts/document/editor/__lint_fixture__.tsx',
    'src/engine-host/tool-server/__lint_fixture__.ts',
    'src/renderer/src/tools/document/__lint_fixture__.tsx',
  ])('refuses a schema, a mark or a node built at %s', async (file) => {
    for (const code of SECOND_SCHEMA) expect(await rulesFired(code, file)).toEqual(['maws-schema/one-schema']);
  });

  it('leaves the schema module and the composer\'s own schema alone', async () => {
    for (const file of ['src/artifacts/document/schema.ts', 'src/renderer/src/composer/editor/__lint_fixture__.ts']) {
      for (const code of SECOND_SCHEMA) expect(await rulesFired(code, file)).toEqual([]);
    }
  });

  it('keeps the rules it sits beside: a dynamic Yjs import outside the binding module still fails', async () => {
    const fired = await rulesFired(
      "import { Mark } from '@tiptap/core';\nexport const Note = Mark.create({ name: 'note' });\nexport const y = () => import('@y/y');\n",
      'src/renderer/src/tools/document/__lint_fixture__.ts',
    );
    expect(fired.sort()).toEqual(['maws-schema/one-schema', 'no-restricted-syntax']);
  });
});

// Every source file the rule could fire on (a call it matches is textually one of these), linted through the
// repository config: production source holds the rule whatever `pnpm lint` is run on.
const CANDIDATE = /\b(?:getSchema|(?:Mark|Node)\s*\.\s*create)\s*\(/;
function candidates(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return candidates(path);
    return /\.tsx?$/.test(entry.name) && CANDIDATE.test(readFileSync(path, 'utf8')) ? [path] : [];
  });
}

describe('the one-schema rule on src/', () => {
  it('holds on every file of src/ (the schema module and the composer the only builders)', async () => {
    const files = candidates(resolve(ROOT, 'src'));
    expect(files.map((file) => relative(ROOT, file))).toContain('src/artifacts/document/schema.ts');
    const results = await eslint.lintFiles(files);
    const fired = results.flatMap((result) =>
      result.messages.filter((message) => message.ruleId === 'maws-schema/one-schema').map((message) => `${relative(ROOT, result.filePath)}:${message.line}`),
    );
    expect(fired).toEqual([]);
  });
});
