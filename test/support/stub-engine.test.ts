// The stub engine as a process (test/support/stub-engine.ts; docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M2):
// bundled and wrapped, it answers --version, plays a fixture over real stdio with the replay transport's rules, and
// honours its directives.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TESTED_ENGINE_VERSION } from '../../src/engine-host/engine-compat';
import { buildStubEngine, writeStubEngine } from './stub-engine-bin';

let dir: string;
let bundle: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-stub-'));
  bundle = buildStubEngine(dir);
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';

describe('the stub engine', () => {
  it('answers --version with the tested version', () => {
    const bin = writeStubEngine(join(dir, 'v'), bundle, { fixture: PERMISSION });
    expect(execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim()).toBe(`${TESTED_ENGINE_VERSION} (Claude Code)`);
  });

  it('plays the fixture\'s handshake over stdio, prints its directives on stderr, and ends with its input', { timeout: 30_000 }, async () => {
    const bin = writeStubEngine(join(dir, 'p'), bundle, { fixture: PERMISSION, printEnv: ['STUB_TEST_VAR'], spawnChild: true, countStdin: true });
    const proc = spawn(bin, ['-p', '--session-id', 'x'], { env: { PATH: '/usr/bin:/bin', STUB_TEST_VAR: 'here' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => (out += String(chunk)));
    proc.stderr.on('data', (chunk) => (err += String(chunk)));
    proc.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'L-1', request: { subtype: 'initialize' } })}\n`);
    for (let i = 0; i < 100 && !out.includes('"L-1"'); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    const answer = out.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; response?: { request_id?: string; subtype?: string } }).find((f) => f.type === 'control_response');
    expect(answer?.response).toMatchObject({ request_id: 'L-1', subtype: 'success' });
    proc.stdin.end();
    const code = await new Promise<number | null>((resolve) => proc.on('exit', (c) => resolve(c)));
    expect(code).toBe(0);
    expect(err).toContain('stub-engine env STUB_TEST_VAR=here');
    expect(err).toMatch(/stub-engine child \d+/);
    expect(err).toContain('stub-engine stdin 1 frames, 0 user');
  });

  // O16 M2b: a scene names each launch's journal after the app has started, under the launch's engine session id
  it('plays the journal its fixture directory holds under the launch\'s --session-id, read at the spawn', { timeout: 30_000 }, async () => {
    const fixtures = join(dir, 'by-id');
    mkdirSync(fixtures, { recursive: true });
    const bin = writeStubEngine(join(dir, 'd'), bundle, { fixture: join(dir, 'no-such-journal.jsonl'), fixtureDir: fixtures });
    copyFileSync(resolve(__dirname, '../..', PERMISSION), join(fixtures, 'abc.jsonl'));
    const proc = spawn(bin, ['-p', '--session-id', 'abc'], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (chunk) => (out += String(chunk)));
    proc.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'L-1', request: { subtype: 'initialize' } })}\n`);
    for (let i = 0; i < 100 && !out.includes('"L-1"'); i += 1) await new Promise((done) => setTimeout(done, 50));
    expect(out).toContain('"L-1"');
    proc.stdin.end();
    expect(await new Promise<number | null>((done) => proc.on('exit', (c) => done(c)))).toBe(0);
  });
});
