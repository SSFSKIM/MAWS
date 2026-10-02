import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

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
  const accounts = JSON.stringify([{ uuid: 'one', email: 'private@invalid', displayName: 'Private' }, { uuid: 'former' }]);
  writeFileSync(join(source, 'accounts.json'), accounts);
  writeFileSync(join(source, 'pins.json'), JSON.stringify({ drainTarget: null, pins: {} }));
  writeFileSync(join(source, 'history/one.jsonl'), Array.from({ length: 50 }, (_, i) => JSON.stringify({ i })).join('\n'));
  writeFileSync(join(source, 'gateway.json'), '{"port":1234}');
  writeFileSync(join(source, 'history/former.jsonl'), '{"old":true}\n');
  for (const file of ['gateway-requests.jsonl', 'codex-accounts.json', 'codex-pins.local.json', 'history/hand-authored.jsonl']) writeFileSync(join(target, file), 'keep these bytes\n');
  for (let i = 0; i < 2; i++) execFileSync(process.execPath, ['--experimental-strip-types', script, source], { stdio: 'pipe' });
  expect(readFileSync(join(source, 'accounts.json'), 'utf8')).toBe(accounts);
  expect(JSON.parse(readFileSync(join(target, 'accounts.json'), 'utf8'))[0]).toMatchObject({ email: '1@example.test', displayName: 'Account 1' });
  expect(readFileSync(join(target, 'history/one.jsonl'), 'utf8').trim().split('\n')).toHaveLength(40);
  expect(readFileSync(join(target, 'gateway.json'), 'utf8')).toBe('{"port":1234}');
  expect(existsSync(join(target, 'history/former.jsonl'))).toBe(true);
  rmSync(join(source, 'gateway.json'));
  rmSync(join(source, 'history/one.jsonl'));
  rmSync(join(source, 'history/former.jsonl'));
  writeFileSync(join(source, 'accounts.json'), JSON.stringify([{ uuid: 'one' }]));
  for (let i = 0; i < 2; i++) {
    execFileSync(process.execPath, ['--experimental-strip-types', script, source], { stdio: 'pipe' });
    for (const file of ['gateway.json', 'history/one.jsonl', 'history/former.jsonl']) expect(existsSync(join(target, file)), file).toBe(false);
  }
  for (const file of ['gateway-requests.jsonl', 'codex-accounts.json', 'codex-pins.local.json', 'history/hand-authored.jsonl']) {
    expect(existsSync(join(target, file)), file).toBe(true);
    expect(readFileSync(join(target, file), 'utf8')).toBe('keep these bytes\n');
  }
});
