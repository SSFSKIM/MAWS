// The services library's boundary (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §E),
// proven by linting scratch sources at paths the repository's eslint.config.js governs, as test/artifacts/portability.test.ts
// does. Rule A: src/services/ imports nothing from main, mawsd, the renderer or the preload, nor Electron. Rule B:
// nothing under src/main/ but its root imports from src/services/; staying code reads the spine through the view.
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

// Each rule once: main's open-external is refused by O1's pattern and rule A's both.
async function rulesFired(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return [...new Set(result.messages.map((message) => message.ruleId ?? message.message))];
}

const LIBRARY = 'src/services/index/__lint_fixture__.ts';
const LIBRARY_SUITE = 'src/services/index/__lint_fixture__.test.ts';
const CLIENT = 'src/main/browser/__lint_fixture__.ts';
const MACHINE_BOUND_CLIENT = 'src/main/connectors/__lint_fixture__.ts';

describe('rule A: the library imports nothing from main, mawsd, the renderer or the preload, nor Electron', () => {
  it.each(['electron', '../../main/ipc/events', '../../main/windows', '../../mawsd/index', '../../renderer/src/App', '../../preload/index', '../../main/open-external'])('refuses %s, in every import form', async (name) => {
    expect(await rulesFired(`import x from '${name}';\nexport default x;\n`, LIBRARY)).toEqual(['no-restricted-imports']);
    expect(await rulesFired(`import type { X } from '${name}';\nexport type Y = X;\n`, LIBRARY)).toEqual(['no-restricted-imports']);
    expect(await rulesFired(`export * from '${name}';\n`, LIBRARY)).toEqual(['no-restricted-imports']);
  });

  it('refuses a dynamic import of Electron', async () => {
    expect(await rulesFired("export const load = () => import('electron');\n", LIBRARY)).toEqual(['no-restricted-syntax']);
  });

  it("holds the library's suites to it too", async () => {
    expect(await rulesFired("import { emit } from '../../main/ipc/events';\nexport const e = emit;\n", LIBRARY_SUITE)).toEqual(['no-restricted-imports']);
  });

  it('lets the library import itself, src/shared/, the engine host and Node', async () => {
    const code = [
      "import { readFileSync } from 'node:fs';",
      "import type { ServicesBus } from '@shared/spine/bus';",
      "import type { SpineView } from '@shared/spine/view';",
      "import { gitBinary } from '../git/runner';",
      "import { ReplayHost } from '../../engine-host/fs/replay/host';",
      'export type Parts = [ServicesBus, SpineView];',
      'export const parts = [readFileSync, gitBinary, ReplayHost];',
      '',
    ].join('\n');
    expect(await rulesFired(code, LIBRARY)).toEqual([]);
  });
});

describe('rule B: staying code reads the spine only through the view', () => {
  it.each([CLIENT, MACHINE_BOUND_CLIENT])('refuses an import from src/services/ at %s', async (file) => {
    expect(await rulesFired("import { Index } from '../../services/index/index';\nexport const i = Index;\n", file)).toEqual(['no-restricted-imports']);
    expect(await rulesFired("import type { SessionReadModel } from '../../services/sessions/read-model';\nexport type M = SessionReadModel;\n", file)).toEqual(['no-restricted-imports']);
  });

  it('lets staying code read the view', async () => {
    expect(await rulesFired("import type { SpineView } from '@shared/spine/view';\nexport type V = SpineView;\n", CLIENT)).toEqual([]);
  });

  // M4: main's root reaches the library through its one door, the services entry
  it("holds main's root to the services entry", async () => {
    expect(await rulesFired("import { startSpine } from '../services/entry';\nexport const s = startSpine;\n", 'src/main/app.ts')).toEqual([]);
    expect(await rulesFired("import type { SpineData } from '../services/entry';\nexport type D = SpineData;\n", 'src/main/app.ts')).toEqual([]);
    expect(await rulesFired("import { Index } from '../services/index/index';\nexport const i = Index;\n", 'src/main/app.ts')).toEqual(['no-restricted-imports']);
    expect(await rulesFired("import { startSpine } from '../services/spine-root';\nexport const s = startSpine;\n", 'src/main/app.ts')).toEqual(['no-restricted-imports']);
    expect(await rulesFired("import { entry } from '../services/entry/x';\nexport const e = entry;\n", 'src/main/app.ts')).toEqual(['no-restricted-imports']);
    // P5 O5: the entry (index.ts) is not the root, so it reads the library no more than any staying file does
    expect(await rulesFired("import { startSpine } from '../services/entry';\nexport const s = startSpine;\n", 'src/main/index.ts')).toEqual(['no-restricted-imports']);
  });

  it("leaves the client's suites free to import the library", async () => {
    expect(await rulesFired("import { Index } from '../../services/index/index';\nexport const i = Index;\n", 'src/main/browser/__lint_fixture__.test.ts')).toEqual([]);
    expect(await rulesFired("import { Index } from '../../services/index/index';\nexport const i = Index;\n", 'src/main/connectors/__lint_fixture__.test.ts')).toEqual([]);
  });

  it('keeps the no-Electron rule on what stays machine-bound under src/main/', async () => {
    expect(await rulesFired("import { app } from 'electron';\nexport const a = app;\n", MACHINE_BOUND_CLIENT)).toEqual(['no-restricted-imports']);
    expect(await rulesFired("import { app } from 'electron';\nexport const a = app;\n", 'src/main/connectors/legacy-custody.ts')).toEqual([]); // P5 O4 M2 (D20)
  });
});
