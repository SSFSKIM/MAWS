// The stub engine as a process (test/support/stub-engine.ts; docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M2):
// bundled and wrapped, it answers --version, plays a fixture over real stdio with the replay transport's rules, and
// honours its directives.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
