import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRedactor, redactJournal, sittingLog } from '../test/live/support/public-evidence.mjs';

test('sitting logs redact bearer credentials, provider keys and account emails in both the artifact and console', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-live-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const key = ['sk', 'ant', 'testOnlyCredential'].join('-');
  const bearer = ['testOnly', 'BearerValue'].join('.');
  const line = `stderr: Authorization: Bearer ${bearer}; key ${key}; owner at person@company.com`;
  sittingLog(dir, 's6', {})(line);
  const safe = 'stderr: Authorization: Bearer [REDACTED]; key sk-ant-[REDACTED]; owner at owner@redacted.invalid';
  assert.equal(readFileSync(join(dir, 'live-s6.txt'), 'utf8'), `${safe}\n`);
  assert.deepEqual(logged, [`   [s6] ${safe}`]);
});

test('the same export redactor preserves JSON syntax and fixture emails while removing known environment secrets', () => {
  const secret = 'testOnlyPasswordValue';
  const input = JSON.stringify({ stderr: 'authorization: bearer testOnlyCredential==', message: secret, fixture: 'ada@example.test' });
  assert.deepEqual(JSON.parse(redactJournal(input, { API_PASSWORD: secret })), { stderr: 'authorization: bearer [REDACTED]', message: '[REDACTED]', fixture: 'ada@example.test' });
  assert.equal(createRedactor({ TOKEN: 'short' })('unchanged short'), 'unchanged short');
});

test('redact before the 300-character stderr cut so a partial environment credential cannot escape', () => {
  const secret = 'testOnlyLongCredential'.repeat(20);
  const safe = redactJournal(`prefix ${secret} trailer`, { AUTH_TOKEN: secret }).slice(0, 300);
  assert.equal(safe, 'prefix [REDACTED] trailer');
});
