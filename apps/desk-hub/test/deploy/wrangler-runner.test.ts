// What wrangler is given besides its argv (O11 M2's review): wrangler 4.151 also takes its Worker, environment, account,
// API and log handling from environment variables (WRANGLER_CI_OVERRIDE_NAME renames the Worker outright), from .env
// files in its directory, and from a redirect file (.wrangler/deploy/config.json) or an `account_id` in wrangler.jsonc.
// The tool runs wrangler with an allow-listed environment, no .env, an explicit wrangler.jsonc, sanitized logs and no
// disk log, and refuses a redirect or a foreign account_id. The runner is driven here against a stand-in wrangler
// package that prints what it was given; nothing reaches Cloudflare.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDeployConfig } from '../../deploy/config.ts';
import { wrangler, wranglerEnv, workerWrangler } from '../../deploy/deploy.ts';

const staging = readDeployConfig(join(import.meta.dirname, '../../deploy/staging.json'));
const realApp = join(import.meta.dirname, '../..');

/** An app directory whose `wrangler` package prints its argv and environment as JSON. */
function standInApp(wranglerJsonc: string = '{\n  // the Worker\n  "name": "desk-hub"\n}\n') {
  const dir = mkdtempSync(join(tmpdir(), 'desk-wrangler-runner-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"stand-in","private":true}');
  writeFileSync(join(dir, 'wrangler.jsonc'), wranglerJsonc);
  const pkg = join(dir, 'node_modules', 'wrangler');
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), '{"name":"wrangler","version":"0.0.0"}');
  writeFileSync(join(pkg, 'bin', 'wrangler.js'), 'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\n');
  return dir;
}

const saved = { ...process.env };
afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
});

describe("wrangler's environment", () => {
  const inherited = {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    WRANGLER_CI_OVERRIDE_NAME: 'desk-hub',
    CLOUDFLARE_ENV: 'production',
    CLOUDFLARE_ACCOUNT_ID: 'another-account',
    CLOUDFLARE_API_TOKEN: 'a-token',
    CLOUDFLARE_API_BASE_URL: 'https://elsewhere.example/client/v4',
    WRANGLER_API_ENVIRONMENT: 'staging',
    WRANGLER_LOG_SANITIZE: 'false',
    WRANGLER_WRITE_LOGS: 'true',
    WRANGLER_LOG_PATH: '/tmp/somewhere',
    WRANGLER_LOG: 'debug',
    CF_ACCESS_SETUP_TOKEN: 'setup',
    CF_DESK_HUB_SERVICE_TOKENS: 'service',
    DESK_ACCESS_TOKEN: 'person',
  };

  it('inherits only what locates the system and the login, never what picks a Worker, account, API or log', () => {
    const env = wranglerEnv(inherited, { CLOUDFLARE_ACCOUNT_ID: staging.account });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/someone',
      CLOUDFLARE_ACCOUNT_ID: staging.account,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_SANITIZE: 'true',
      WRANGLER_WRITE_LOGS: 'false',
    });
  });

  it('keeps sanitizing and disk logging forced off whatever the caller sets', () => {
    expect(wranglerEnv({}, { WRANGLER_LOG_SANITIZE: 'false', WRANGLER_WRITE_LOGS: 'true' })).toMatchObject({ WRANGLER_LOG_SANITIZE: 'true', WRANGLER_WRITE_LOGS: 'false' });
  });
});

describe('the wrangler runner, through the target guard', () => {
  it("gives wrangler the config's Worker, wrangler.jsonc by path, no .env, and the allow-listed environment", async () => {
    const app = standInApp();
    writeFileSync(join(app, '.env'), 'WRANGLER_CI_OVERRIDE_NAME=desk-hub\n');
    process.env.DESK_HUB_APP = app;
    process.env.WRANGLER_CI_OVERRIDE_NAME = 'desk-hub';
    process.env.CLOUDFLARE_ENV = 'production';
    const run = workerWrangler(staging, wrangler, () => {});
    const seen = JSON.parse(await run(['deploy'])) as { argv: string[]; env: Record<string, string> };
    expect(seen.argv).toEqual(['deploy', '--name', 'desk-hub-staging', '--config', join(app, 'wrangler.jsonc'), '--env-file', '/dev/null']);
    expect(seen.env.WRANGLER_CI_OVERRIDE_NAME).toBeUndefined();
    expect(seen.env.CLOUDFLARE_ENV).toBeUndefined();
    expect(seen.env).toMatchObject({ CLOUDFLARE_ACCOUNT_ID: staging.account, WRANGLER_LOG_SANITIZE: 'true', WRANGLER_WRITE_LOGS: 'false' });
  });

  it('refuses an app whose wrangler.jsonc names another account, which wrangler would prefer to CLOUDFLARE_ACCOUNT_ID', () => {
    process.env.DESK_HUB_APP = standInApp('{ "name": "desk-hub", "account_id": "another-account" }');
    expect(() => workerWrangler(staging, wrangler, () => {})).toThrow(/account_id another-account, not/);
    process.env.DESK_HUB_APP = standInApp(`{ "name": "desk-hub", "account_id": "${staging.account}" }`);
    expect(() => workerWrangler(staging, wrangler, () => {})).not.toThrow();
  });

  it('refuses an app with a deploy redirect, which would hand wrangler another configuration', () => {
    const app = standInApp();
    mkdirSync(join(app, '.wrangler', 'deploy'), { recursive: true });
    writeFileSync(join(app, '.wrangler', 'deploy', 'config.json'), '{"configPath":"../../other.json"}');
    process.env.DESK_HUB_APP = app;
    expect(() => workerWrangler(staging, wrangler, () => {})).toThrow(/\.wrangler\/deploy\/config\.json/);
  });

  it('accepts the real app as it stands', () => {
    process.env.DESK_HUB_APP = realApp;
    expect(() => workerWrangler(staging, async () => '', () => {})).not.toThrow();
  });
});
