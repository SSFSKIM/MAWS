// The staging runner (deploy/staging-run.sh, O11 M8): what it hands the desk-web check, and how it hands curl the
// owner's token. Offline: the refusals below come before any token is read or any request made.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64urlEncode, encodeProvisioningCodeV2, generateSigningKey, type ProvisioningCodeV2 } from 'org-protocol';
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
      [
        '#!/bin/sh',
        `printf '%s\\n' "$@" > '${dir}/args'`,
        `cat > '${dir}/stdin'`,
        "echo 'head version 3, issued 2 days ago'",
        "echo 'a line naming a secret'",
        "echo 'devices listed'",
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    // The secret-stream mode's launcher (O14 M2): its directory and arguments, the token it found in its environment,
    // its stdin copied to its stdout.
    writeFileSync(
      join(bin, 'node'),
      `#!/bin/sh\nprintf '%s\\n' "$(pwd)" "$@" > '${dir}/node-args'\nprintf '%s' "\${DESK_ACCESS_TOKEN-unset}" > '${dir}/env'\ntee '${dir}/stdin'\necho 'head version 3, issued 2 days ago' >&2\necho 'a line naming a secret' >&2\nexit 0\n`,
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
    expect(args.slice(args.indexOf('deployment'))).toEqual(['deployment', 'admin', '--config', 'deploy/staging.json', '--keys', `${device}/keys.json`, 'devices']);
    expect(readFileSync(join(dir, 'stdin'), 'utf8')).toBe(`DESK_ACCESS_TOKEN=${token}\n`);
    expect(run.stdout).toContain('head version 3, issued 2 days ago');
    expect(run.stdout).not.toContain('secret');
    const logs = readdirSync(join(dir, 'state')).filter((name) => name.startsWith('admin-'));
    expect(logs).toHaveLength(1);
    const log = readFileSync(join(dir, 'state', logs[0]), 'utf8');
    expect(log).toBe('head version 3, issued 2 days ago\ndevices listed\n');
    expect(run.stdout + run.stderr + log).not.toContain(token);
  });

  // The step's own options go after the command word and before the owner's arguments, so a device id after `--` (a
  // base64url id starts with '-' about one time in 64) stays the last positional, and today's forms parse as before.
  it.skipIf(!zsh)("hands the owner's arguments on last and whole: an id after `--`, and a verb with none", () => {
    for (const args of [['root', 'add', '--', '-Dash-led_id'], ['remove-device', '--', '-Dash-led_id'], ['show']]) {
      const { dir, device, env } = setup();
      const run = spawnSync('zsh', [runner, 'admin', ...args], { encoding: 'utf8', env });
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const given = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
      expect(given.slice(given.indexOf('deployment')), args.join(' ')).toEqual(['deployment', 'admin', '--config', 'deploy/staging.json', '--keys', `${device}/keys.json`, ...args]);
    }
  });

  // Another verb through the same helper: the deployment after its command word, then the step's options and the
  // owner's. A `--config` of the owner's reaches the command beside the step's, and the command refuses two (deployArgs:
  // `name one deployment`), so neither wins.
  it.skipIf(!zsh)('relay-measure reaches its command with the deployment after the command word', () => {
    const { dir, device, env } = setup();
    const run = spawnSync('zsh', [runner, 'relay-measure', '--rounds', '3'], { encoding: 'utf8', env });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const given = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
    expect(given.slice(given.indexOf('deployment'))).toEqual(['deployment', 'relay-measure', '--config', 'deploy/staging.json', '--device-keys', `${device}/keys.json`, '--rounds', '3']);
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

  it.skipIf(!zsh)('admin --pipe: the token in the environment, stdin and stdout byte for byte, stderr alone filtered and logged; other verbs refused', () => {
    const input = 'smns-provision-v1.eyJodWIiOiJ4In0\nno newline at the end';
    const create = ['delegation', 'create', '--label', 'devcloud', '--prefix', 'dc-', '--code-to-stdout'];
    const { dir, device, env } = setup();
    const run = spawnSync('zsh', [runner, 'admin', '--pipe', ...create], { encoding: 'utf8', env: env, input });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe(input);
    expect(readFileSync(join(dir, 'stdin'), 'utf8')).toBe(input);
    expect(readFileSync(join(dir, 'env'), 'utf8')).toBe(token);
    expect(readdirSync(dir)).not.toContain('args');
    const args = readFileSync(join(dir, 'node-args'), 'utf8').trim().split('\n');
    expect(args[0]).toMatch(/\/apps\/desk-hub$/);
    expect(args.slice(args.indexOf('deploy/bin.ts'))).toEqual(['deploy/bin.ts', 'admin', '--config', 'deploy/staging.json', '--keys', `${device}/keys.json`, ...create]);
    expect(run.stderr).toContain('head version 3, issued 2 days ago');
    expect(run.stderr).not.toContain('secret');
    const logs = readdirSync(join(dir, 'state')).filter((name) => name.startsWith('admin-delegation-pipe-'));
    expect(logs).toHaveLength(1);
    expect(readFileSync(join(dir, 'state', logs[0]), 'utf8')).toBe('head version 3, issued 2 days ago\n');
    expect(run.stdout + run.stderr + readFileSync(join(dir, 'state', logs[0]), 'utf8')).not.toContain(token);

    for (const refused of [['--pipe', 'devices'], ['--pipe', 'pair', '--class', 'web-cards'], create, ['code', 'strip-legacy']]) {
      const other = setup();
      const r = spawnSync('zsh', [runner, 'admin', ...refused], { encoding: 'utf8', env: other.env, input });
      expect(r.status, refused.join(' ')).toBe(2);
      expect(r.stdout + r.stderr, refused.join(' ')).toMatch(/admin --pipe is for delegation create and code strip-legacy alone|writes a secret code to stdout/);
      expect(readdirSync(other.dir), refused.join(' ')).not.toContain('args');
      expect(readdirSync(other.dir), refused.join(' ')).not.toContain('node-args');
    }
  });

  it('filters line by line, so what a step asks about at /dev/tty is shown before the question', () => {
    expect(scripts[0].text).toMatch(/^filter\(\) \{ perl -ne 'BEGIN \{ \$\| = 1 \} /m);
  });
});

/** A provisioning code with a `legacy` field, and the same code without it: what strip-legacy turns one into. */
async function sampleCode(): Promise<{ text: string; stripped: string }> {
  const key = await generateSigningKey(true);
  const jwk = (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey;
  const code: ProvisioningCodeV2 = {
    hub: 'https://desk-hub.example',
    org: 'org-x',
    roots: [base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))],
    recoveryPub: (await generateSigningKey()).pub,
    token: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))),
    delegation: { id: 'a'.repeat(32), prefix: 'dc-', privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } },
  };
  return { text: encodeProvisioningCodeV2({ ...code, legacy: { org: 'org-x', key: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) } }), stripped: encodeProvisioningCodeV2(code) };
}

/**
 * The runner as it is in this checkout, with its real launcher, for `admin --pipe code strip-legacy`: a local transform
 * that reads no credential and reaches no deployment (a cloudflared that fails, first on PATH, records any call).
 * stdout is the secret stream, so it must hold the command's own stdout and nothing else, on success and on refusal.
 */
async function realStripLegacy(script: string, env: (dir: string) => Record<string, string>) {
  const scratchDir = mkdtempSync(join(tmpdir(), 'pipe-real-'));
  const bin = join(scratchDir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cloudflared'), `#!/bin/sh\necho called >> '${scratchDir}/cloudflared'\nexit 1\n`, { mode: 0o755 });
  const run = (input: string) => spawnSync('zsh', [script, 'admin', '--pipe', 'code', 'strip-legacy'], { encoding: 'utf8', input, timeout: 120_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env(scratchDir) } });
  const { text, stripped } = await sampleCode();
  return { good: run(`${text}\n`), bad: run('not a code\n'), stripped, called: () => existsSync(join(scratchDir, 'cloudflared')) };
}

describe.skipIf(!zsh)('admin --pipe with the real launcher', () => {
  it('puts nothing but the command\'s own stdout on the stream: the stripped code, or nothing at all on a refusal', async () => {
    const { good, bad, stripped, called } = await realStripLegacy(runner, (dir) => ({ DESK_STAGING_DIR: join(dir, 'state'), DESK_STAGING_DEVICE: join(dir, 'device'), DESK_STAGING_SECRETS: join(dir, 'secrets') }));
    expect(good.status, good.stderr).toBe(0);
    expect(good.stdout).toBe(`${stripped}\n`);
    expect(bad.status, bad.stderr).toBe(1);
    expect(bad.stdout).toBe('');
    expect(bad.stderr).toMatch(/admin: stdin: provisioning code: not smns-provision-v2/);
    expect(called()).toBe(false);
  }, 240_000);
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

describe('the phone step', () => {
  // `staging-run.sh phone <n>` (P5 O13 M7): the live suite with the owner's token in its environment alone, its sink
  // behind a quick tunnel tried three times, then its cleanup pass, production's build compared and the log scanned for
  // the token. Stubs stand for cloudflared (a synthetic token; a tunnel that fails, or comes up), curl (production's
  // build header) and pnpm (recording each run's arguments and environment, and printing a line holding the token).
  const token = `eyJ${'p'.repeat(20)}.synthetic`;
  // `api`: cloudflared's own request for a quick tunnel fails, the runner's to the quick-tunnel API answers, and
  // cloudflared runs on the credentials it wrote (the stub records the file's mode and whether it holds the secret).
  const apiSecret = `qt${'s'.repeat(24)}.synthetic`; // low-entropy, assembled here: no committed line reads as a key
  const setup = (tunnel: 'fails' | 'up' | 'api', anchor = true, leak = false, hang = false) => {
    const dir = mkdtempSync(join(tmpdir(), 'staging-phone-'));
    const device = join(dir, 'device');
    mkdirSync(device);
    writeFileSync(join(device, 'keys.json'), '{}', { mode: 0o600 });
    if (anchor) writeFileSync(join(device, 'keys.json.org.json'), '{}', { mode: 0o600 });
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const up = "echo 'INF |  https://quick-test-1.trycloudflare.com  |'; echo 'INF Registered tunnel connection'; exec sleep 30";
    writeFileSync(
      join(bin, 'cloudflared'),
      [
        '#!/bin/sh',
        `if [ "$1" = access ]; then printf '%s' '${token}'; exit 0; fi`,
        `case " $* " in *' --credentials-file '*) f=$(printf '%s\\n' "$@" | sed -n '/^--credentials-file$/{n;p;}'); echo api >> '${dir}/tunnels'; python3 -I -c 'import os, sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])' "$f" > '${dir}/creds-mode'; grep -c '${apiSecret}' "$f" > '${dir}/creds-secret'; echo 'INF Registered tunnel connection'; exec sleep 30;; esac`,
        `echo try >> '${dir}/tunnels'`,
        tunnel === 'up' ? up : "echo 'ERR failed to request quick Tunnel'; exit 1",
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const answer = JSON.stringify({ success: true, result: { id: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'qt-x', hostname: 'spike-host-one.trycloudflare.com', account_tag: 'acct0123', secret: apiSecret } });
    writeFileSync(
      join(bin, 'curl'),
      `#!/bin/sh\ncase "$*" in *api.trycloudflare.com/tunnel*) ${tunnel === 'api' ? `printf '%s' '${answer}'` : "printf 'upstream request timeout'"}; exit 0;; esac\ncat > /dev/null\nprintf 'X-Desk-Build: hub@0123abcd web@master.0123abcd\\r\\n'\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, 'pnpm'),
      [
        '#!/bin/sh',
        `n=$(ls '${dir}' | grep -c '^run-.*-args$')`,
        `printf '%s\\n' "$@" > '${dir}/run-'$n'-args'`,
        `env | grep '^DESK_' | sort > '${dir}/run-'$n'-env'`,
        // The suite that hangs: its process stays until a signal reaches it (a run's endpoint waiting on staging).
        ...(hang ? [`[ "$DESK_STAGING_PHONE" = 1 ] && { echo $$ > '${dir}/hung.pid'; exec sleep 40; }`] : []),
        'echo "PASS registration"',
        'echo "a line holding $DESK_ACCESS_TOKEN"',
        // A secret the run handled, listed for the search, which the run (here) also printed.
        ...(leak ? ['[ -n "$DESK_STAGING_PHONE_SCAN" ] && echo smns-pair-v1.synthetic >> "$DESK_STAGING_PHONE_SCAN" && echo "code smns-pair-v1.synthetic"'] : []),
        'echo "cleanup: nothing of the run is current"',
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DESK_STAGING_DIR: join(dir, 'state'), DESK_STAGING_DEVICE: device, DESK_STAGING_SECRETS: join(dir, 'secrets') };
    return { dir, device, env };
  };
  const envOf = (dir: string, run: number) => Object.fromEntries(readFileSync(join(dir, `run-${run}-env`), 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

  it.skipIf(!zsh)('refuses a bad run id, an option it does not take and a missing anchor before reading a token', () => {
    for (const [args, why, anchor] of [
      [['phone', 'A/1'], /bad run id/, true],
      [['phone', '1', '--trace'], /phone takes --rehearse, --lane-b and --device <id>/, true],
      [['phone', '1', '--device', 'a b'], /--device <the phone's device id>/, true],
      [['phone', '1'], /no admin device keys and anchor/, false],
    ] as const) {
      const { dir, env } = setup('fails', anchor);
      const run = spawnSync('zsh', [runner, ...args], { encoding: 'utf8', env });
      expect(run.status, args.join(' ')).toBe(2);
      expect(run.stdout + run.stderr, args.join(' ')).toMatch(why);
      expect(existsSync(join(dir, 'tunnels')) || existsSync(join(dir, 'run-0-args'))).toBe(false);
    }
  });

  it.skipIf(!zsh)('runs the suite with the token in its environment alone, says NOT SHOWN’s reason after three tunnel tries, then its cleanup pass', () => {
    const { dir, device, env } = setup('fails');
    const run = spawnSync('zsh', [runner, 'phone', 'r1', '--rehearse', '--lane-b'], { encoding: 'utf8', env });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(readFileSync(join(dir, 'tunnels'), 'utf8')).toBe('try\ntry\ntry\n');
    expect(run.stdout).toMatch(/the quick-tunnel API gave no tunnel/);
    const args = readFileSync(join(dir, 'run-0-args'), 'utf8').trim().split('\n');
    expect(args.slice(args.indexOf('exec'))).toEqual(['exec', 'vitest', 'run', '--project', 'node', 'test/endpoint/staging-phone.live.test.ts']);
    expect(envOf(dir, 0)).toMatchObject({
      DESK_ACCESS_TOKEN: token,
      DESK_STAGING_PHONE: '1',
      DESK_STAGING_PHONE_RUN: 'r1',
      DESK_STAGING_PHONE_MODE: 'rehearse',
      DESK_STAGING_PHONE_LANE_B: 'required',
      DESK_STAGING_PHONE_NO_SINK: 'tunnel: the quick tunnel did not come up in 3 tries, nor through the quick-tunnel API',
      DESK_STAGING_ADMIN_KEYS: `${device}/keys.json`,
    });
    expect(envOf(dir, 1)).toMatchObject({ DESK_ACCESS_TOKEN: token, DESK_STAGING_PHONE: 'cleanup', DESK_STAGING_PHONE_RUN: 'r1' });
    for (const n of [0, 1]) expect(readFileSync(join(dir, `run-${n}-args`), 'utf8')).not.toContain(token);
    const logs = readdirSync(join(dir, 'state')).filter((name) => name.startsWith('phone-r1-'));
    expect(logs).toHaveLength(1);
    const log = readFileSync(join(dir, 'state', logs[0]), 'utf8');
    expect(log).toContain('PASS registration');
    expect(log).toContain('production untouched: X-Desk-Build: hub@0123abcd');
    expect(log).toContain('files holding the Access token or a secret the run handled: 0');
    expect(run.stdout + run.stderr + log).not.toContain(token);
    // The run's list of handled secrets and the endpoint's profile, handed to the suite and removed with the run.
    const state = join(dir, 'state');
    expect(envOf(dir, 0)).toMatchObject({ DESK_STAGING_PHONE_SCAN: `${state}/phone-r1.scan`, DESK_STAGING_PHONE_PROFILE: `${state}/phone-r1.profile` });
    expect(existsSync(join(state, 'phone-r1.scan')) || existsSync(join(state, 'phone-r1.profile'))).toBe(false);
  });

  it.skipIf(!zsh)('fails a run whose log holds a secret the suite listed as handled', () => {
    const { env } = setup('fails', true, true);
    const run = spawnSync('zsh', [runner, 'phone', 'r3', '--rehearse'], { encoding: 'utf8', env });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('files holding the Access token or a secret the run handled: 1');
  });

  it.skipIf(!zsh)('stops a suite still running when the runner is sent TERM, then runs its cleanup pass at once', async () => {
    const { dir, env } = setup('fails', true, false, true);
    const started = Date.now();
    const child = spawn('zsh', [runner, 'phone', 'r4', '--rehearse'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    for (let i = 0; i < 400 && !existsSync(join(dir, 'hung.pid')); i++) await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(dir, 'hung.pid')), out).toBe(true);
    const hung = Number(readFileSync(join(dir, 'hung.pid'), 'utf8'));
    const termed = Date.now();
    child.kill('SIGTERM');
    const code = await exited;
    // Within a bounded wait of the signal, not after the suite's own 40 s.
    expect(Date.now() - termed, out).toBeLessThan(15_000);
    expect(code, out).not.toBe(0);
    const alive = (() => {
      try {
        process.kill(hung, 0);
        return true;
      } catch {
        return false;
      }
    })();
    expect(alive, `the suite's process ${hung}`).toBe(false);
    expect(envOf(dir, 1)).toMatchObject({ DESK_STAGING_PHONE: 'cleanup', DESK_STAGING_PHONE_RUN: 'r4' });
    expect(out).toMatch(/the suite stopped/);
    expect(out).toContain('production untouched');
    expect(Date.now() - started).toBeLessThan(40_000);
  }, 60_000);

  it.skipIf(!zsh)('falls back to the quick-tunnel API after three tries: cloudflared run on its credentials, the file 0600 and gone after, its secret never printed', () => {
    const { dir, env } = setup('api');
    const run = spawnSync('zsh', [runner, 'phone', 'r5', '--rehearse'], { encoding: 'utf8', env, timeout: 90_000 });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(readFileSync(join(dir, 'tunnels'), 'utf8')).toBe('try\ntry\ntry\napi\n');
    expect(readFileSync(join(dir, 'creds-mode'), 'utf8').trim()).toBe('600');
    expect(readFileSync(join(dir, 'creds-secret'), 'utf8').trim()).toBe('1');
    expect(envOf(dir, 0)).toMatchObject({ DESK_STAGING_PHONE_SINK: 'https://spike-host-one.trycloudflare.com/staging-run', DESK_STAGING_PHONE_SINK_PORT: '18744' });
    expect(envOf(dir, 0).DESK_STAGING_PHONE_NO_SINK).toBeUndefined();
    expect(run.stdout).toMatch(/push sink: https:\/\/spike-host-one\.trycloudflare\.com -> 127\.0\.0\.1:18744 \(through the quick-tunnel API\)/);
    expect(run.stdout).toMatch(/tunnel stopped: pid \d+ at .*, process gone/);
    const state = join(dir, 'state');
    expect(readdirSync(state).filter((name) => name.includes('tunnel') && name.endsWith('.json'))).toEqual([]);
    const logs = readdirSync(state).filter((name) => name.endsWith('.log'));
    for (const log of logs) expect(readFileSync(join(state, log), 'utf8'), log).not.toContain(apiSecret);
    expect(run.stdout + run.stderr).not.toContain(apiSecret);
    expect(run.stdout).toContain('files holding the Access token or a secret the run handled: 0');
  }, 120_000);

  it.skipIf(!zsh)('removes a credentials file an earlier run under the same id left, though the tunnel comes up on its first try', () => {
    const { dir, env } = setup('up');
    const state = join(dir, 'state');
    mkdirSync(state, { recursive: true });
    const stale = join(state, 'phone-r6.tunnel.json');
    writeFileSync(stale, JSON.stringify({ AccountTag: 'acct0123', TunnelSecret: apiSecret, TunnelID: '0f0e0d0c-0b0a-4908-8706-050403020100' }), { mode: 0o600 });
    const run = spawnSync('zsh', [runner, 'phone', 'r6', '--rehearse'], { encoding: 'utf8', env, timeout: 60_000 });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(readFileSync(join(dir, 'tunnels'), 'utf8')).toBe('try\n');
    expect(existsSync(stale)).toBe(false);
  }, 90_000);

  it.skipIf(!zsh)('hands the suite the sink once the tunnel is up, and stops the tunnel when the run ends', () => {
    const { dir, env } = setup('up');
    const run = spawnSync('zsh', [runner, 'phone', 'r2', '--device', 'AbC-_9'], { encoding: 'utf8', env, timeout: 60_000 });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(readFileSync(join(dir, 'tunnels'), 'utf8')).toBe('try\n');
    expect(envOf(dir, 0)).toMatchObject({ DESK_STAGING_PHONE_MODE: 'phone', DESK_STAGING_PHONE_LANE_B: 'probe', DESK_STAGING_PHONE_DEVICE: 'AbC-_9', DESK_STAGING_PHONE_SINK: 'https://quick-test-1.trycloudflare.com/staging-run', DESK_STAGING_PHONE_SINK_PORT: '18744' });
    expect(envOf(dir, 0).DESK_STAGING_PHONE_NO_SINK).toBeUndefined();
    expect(run.stdout).toMatch(/push sink: https:\/\/quick-test-1\.trycloudflare\.com -> 127\.0\.0\.1:18744 \(try 1\)/);
    expect(run.stdout).toMatch(/tunnel stopped: pid \d+ at .*, process gone/);
  }, 90_000);
});

describe('the endpoint step', () => {
  // `staging-run.sh endpoint [args…]` (P5 O10 M11): `deployment endpoint-acceptance` on staging's config with the admin
  // device's keys, the token on its stdin alone, the run's secrets listed for the search after it, its hub deploy this
  // script's own `deploy` step; production's build compared before and after. Stubs stand for cloudflared (a synthetic
  // token), curl (production's build header) and pnpm (recording its arguments and stdin, printing a line holding a
  // secret it listed and one holding the token).
  const token = `eyJ${'e'.repeat(20)}.synthetic`;
  const setup = (leak = false) => {
    const dir = mkdtempSync(join(tmpdir(), 'staging-endpoint-'));
    const device = join(dir, 'device');
    mkdirSync(device);
    writeFileSync(join(device, 'keys.json'), '{}', { mode: 0o600 });
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'cloudflared'), `#!/bin/sh\nprintf '%s' '${token}'\n`, { mode: 0o755 });
    writeFileSync(join(bin, 'curl'), `#!/bin/sh\ncat > /dev/null\nprintf 'X-Desk-Build: hub@0123abcd web@master.0123abcd\\r\\n'\n`, { mode: 0o755 });
    writeFileSync(
      join(bin, 'pnpm'),
      [
        '#!/bin/sh',
        `printf '%s\\n' "$@" > '${dir}/args'`,
        `cat > '${dir}/stdin'`,
        'scan=$(printf "%s\\n" "$@" | sed -n "/^--scan$/{n;p;}")',
        '[ -n "$scan" ] && echo smns-enroll-v2.synthetic-endpoint-code >> "$scan"',
        ...(leak ? ['echo "code smns-enroll-v2.synthetic-endpoint-code"'] : []),
        'echo "PASS 9"',
        "echo 'a line naming a secret'",
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DESK_STAGING_DIR: join(dir, 'state'), DESK_STAGING_DEVICE: device, DESK_STAGING_SECRETS: join(dir, 'secrets') };
    return { dir, device, env };
  };

  it.skipIf(!zsh)('runs the acceptance on staging with the device’s keys and its own deploy step, the token on stdin alone, production compared', () => {
    const { dir, device, env } = setup();
    const run = spawnSync('zsh', [runner, 'endpoint', '--items', '9'], { encoding: 'utf8', env, timeout: 60_000 });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const args = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
    const state = join(dir, 'state');
    expect(args.slice(args.indexOf('deployment'))).toEqual([
      'deployment', 'endpoint-acceptance', '--config', 'deploy/staging.json', '--device-keys', `${device}/keys.json`, '--scan', join(state, 'endpoint.scan'), '--hub-deploy', runner, '--items', '9',
    ]);
    expect(readFileSync(join(dir, 'stdin'), 'utf8')).toBe(`DESK_ACCESS_TOKEN=${token}\n`);
    expect(run.stdout).toContain('PASS 9');
    expect(run.stdout).not.toContain('a line naming a secret');
    expect(run.stdout).toContain('production untouched: X-Desk-Build: hub@0123abcd web@master.0123abcd');
    expect(run.stdout).toContain('files holding the Access token or a secret the run handled: 0');
    expect(existsSync(join(state, 'endpoint.scan'))).toBe(false);
    expect(run.stdout + run.stderr).not.toContain(token);
  });

  it.skipIf(!zsh)('fails a run that printed a secret it handled, however its items went', () => {
    const { env } = setup(true);
    const run = spawnSync('zsh', [runner, 'endpoint'], { encoding: 'utf8', env, timeout: 60_000 });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('files holding the Access token or a secret the run handled: 1');
  });

  it.skipIf(!zsh)('sets the VM scene up from a base the VM holds, or tears it down, with no token read', () => {
    for (const [args, expected] of [
      [['endpoint-vm', 'setup', 'd392c4d8c'], ['endpoint-acceptance', '--config', 'deploy/staging.json', '--vm-setup', '--base', 'd392c4d8c']],
      [['endpoint-vm', 'teardown'], ['endpoint-acceptance', '--config', 'deploy/staging.json', '--vm-teardown']],
    ] as const) {
      const { dir, env } = setup();
      const run = spawnSync('zsh', [runner, ...args], { encoding: 'utf8', env, timeout: 60_000 });
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const given = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
      expect(given.slice(given.indexOf('deployment') + 1)).toEqual(expected);
      expect(readFileSync(join(dir, 'stdin'), 'utf8')).toBe('');
    }
    const { env } = setup();
    const bad = spawnSync('zsh', [runner, 'endpoint-vm', 'setup', 'HEAD;rm'], { encoding: 'utf8', env });
    expect(bad.status).toBe(2);
    expect(bad.stdout).toMatch(/endpoint-vm setup <base commit> \| teardown/);
  });
});
