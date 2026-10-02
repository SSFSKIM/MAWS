/// <reference lib="dom" />
// The scratch builders share a module with Playwright browser-evaluation helpers.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { GitFixture } from './git-fixture';

const cleanups: (() => void)[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

test.each(['panel', 'code'])('%s scratch commits stay out of an inherited GIT_DIR', async (kind) => {
  const foreign = await GitFixture.create();
  cleanups.push(() => foreign.dispose());
  const head = await foreign.git('rev-parse', 'HEAD');
  vi.stubEnv('GIT_DIR', join(foreign.root, '.git'));
  vi.stubEnv('GIT_WORK_TREE', foreign.root);
  for (const key of ['GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CONFIG_COUNT']) vi.stubEnv(key, 'must-not-reach-child');
  vi.resetModules();
  const build = kind === 'panel' ? (await import('../../e2e/support/panel-support')).scratchRepository : (await import('../../e2e/support/code-scratch')).buildCodeScratch;
  const scratch = build();
  cleanups.push(() => scratch.cleanup());
  expect(scratch.git('rev-parse', '--show-toplevel')).toBe(scratch.dir);
  expect(await foreign.git('rev-parse', 'HEAD')).toBe(head);
  expect(await foreign.git('status', '--porcelain')).toBe('');
});

test('refresh retains hand-authored files while redacting owned files', () => {
  const root = mkdtempSync(join(tmpdir(), 'maws-refresh-test-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const target = join(root, 'fixtures/claude-usage');
  const script = join(root, 'support/redact.ts');
  mkdirSync(join(source, 'history'), { recursive: true });
  mkdirSync(join(target, 'history'), { recursive: true });
  mkdirSync(join(root, 'support'));
  copyFileSync(join(import.meta.dirname, 'redact-claude-usage.ts'), script);
  const accounts = JSON.stringify([{ uuid: 'one', email: 'private@invalid', displayName: 'Private' }]);
  writeFileSync(join(source, 'accounts.json'), accounts);
  writeFileSync(join(source, 'pins.json'), JSON.stringify({ drainTarget: null, pins: {} }));
  writeFileSync(join(source, 'history/one.jsonl'), Array.from({ length: 50 }, (_, i) => JSON.stringify({ i })).join('\n'));
  for (const file of ['gateway-requests.jsonl', 'codex-accounts.json', 'codex-pins.local.json', 'history/hand-authored.jsonl']) writeFileSync(join(target, file), 'keep these bytes\n');
  for (let i = 0; i < 2; i++) execFileSync(process.execPath, ['--experimental-strip-types', script, source], { stdio: 'pipe' });
  expect(readFileSync(join(source, 'accounts.json'), 'utf8')).toBe(accounts);
  expect(JSON.parse(readFileSync(join(target, 'accounts.json'), 'utf8'))[0]).toMatchObject({ email: '1@example.test', displayName: 'Account 1' });
  expect(readFileSync(join(target, 'history/one.jsonl'), 'utf8').trim().split('\n')).toHaveLength(40);
  for (const file of ['gateway-requests.jsonl', 'codex-accounts.json', 'codex-pins.local.json', 'history/hand-authored.jsonl']) {
    expect(existsSync(join(target, file)), file).toBe(true);
    expect(readFileSync(join(target, file), 'utf8')).toBe('keep these bytes\n');
  }
});
