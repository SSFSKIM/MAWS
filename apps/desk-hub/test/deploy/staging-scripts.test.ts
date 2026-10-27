// The staging runner (deploy/staging-run.sh, O11 M8): what it hands the desk-web check, and how it hands curl the
// owner's token. Offline: the refusals below come before any token is read or any request made.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const deploy = join(import.meta.dirname, '../../deploy');
const runner = join(deploy, 'staging-run.sh');
const scripts = ['staging-run.sh', 'staging-deploy.sh'].map((name) => ({ name, text: readFileSync(join(deploy, name), 'utf8') }));
const zsh = spawnSync('zsh', ['-c', 'true']).status === 0;

describe('the desk-web step', () => {
  // A Playwright option (--trace=on, --debug, …) would turn recording back on while the browser holds the token.
  // Should the refusal ever go, the step must still not reach the account: no token can be had here (a cloudflared that
  // holds none first on the PATH, an empty secrets directory), so the step stops at its first credential.
  it.skipIf(!zsh)('takes no option to pass on, refused before anything runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'staging-run-'));
    const bin = mkdtempSync(join(tmpdir(), 'staging-run-bin-'));
    writeFileSync(join(bin, 'cloudflared'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DESK_STAGING_DIR: dir, DESK_STAGING_SECRETS: mkdtempSync(join(tmpdir(), 'staging-run-secrets-')) };
    for (const extra of [['--trace=on'], ['--', '--trace', 'on'], ['-c', 'other.config.ts']]) {
      const run = spawnSync('zsh', [runner, 'desk-web', 'x1', ...extra], { encoding: 'utf8', env });
      expect(run.status, extra.join(' ')).toBe(2);
      expect(run.stdout + run.stderr).toMatch(/desk-web takes no option/);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it('runs Playwright with an environment of its own choosing, no Playwright variable passed through', () => {
    const text = scripts[0].text;
    const line = text.split('\n').find((l) => l.includes('playwright test'))!;
    expect(line).toMatch(/env -i /);
    expect(line).not.toMatch(/"\$@"|\$\*/);
  });
});

describe('curl and the owner’s token', () => {
  it('is handed its configuration through a pipe, never a here-string (zsh spools one to a file)', () => {
    for (const { name, text } of scripts) expect(text.includes('<<<'), name).toBe(false);
  });

  it('is bounded in time wherever it is called', () => {
    for (const { name, text } of scripts) {
      for (const line of text.split('\n').filter((l) => /\bcurl\b/.test(l) && !l.trimStart().startsWith('#'))) expect(line, `${name}: ${line.trim()}`).toMatch(/--max-time \d+/);
    }
  });

  // Each curl call as the scripts write it, from `curl` to the end of its command (a pipe, a closing parenthesis).
  const calls = scripts.flatMap(({ name, text }) =>
    text
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .flatMap((l) => [...l.matchAll(/\bcurl\b[^|)]*/g)].map((m) => ({ name, call: m[0].trim() }))),
  );

  it('ignores the user’s curl configuration (~/.curlrc), which could print or keep the token: -q first, everywhere', () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const { name, call } of calls) expect(call, `${name}: ${call}`).toMatch(/^curl -q /);
  });

  it.skipIf(!zsh)('shows nothing of the token when ~/.curlrc asks for verbose output', async () => {
    const [{ call }] = calls.filter(({ call }) => call.includes('-K -'));
    const token = `eyJ${'x'.repeat(24)}.synthetic`;
    const server = createServer((_req, res) => res.end('{"org":{"id":"staging-ssfskim"}}'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const home = mkdtempSync(join(tmpdir(), 'staging-curlrc-'));
    writeFileSync(join(home, '.curlrc'), 'verbose\n');
    try {
      const config = `header = "cf-access-token: ${token}"\nurl = "http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me"\n`;
      const child = spawn('zsh', ['-c', `${call}`], { env: { PATH: process.env.PATH, HOME: home, CURL_HOME: home } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.stdin.end(config);
      const status = await new Promise((resolve) => child.on('close', resolve));
      expect(status, out).toBe(0);
      expect(out).toContain('staging-ssfskim');
      expect(out).not.toContain(token);
    } finally {
      server.close();
    }
  });

  it('a restore whose /api/me read failed is a failed restore, named', () => {
    expect(scripts[0].text).toMatch(/restore check failed: /);
  });
});
