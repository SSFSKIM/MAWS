import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { URL } from 'node:url';
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

test('utility hosts retain only their forwarded lines, even across stream chunks', (t) => {
  const dir = scratch(t);
  const evidence = processEvidence(join(dir, 'output'), join(dir, 'profile'));
  const child = { stdout: new PassThrough(), stderr: new PassThrough() };
  evidence.capture(child);
  child.stdout.write('[engine-');
  child.stdout.write('host] idle: collected in 8 ms\n[pty-host] other\nmain only\n');
  child.stderr.write('[engine-host] host warning\n');
  evidence.finish();
  const host = readdirSync(join(dir, 'output')).find((name) => name.endsWith('.utility.log'));
  assert.ok(host);
  assert.equal(readFileSync(join(dir, 'output', host), 'utf8'), '[engine-host] idle: collected in 8 ms\n[engine-host] host warning\n');
});

test('oversized streams retain bounded startup and shutdown bytes with exact dropped counts, without changing other listeners', (t) => {
  const dir = scratch(t);
  const output = join(dir, 'output');
  const evidence = processEvidence(output, join(dir, 'profile'));
  const child = { stdout: new PassThrough(), stderr: new PassThrough() };
  evidence.capture(child);
  const markers = [];
  for (const name of ['stdout', 'stderr']) {
    const payload = Buffer.from(`[engine-host] ${name} startup\n${'x'.repeat(2 * 1024 * 1024)}\n[engine-host] discarded middle\n${'y'.repeat(2 * 1024 * 1024)}\n[engine-host] ${name} shutdown\n`);
    const seen = createHash('sha256');
    child[name].on('data', (chunk) => seen.update(chunk));
    if (name === 'stdout') child[name].write(payload); // one chunk larger than the whole capture budget
    else for (let offset = 0; offset < payload.length; offset += 33727) child[name].write(payload.subarray(offset, offset + 33727));
    assert.equal(seen.copy().digest('hex'), createHash('sha256').update(payload).digest('hex'));
    const file = join(output, readdirSync(output).find((file) => file.endsWith(`.${name}.log`)));
    assert.ok(statSync(file).size <= 1024 * 1024, `${name} must be bounded before finish, too`);
    assert.ok(readFileSync(file, 'utf8').startsWith(`[engine-host] ${name} startup\n`));
    markers.push({ name, file, payload });
  }
  evidence.finish();
  evidence.finish();
  let expectedUtility = '';
  for (const { name, file, payload } of markers) {
    const bytes = readFileSync(file);
    assert.ok(bytes.length <= 1024 * 1024, `${name} must stay bounded after finish`);
    const marker = /\n\[process-evidence: dropped (\d+) bytes\]\n/.exec(bytes.toString('utf8'));
    assert.ok(marker, 'truncation must be explicit');
    const head = bytes.subarray(0, marker.index);
    const tail = bytes.subarray(marker.index + Buffer.byteLength(marker[0]));
    assert.ok(head.length > 0 && tail.length > 0);
    assert.ok(head.equals(payload.subarray(0, head.length)), 'startup bytes must be unchanged');
    assert.ok(tail.equals(payload.subarray(-tail.length)), 'shutdown bytes must be unchanged');
    assert.equal(Number(marker[1]), payload.length - head.length - tail.length);
    expectedUtility += `[engine-host] ${name} startup\n${marker[0].trim()}\n[engine-host] ${name} shutdown\n`;
    child[name].write('late bytes after finish\n');
    assert.ok(readFileSync(file).equals(bytes));
    assert.equal(child[name].listenerCount('data'), 1);
  }
  const utility = readdirSync(output).find((file) => file.endsWith('.utility.log'));
  assert.equal(readFileSync(join(output, utility), 'utf8'), expectedUtility);
});

test('capture preserves all bytes through the head-to-tail boundary until the combined budget is exceeded', (t) => {
  const dir = scratch(t);
  for (const size of [0, 256 * 1024 - 1, 256 * 1024 + 1, 512 * 1024]) {
    const output = join(dir, String(size));
    const evidence = processEvidence(output, join(dir, 'profile'));
    const child = { stdout: new PassThrough() };
    evidence.capture(child);
    const payload = Buffer.alloc(size, 'é');
    child.stdout.write(payload.subarray(0, 31)); // split UTF-8 bytes, not decoded strings
    child.stdout.write(payload.subarray(31));
    evidence.finish();
    assert.ok(readFileSync(join(output, readdirSync(output)[0])).equals(payload), `${size} bytes must not be truncated or decoded/re-encoded`);
  }
});

test('finishing a noisy detached launch keeps host files and does not invent utility evidence from a long main-only line', (t) => {
  const dir = scratch(t);
  const profile = join(dir, 'profile');
  const output = join(dir, 'output');
  mkdirSync(join(profile, 'supervisor'), { recursive: true });
  writeFileSync(join(profile, 'supervisor', 'host.log'), 'detached host diagnostic\n');
  const evidence = processEvidence(output, profile);
  const child = { stderr: new PassThrough() };
  evidence.capture(child);
  child.stderr.write(Buffer.alloc(4 * 1024 * 1024, 'x')); // no newline: extraction must not retain an unbounded partial line
  child.stderr.write('\nshutdown\n');
  evidence.finish();
  const files = readdirSync(output);
  assert.equal(files.length, 2);
  assert.ok(files.every((file) => statSync(join(output, file)).size <= 1024 * 1024));
  assert.equal(readFileSync(join(output, files.find((file) => file.startsWith('engine-host-'))), 'utf8'), 'detached host diagnostic\n');
});

test('a launch with no detached host writes no pretend host log', (t) => {
  const dir = scratch(t);
  processEvidence(join(dir, 'output'), join(dir, 'missing')).finish();
  assert.deepEqual(readdirSync(join(dir, 'output')), []);
});

test('credentialed groups and local live/owner launches never enable raw process evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/gate.yml', import.meta.url), 'utf8');
  const env = Object.fromEntries(['LIVE_E2E', 'LIVE_GUARD_E2E', 'MAC_SECRET_E2E'].map((key) => [key, new RegExp(`^  ${key}: (.+)$`, 'm').exec(workflow)[1]]));
  const replay = { syntheticEngineBin: '/scratch/replay-engine', env: { MAWS_E2E: '1', MAWS_E2E_ENGINE_BIN: '/scratch/replay-engine' } };
  for (const group of Object.values(env).join(' ').split(/\s+/)) assert.equal(captureAllowed({ ...replay, file: 'ordinary.spec.ts', env: { ...replay.env, ...env, MAWS_E2E_GROUP: group } }), false, group);
  for (const file of ['tools-live.spec.ts', 'document-provisional-live.spec.ts', 'c12-prerun.spec.ts', 'connectors-oauth.spec.ts', 'discover.spec.ts']) assert.equal(captureAllowed({ ...replay, file }), false, file);
  assert.equal(captureAllowed({ ...replay, file: 'ordinary.spec.ts', realEngine: true }), false);
  assert.equal(captureAllowed({ ...replay, file: 'ordinary.spec.ts', ownerConfigHome: true }), false);
  assert.equal(captureAllowed({ ...replay, file: 'ordinary.spec.ts', env: { ...replay.env, MAWS_LIVE_DOCUMENT: '1' } }), false);
  assert.equal(captureAllowed({ ...replay, file: 'machines.spec.ts', env: { ...replay.env, ...env, MAWS_E2E_GROUP: 'machines' } }), true);
  for (const file of ['daemon-idle.spec.ts', 'delivery.spec.ts', 'deliverables.spec.ts']) assert.equal(captureAllowed({ ...replay, file }), true, file);
});

test('c3-stall activated with an installed engine and no realEngine option cannot publish raw evidence', () => {
  assert.equal(captureAllowed({ file: 'c3-stall.spec.ts', env: {
    MAWS_E2E: '1', MAWS_C3_STALL: '1', MAWS_E2E_ENGINE_BIN: '/Users/runner/.local/share/claude/versions/2.1.309',
    MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: '/private/tmp/maws-c3-stall/h4/config',
  } }), false);
});

test('only the chosen test-owned synthetic engine enables evidence, not an unknown override', () => {
  const file = 'ordinary.spec.ts';
  for (const bin of ['/scratch/replay-engine', '/scratch/wrapper', '/usr/local/bin/claude', '']) {
    assert.equal(captureAllowed({ file, env: { MAWS_E2E: '1', MAWS_E2E_ENGINE_BIN: bin } }), false, bin);
  }
  assert.equal(captureAllowed({ file, env: {} }), false);
  const syntheticEngineBin = '/scratch/replay-engine';
  assert.equal(captureAllowed({ file, env: { MAWS_E2E: '1', MAWS_E2E_ENGINE_BIN: syntheticEngineBin }, syntheticEngineBin }), true);
  assert.equal(captureAllowed({ file, env: { MAWS_E2E: '1', MAWS_E2E_ENGINE_BIN: '/some/other-engine' }, syntheticEngineBin }), false);
  for (const group of ['local-latency', 'local-latency-daemon']) {
    const bin = '/scratch/latency-engine'; // writeLatencyEngine's wrapper, not a forwarding wrapper around a real engine
    assert.equal(captureAllowed({ file: 'local-latency.spec.ts', env: { MAWS_E2E: '1', MAWS_E2E_ENGINE_BIN: bin, MAWS_E2E_GROUP: group, MAWS_LOCAL_LATENCY_PERF: '1' }, syntheticEngineBin: bin }), true);
  }
});

test('configured engines take precedence over the replay environment, with bounded fail-closed settings reads', (t) => {
  const userData = scratch(t);
  const options = { file: 'ordinary.spec.ts', userData, syntheticEngineBin: '/scratch/replay-engine', env: { MAWS_E2E: '1', MAWS_E2E_ENGINE_BIN: '/scratch/replay-engine' } };
  assert.equal(captureAllowed(options), true, 'a fresh default replay launch is safe');
  for (const name of ['settings.json', 'machine-settings.json']) {
    const file = join(userData, name);
    writeFileSync(file, JSON.stringify({ engine: { binaryPath: '/installed/claude' } }));
    assert.equal(captureAllowed(options), false, `${name} overrides the replay binary`);
    const wrapper = '/scratch/test-owned-wrapper';
    writeFileSync(file, JSON.stringify({ engine: { binaryPath: wrapper } }));
    assert.equal(captureAllowed(options), false, 'a scratch path alone does not establish ownership');
    assert.equal(captureAllowed({ ...options, syntheticEngineBin: wrapper }), true, 'an explicit owned override names the effective binary, not the fallback');
    for (const text of ['{', 'null', '{"engine":null}', '{"engine":{"binaryPath":42}}', JSON.stringify({ engine: { binaryPath: null }, padding: 'x'.repeat(1024 * 1024) })]) {
      writeFileSync(file, text);
      assert.equal(captureAllowed(options), false, `${name} cannot be safely read`);
    }
    rmSync(file);
    mkdirSync(file); // an unreadable settings file without relying on root-vs-user chmod behavior
    assert.equal(captureAllowed(options), false);
    rmSync(file, { recursive: true });
  }
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ engine: { binaryPath: '/legacy/claude' } }));
  writeFileSync(join(userData, 'machine-settings.json'), JSON.stringify({ engine: { binaryPath: null } }));
  assert.equal(captureAllowed(options), true, 'the machine file is authoritative after the settings split');
  assert.equal(captureAllowed({ ...options, env: { ...options.env, MAWS_E2E: '0' } }), false, 'without e2e mode the environment no longer pins engine selection');
});

test('finish excludes only this launch when effective settings or environment stop naming a known synthetic engine', (t) => {
  const dir = scratch(t);
  const output = join(dir, 'output');
  const reasons = ['real', 'unknown', 'unreadable', 'oversized', 'env'];
  mkdirSync(output);
  const other = join(output, 'another-launch.log');
  writeFileSync(other, 'keep the other launch\n');
  for (const reason of reasons) {
    const userData = join(dir, reason);
    mkdirSync(join(userData, 'supervisor'), { recursive: true });
    writeFileSync(join(userData, 'supervisor', 'host.log'), 'must not publish host data\n');
    const options = { file: 'ordinary.spec.ts', userData, syntheticEngineBin: '/scratch/replay-engine', env: { MAWS_E2E: '1', MAWS_E2E_ENGINE_BIN: '/scratch/replay-engine' } };
    assert.equal(captureAllowed(options), true);
    const evidence = processEvidence(output, userData, () => captureAllowed(options));
    const child = { stdout: new PassThrough(), stderr: new PassThrough() };
    evidence.capture(child);
    child.stdout.write('[engine-host] must not publish utility data\n');
    child.stderr.write('must not publish stderr\n');
    const settings = join(userData, 'machine-settings.json');
    if (reason === 'unreadable') mkdirSync(settings);
    else if (reason === 'oversized') writeFileSync(settings, JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }));
    else if (reason === 'env') options.env.MAWS_E2E_ENGINE_BIN = '/another/engine';
    else writeFileSync(settings, JSON.stringify({ engine: { binaryPath: reason === 'real' ? '/installed/claude' : '/scratch/unknown-wrapper' } }));
    evidence.finish();
    evidence.finish();
    assert.equal(child.stderr.listenerCount('data'), 0);
    const files = readdirSync(output).filter((file) => file !== 'another-launch.log');
    assert.equal(files.length, reasons.indexOf(reason) + 1, 'only one exclusion marker per rejected launch remains');
    assert.ok(files.every((file) => file.endsWith('.excluded.log')));
    for (const file of files) assert.match(readFileSync(join(output, file), 'utf8'), /^Raw process evidence excluded: engine provenance could not be verified\.\n$/);
  }
  assert.equal(readFileSync(other, 'utf8'), 'keep the other launch\n');
});

test('finish keeps unchanged explicit synthetic settings and bounded process/host evidence', (t) => {
  const dir = scratch(t);
  const userData = join(dir, 'profile');
  mkdirSync(join(userData, 'supervisor'), { recursive: true });
  const bin = '/scratch/latency-engine';
  writeFileSync(join(userData, 'machine-settings.json'), JSON.stringify({ engine: { binaryPath: bin } }));
  writeFileSync(join(userData, 'supervisor', 'host.log'), 'host shutdown\n');
  const options = { file: 'local-latency.spec.ts', userData, syntheticEngineBin: bin, env: { MAWS_E2E: '1', MAWS_E2E_ENGINE_BIN: '/scratch/replay-engine' } };
  assert.equal(captureAllowed(options), true);
  const output = join(dir, 'output');
  const evidence = processEvidence(output, userData, () => captureAllowed(options));
  const child = { stdout: new PassThrough() };
  evidence.capture(child);
  child.stdout.write('synthetic startup\n');
  evidence.finish();
  assert.deepEqual(readdirSync(output).map((file) => readFileSync(join(output, file), 'utf8')).sort(), ['host shutdown\n', 'synthetic startup\n']);
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
