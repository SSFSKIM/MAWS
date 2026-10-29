import assert from 'node:assert/strict';
import console from 'node:console';
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

test('serialized S6 notes remove raw and JSON-escaped environment secrets longest-first without damaging JSON', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-live-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const env = {
    AUTH_TOKEN: 'testOnlyCredential',
    QUOTED_PASSWORD: 'testOnlyCredential"with"quotes',
    BACKSLASH_SECRET: 'testOnlyCredential\\with\\slashes',
    TABBED_KEY: 'testOnlyCredential\twith\ttabs',
  };
  const key = ['sk', 'ant', 'testOnlyCredential'].join('-');
  const message = `${Object.values(env).join('; ')}; key ${key}; owner person@company.com; fixture ada@example.test; keep "quotes" and \\path\ttab`;
  const safe = '[REDACTED]; [REDACTED]; [REDACTED]; [REDACTED]; key sk-ant-[REDACTED]; owner owner@redacted.invalid; fixture ada@example.test; keep "quotes" and \\path\ttab';
  assert.equal(createRedactor(env)(message), safe);
  const prefix = 'terminal resume 1: ok; result success ';
  sittingLog(dir, 's6', env)(`${prefix}${JSON.stringify(message)}`);
  const artifact = readFileSync(join(dir, 'live-s6.txt'), 'utf8').trimEnd();
  assert.deepEqual(logged, [`   [s6] ${artifact}`]);
  assert.equal(JSON.parse(artifact.slice(prefix.length)), safe);
  assert.deepEqual(JSON.parse(redactJournal(JSON.stringify({ result: message }), env)), { result: safe });
});

test('serialized S1 notes remove bearer credentials after escaped whitespace while preserving JSON', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-live-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const key = ['sk', 'ant', 'testOnlyCredential'].join('-');
  const separators = ['\t', ' \t ', '\n', '\r', '\f'];
  const results = separators.map((separator) => `authorization: bEaReR${separator}testOnly.BearerValue==; key ${key}; owner person@company.com; fixture ada@example.test`);
  const safe = separators.map((separator) => `authorization: bEaReR${separator}[REDACTED]; key sk-ant-[REDACTED]; owner owner@redacted.invalid; fixture ada@example.test`);
  const prefix = '  ok   the turn ended: ';
  sittingLog(dir, 's1', {})(`${prefix}${JSON.stringify(results)}`);
  const artifact = readFileSync(join(dir, 'live-s1.txt'), 'utf8').trimEnd();
  assert.deepEqual(logged, [`   [s1] ${artifact}`]);
  assert.deepEqual(JSON.parse(artifact.slice(prefix.length)), safe);
  assert.deepEqual(JSON.parse(redactJournal(JSON.stringify({ results }), {})), { results: safe });
});

test('redact before the 300-character stderr cut so a partial environment credential cannot escape', () => {
  const secret = 'testOnlyLongCredential'.repeat(20);
  const safe = redactJournal(`prefix ${secret} trailer`, { AUTH_TOKEN: secret }).slice(0, 300);
  assert.equal(safe, 'prefix [REDACTED] trailer');
});
