import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureAllowed, processEvidence, writeTimingEvidence } from '../e2e/support/process-evidence.mjs';

const scratch = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-process-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('captures both streams for each launch without taking bytes from another listener; finish removes only its listeners', async (t) => {
  const dir = scratch(t);
  const first = processEvidence(join(dir, 'output'), join(dir, 'profile'));
  const second = processEvidence(join(dir, 'output'), join(dir, 'profile'));
  const child = spawn(process.execPath, ['-e', "process.stdout.write('hello\\n'); process.stderr.write('quit sentinel\\n')"]);
  let seen = '';
  child.stderr.on('data', (chunk) => { seen += chunk; });
  first.capture(child);
  second.capture(child);
  await once(child, 'close');
  first.finish();
  second.finish();
  first.finish(); // teardown after an early close is harmless
  const files = readdirSync(join(dir, 'output'));
  assert.equal(files.length, 4);
  assert.equal(seen, 'quit sentinel\n');
  for (const name of files) assert.equal(readFileSync(join(dir, 'output', name), 'utf8'), name.endsWith('.stdout.log') ? 'hello\n' : seen);
  assert.equal(child.stderr.listenerCount('data'), 1);
});

test('copies host generations before profile deletion, including a failed launch with no child', (t) => {
  const dir = scratch(t);
  const profile = join(dir, 'profile');
  mkdirSync(join(profile, 'supervisor'), { recursive: true });
  writeFileSync(join(profile, 'supervisor', 'host.log'), 'idle: collected in 13 ms\n');
  writeFileSync(join(profile, 'supervisor', 'host.log.1'), 'older host\n');
  writeFileSync(join(profile, 'supervisor', 'host.lock'), 'not evidence');
  const evidence = processEvidence(join(dir, 'output'), profile);
  evidence.finish();
  rmSync(profile, { recursive: true });
  const files = readdirSync(join(dir, 'output'));
  assert.equal(files.length, 2);
  assert.ok(files.every((name) => /^engine-host-.*(?:\.previous)?\.log$/.test(name)));
  assert.deepEqual(files.map((name) => readFileSync(join(dir, 'output', name), 'utf8')).sort(), ['idle: collected in 13 ms\n', 'older host\n']);
});

test('utility hosts retain only their forwarded lines, even across stream chunks', async (t) => {
  const dir = scratch(t);
  const evidence = processEvidence(join(dir, 'output'), join(dir, 'profile'));
  const child = spawn(process.execPath, ['-e', "process.stdout.write('[engine-'); process.stdout.write('host] idle: collected in 8 ms\\n[pty-host] other\\nmain only\\n'); process.stderr.write('[engine-host] host warning\\n')"]);
  evidence.capture(child);
  await once(child, 'close');
  evidence.finish();
  const host = readdirSync(join(dir, 'output')).find((name) => name.endsWith('.utility.log'));
  assert.ok(host);
  assert.equal(readFileSync(join(dir, 'output', host), 'utf8'), '[engine-host] idle: collected in 8 ms\n[engine-host] host warning\n');
});

test('a launch with no detached host writes no pretend host log', (t) => {
  const dir = scratch(t);
  processEvidence(join(dir, 'output'), join(dir, 'missing')).finish();
  assert.deepEqual(readdirSync(join(dir, 'output')), []);
});

test('credentialed groups and local live/owner launches never enable raw process evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/gate.yml', import.meta.url), 'utf8');
  const env = Object.fromEntries(['LIVE_E2E', 'LIVE_GUARD_E2E', 'MAC_SECRET_E2E'].map((key) => [key, new RegExp(`^  ${key}: (.+)$`, 'm').exec(workflow)[1]]));
  for (const group of Object.values(env).join(' ').split(/\s+/)) assert.equal(captureAllowed({ file: 'ordinary.spec.ts', env: { ...env, MAWS_E2E_GROUP: group } }), false, group);
  for (const file of ['tools-live.spec.ts', 'document-provisional-live.spec.ts', 'c12-prerun.spec.ts', 'connectors-oauth.spec.ts', 'discover.spec.ts']) assert.equal(captureAllowed({ file, env: {} }), false, file);
  assert.equal(captureAllowed({ file: 'ordinary.spec.ts', env: {}, realEngine: true }), false);
  assert.equal(captureAllowed({ file: 'ordinary.spec.ts', env: {}, ownerConfigHome: true }), false);
  assert.equal(captureAllowed({ file: 'ordinary.spec.ts', env: { MAWS_LIVE_DOCUMENT: '1' } }), false);
  assert.equal(captureAllowed({ file: 'machines.spec.ts', env: { ...env, MAWS_E2E_GROUP: 'machines' } }), true);
  assert.equal(captureAllowed({ file: 'daemon-idle.spec.ts', env: {} }), true);
});

test('timing evidence persists partial samples without copying tool arguments or results', (t) => {
  const dir = scratch(t);
  const file = join(dir, 'test-results', 'tool-time-heavy-live', 'timings.json');
  writeTimingEvidence(file, [{ name: 'artifact_read', ms: 15, startedAt: 'start', answeredAt: 'end', requestSeq: 1, responseSeq: 2, toolUseId: 'tool', args: { secret: 'do not publish' } }], [{ name: 'artifact_edit', requestSeq: 3, startedAt: 'later', secret: 'do not publish' }], [0.1, 0.2, 0.3]);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    spans: [{ name: 'artifact_read', ms: 15, startedAt: 'start', answeredAt: 'end', requestSeq: 1, responseSeq: 2, toolUseId: 'tool' }],
    unanswered: [{ name: 'artifact_edit', requestSeq: 3, startedAt: 'later', toolUseId: null }],
    loadavg: [0.1, 0.2, 0.3],
  });
  assert.ok(existsSync(file));
});
