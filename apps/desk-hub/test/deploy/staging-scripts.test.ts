// The staging runner (deploy/staging-run.sh, O11 M8): what it hands the desk-web check, and how it hands curl the
// owner's token. Offline: the refusals below come before any token is read or any request made.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

  // The check lists in DESK_STAGING_SCAN what it saw besides the token (the enrollment code, its token, the org key); the
  // runner's search afterwards, run here on its own over a run's files, counts each file holding any of them.
  it.skipIf(!zsh)('counts every file holding the token or anything the check listed, and nothing else', () => {
    const text = scripts[0].text;
    expect(text.split('\n').find((l) => l.includes('playwright test'))).toMatch(/ DESK_STAGING_SCAN=\$SCAN /);
    const search = text.split('\n').find((l) => l.trimStart().startsWith('holding='))!.trim();
    // A run's files: its log, its screenshots directory holding a screenshot and `files`; and the check's list, `scan`.
    const holding = (scan: string, files: Record<string, string>) => {
      const dir = mkdtempSync(join(tmpdir(), 'staging-scan-'));
      const shots = join(dir, 'shots');
      mkdirSync(join(shots, 'playwright'), { recursive: true });
      writeFileSync(join(dir, 'run.log'), 'desk-web check exit 1\n');
      writeFileSync(join(shots, '1-grid-project.png'), 'pixels');
      writeFileSync(join(dir, 'run.scan'), scan);
      for (const [name, body] of Object.entries(files)) writeFileSync(join(shots, name), body);
      const run = spawnSync('zsh', ['-c', `T=eyJtoken.synthetic SCAN=${dir}/run.scan shots=${shots} LOG=${dir}/run.log; ${search}; print -r -- $holding`], { encoding: 'utf8' });
      return run.stdout.trim();
    };
    const listed = 'smns-enroll-v1.code\nonce-token\norg-key\n';
    // An empty line in the list would match every file: none counted here.
    expect(holding(`${listed}\n`, {})).toBe('0');
    expect(holding(listed, { 'playwright/error-context.md': '- text: smns-enroll-v1.code' })).toBe('1');
    expect(holding(listed, { 'a.txt': 'once-token', 'b.txt': 'key org-key', 'c.txt': 'nothing' })).toBe('2');
    expect(holding('', { 'cookie.txt': 'eyJtoken.synthetic' })).toBe('1');
  });

  it('runs Playwright with an environment of its own choosing, no Playwright variable passed through', () => {
    const text = scripts[0].text;
    const line = text.split('\n').find((l) => l.includes('playwright test'))!;
    expect(line).toMatch(/env -i /);
    expect(line).not.toMatch(/"\$@"|\$\*/);
  });
});

describe('the admin step', () => {
  // `staging-run.sh admin <args…>` (O13 M2): `deployment admin` against staging with the admin device's keys, the owner's
  // token on its stdin and nowhere else, its output filtered line by line into the step's log. Stubs stand for
  // cloudflared (a synthetic token) and pnpm (which records what it was given and prints what the command would).
  const token = `eyJ${'s'.repeat(20)}.synthetic`;
  const setup = (keys = true) => {
    const dir = mkdtempSync(join(tmpdir(), 'staging-admin-'));
    const device = join(dir, 'device');
    mkdirSync(device);
    if (keys) writeFileSync(join(device, 'keys.json'), '{}', { mode: 0o600 });
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'cloudflared'), `#!/bin/sh\nprintf '%s' '${token}'\n`, { mode: 0o755 });
    writeFileSync(
      join(bin, 'pnpm'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${dir}/args'\ncat > '${dir}/stdin'\necho 'head version 3, issued 2 days ago'\necho 'a line naming a secret'\necho 'devices listed'\nexit 0\n`,
      { mode: 0o755 },
    );
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DESK_STAGING_DIR: join(dir, 'state'), DESK_STAGING_DEVICE: device, DESK_STAGING_SECRETS: join(dir, 'secrets') };
    return { dir, device, env };
  };

  it.skipIf(!zsh)("runs the command on staging's config with the device's keys, the token on its stdin alone, the log filtered", () => {
    const { dir, device, env } = setup();
    const run = spawnSync('zsh', [runner, 'admin', 'devices'], { encoding: 'utf8', env });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const args = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
    expect(args.slice(args.indexOf('deployment'))).toEqual(['deployment', 'admin', 'devices', '--keys', `${device}/keys.json`, '--config', 'deploy/staging.json']);
    expect(readFileSync(join(dir, 'stdin'), 'utf8')).toBe(`DESK_ACCESS_TOKEN=${token}\n`);
    expect(run.stdout).toContain('head version 3, issued 2 days ago');
    expect(run.stdout).not.toContain('secret');
    const logs = readdirSync(join(dir, 'state')).filter((name) => name.startsWith('admin-'));
    expect(logs).toHaveLength(1);
    const log = readFileSync(join(dir, 'state', logs[0]), 'utf8');
    expect(log).toBe('head version 3, issued 2 days ago\ndevices listed\n');
    expect(run.stdout + run.stderr + log).not.toContain(token);
  });

  it.skipIf(!zsh)('names the deployment and the keys itself: no option that would name others, no init, no keys, nothing run', () => {
    for (const extra of [['--hub', 'http://127.0.0.1:8747'], ['--user=owner@example.com'], ['--yes'], ['--config', 'deploy/config.json'], ['--keys', '/elsewhere/keys.json']]) {
      const { dir, env } = setup();
      const run = spawnSync('zsh', [runner, 'admin', 'pair', '--class', 'web-cards', ...extra], { encoding: 'utf8', env });
      expect(run.status, extra.join(' ')).toBe(2);
      expect(run.stdout, extra.join(' ')).toMatch(/admin takes no --(hub|user|yes|config|keys)/);
      expect(readdirSync(dir)).not.toContain('args');
    }
    const init = setup();
    const refused = spawnSync('zsh', [runner, 'admin', 'init'], { encoding: 'utf8', env: init.env });
    expect([refused.status, refused.stdout]).toEqual([2, expect.stringMatching(/run admin adopt: stop/)]);
    const none = setup(false);
    const missing = spawnSync('zsh', [runner, 'admin', 'devices'], { encoding: 'utf8', env: none.env });
    expect([missing.status, missing.stdout]).toEqual([2, expect.stringMatching(/no admin device keys at .*keys\.json/)]);
    expect(readdirSync(none.dir)).not.toContain('args');
  });

  it('filters line by line, so what a step asks about at /dev/tty is shown before the question', () => {
    expect(scripts[0].text).toMatch(/^filter\(\) \{ perl -ne 'BEGIN \{ \$\| = 1 \} /m);
  });
});

describe('the staging deploy', () => {
  // `staging-deploy.sh` (O13 M4): the web build carries the label the deploy names with `--web`, as VITE_DESK_WEB_BUILD,
  // so the phone's channel handshake says which build it runs (`h1.build`, `desk-web/<label>`). Run from a copy in a
  // throwaway git checkout, with stubs for pnpm (recording the label it builds with and the deploy's arguments), curl and
  // sleep, and a synthetic secrets directory: nothing reaches staging.
  it.skipIf(!zsh)('builds desk-web with VITE_DESK_WEB_BUILD set to the --web label', () => {
    const root = mkdtempSync(join(tmpdir(), 'staging-deploy-'));
    const [bin, secrets, state, dir] = ['bin', 'secrets', 'state', 'maws'].map((name) => join(root, name));
    for (const d of [bin, secrets, join(dir, 'apps/desk-hub/deploy')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(secrets, 'CF_ACCESS_SETUP_TOKEN'), 'setup-SYNTHETIC\n');
    writeFileSync(join(secrets, 'CF_DESK_HUB_SERVICE_TOKENS'), 'service-SYNTHETIC\n');
    writeFileSync(
      join(bin, 'pnpm'),
      `#!/bin/sh
case "$*" in
  *"desk-web build"*) printf '%s\\n' "$VITE_DESK_WEB_BUILD" > '${root}/label'; mkdir -p apps/desk-web/dist && echo built > apps/desk-web/dist/index.html ;;
  *"deployment deploy"*) printf '%s\\n' "$@" > '${root}/deploy-args'; cat > /dev/null; echo 'wrangler target desk-hub-staging (config worker desk-hub-staging, account a): deploy' ;;
esac
exit 0
`,
      { mode: 0o755 },
    );
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    for (const name of ['staging-deploy.sh', 'staging.json']) writeFileSync(join(dir, 'apps/desk-hub/deploy', name), readFileSync(join(deploy, name)));
    writeFileSync(join(dir, '.gitignore'), 'apps/desk-web/dist/\n');
    const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
    for (const args of [['init', '-q', '-b', 'o13-m4'], ['add', '-A'], ['commit', '-q', '-m', 'one']]) expect(git(...args).status).toBe(0);
    const head = git('rev-parse', '--short=8', 'HEAD').stdout.trim();
    const run = spawnSync('zsh', [join(dir, 'apps/desk-hub/deploy/staging-deploy.sh')], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, LANG: 'C', DESK_STAGING_SECRETS: secrets, DESK_STAGING_DIR: state },
    });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const label = `o13-m4.${head}`;
    expect(readFileSync(join(root, 'label'), 'utf8').trim()).toBe(label);
    const args = readFileSync(join(root, 'deploy-args'), 'utf8').trim().split('\n');
    expect(args[args.indexOf('--web') + 1]).toBe(label);
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
