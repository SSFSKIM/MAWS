// The deploy tool names the Worker it acts on (O11 M2): every wrangler call carries `--name <config.worker>`, and a
// call whose target is not the config's Worker is refused before it runs. So a staging config can never reach the
// production Worker `desk-hub`, and production's config still deploys production as it did. Stubs only: wrangler and
// Cloudflare's API are fakes here, never the deployment.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDeployConfig, type DeployConfig } from '../../deploy/config.ts';
import { deployArgs, deployHub, workerWrangler, type WranglerRun } from '../../deploy/deploy.ts';
import { serviceTokenName } from '../../src/protocol/identity.ts';

process.env.DESK_HUB_APP ??= join(import.meta.dirname, '../..');

const production = readDeployConfig(join(import.meta.dirname, '../../deploy/config.json'));
const staging = readDeployConfig(join(import.meta.dirname, '../../deploy/staging.json'));

/** A web build to deploy, so a run never touches apps/desk-web/dist. */
const assets = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'desk-target-test-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  return dir;
})();

/** A fake wrangler: records each call, answers `secret list` with the secrets it is told the Worker holds. */
function fakeWrangler(holds: string[] = []) {
  const calls: Array<{ args: string[]; input?: string; env?: Record<string, string> }> = [];
  const run: WranglerRun = async (args, input, env) => {
    calls.push({ args, input, env });
    return args[0] === 'secret' && args[1] === 'list' ? JSON.stringify(holds.map((name) => ({ name, type: 'secret_text' }))) : 'ok';
  };
  return { run, calls };
}

/** A fake of the account's Access API, already holding production's Access objects (as their names). */
function fakeAccount() {
  const policies = new Map<string, Record<string, unknown>>();
  const apps = new Map<string, Record<string, unknown>>();
  let next = 0;
  const prodId = (name: string) => `prod-${name.replaceAll(' ', '-')}`;
  for (const name of ['desk-hub owner', 'desk-hub machines', 'desk-hub public paths']) policies.set(prodId(name), { id: prodId(name), name, include: [{ prod: {} }] });
  for (const name of ['desk-hub', 'desk-hub public paths']) apps.set(prodId(name), { id: prodId(name), name, aud: `aud-${name}` });
  const before = JSON.stringify([...policies.values(), ...apps.values()]);
  const calls: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/client\/v4\/accounts\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }));
    if (path === '/access/organizations') return ok({ auth_domain: 'team.cloudflareaccess.com' });
    const table = path.startsWith('/access/policies') ? policies : path.startsWith('/access/apps') ? apps : undefined;
    const id = path.split('/')[3];
    if (table && method === 'GET' && !id) return ok([...table.values()]);
    if (table && method === 'POST' && !id) {
      const record = { ...body, id: `id-${++next}`, ...(table === apps ? { aud: `aud-${next}` } : {}) };
      table.set(record.id, record);
      return ok(record);
    }
    if (table && method === 'PUT' && id && table.has(id)) {
      table.set(id, { ...table.get(id), ...body, id });
      return ok(table.get(id));
    }
    return new Response(JSON.stringify({ success: false, errors: [{ code: 0, message: `unexpected ${method} ${path}` }] }), { status: 400 });
  }) as typeof fetch;
  const production = () => JSON.stringify([...policies.values(), ...apps.values()].filter((r) => String(r.id).startsWith('prod-')));
  return { fetcher, calls, policies, apps, unchanged: () => production() === before };
}

/** What the guard appends to every call: the Worker, wrangler.jsonc by path, and no .env. */
const pinned = (worker: string) => ['--name', worker, '--config', join(process.env.DESK_HUB_APP!, 'wrangler.jsonc'), '--env-file', '/dev/null'];

const SECRETS = { CF_ACCESS_SETUP_TOKEN: 'setup-token', CF_DESK_HUB_SERVICE_TOKENS: 'service-tokens' };

/** The `--name` a wrangler argv carries: what wrangler takes as the Worker. */
const named = (args: string[]) => args[args.lastIndexOf('--name') + 1];

describe('the staging configuration', () => {
  it('is its own Worker, on its own host, with its own org: never production’s', () => {
    expect(staging).toMatchObject({ worker: 'desk-hub-staging', host: 'desk-hub-staging.opencognita-platform.workers.dev', org: { id: 'staging-ssfskim' } });
    expect(staging.account).toBe(production.account);
    expect(staging.ownerEmail).toBe(production.ownerEmail);
  });

  it("names no machine service token production could also name", () => {
    // Machine service tokens are named desk-<org>-<machine> account-wide, and redemption deletes that name first; machine
    // names may hold '-', so neither org's token prefix may begin the other's.
    const [stagingPrefix, productionPrefix] = [serviceTokenName(staging.org.id, ''), serviceTokenName(production.org.id, '')];
    expect(stagingPrefix.startsWith(productionPrefix)).toBe(false);
    expect(productionPrefix.startsWith(stagingPrefix)).toBe(false);
  });
});

describe('deploying with the staging configuration', () => {
  it('names desk-hub-staging on every wrangler call, and never desk-hub', async () => {
    const wrangler = fakeWrangler();
    const account = fakeAccount();
    await deployHub(staging, SECRETS, { assets, quiet: true }, { wrangler: wrangler.run, fetch: account.fetcher });
    expect(wrangler.calls.map((c) => c.args.slice(0, 2).join(' '))).toEqual(['deploy --assets', 'secret list', 'secret put', 'secret put']);
    for (const { args, env } of wrangler.calls) {
      expect(args.filter((a) => a === '--name')).toHaveLength(1);
      expect(named(args)).toBe('desk-hub-staging');
      expect(env).toEqual({ CLOUDFLARE_ACCOUNT_ID: staging.account });
    }
    expect(wrangler.calls[0].args).toContain('ORG_ID:staging-ssfskim');
  });

  it("leaves production's Access objects as they were, and makes staging's own", async () => {
    const account = fakeAccount();
    await deployHub(staging, SECRETS, { assets, quiet: true }, { wrangler: fakeWrangler().run, fetch: account.fetcher });
    expect(account.unchanged()).toBe(true);
    expect(account.calls.filter((c) => c.includes('/prod-'))).toEqual([]);
    const made = [...account.apps.values(), ...account.policies.values()].filter((r) => !String(r.id).startsWith('prod-')).map((r) => r.name);
    expect(made.sort()).toEqual(['desk-hub-staging', 'desk-hub-staging machines', 'desk-hub-staging owner', 'desk-hub-staging public paths', 'desk-hub-staging public paths'].sort());
  });
});

describe("deploying with production's configuration", () => {
  it('runs the calls it always ran, each now naming desk-hub', async () => {
    const wrangler = fakeWrangler(['CF_API_TOKEN', 'VAPID_KEY']);
    const account = fakeAccount();
    await deployHub(production, SECRETS, { assets, web: 'w', quiet: true }, { wrangler: wrangler.run, fetch: account.fetcher });
    const [deploy, list] = wrangler.calls.map((c) => c.args);
    expect(wrangler.calls).toHaveLength(2);
    expect(deploy.slice(0, 4)).toEqual(['deploy', '--assets', assets, '--define']);
    expect(deploy).toContain('ORG_ID:ssfskim');
    expect(deploy).toContain('ACCESS_AUD:aud-desk-hub');
    expect(deploy.slice(-6)).toEqual(pinned('desk-hub'));
    expect(list).toEqual(['secret', 'list', '--format', 'json', ...pinned('desk-hub')]);
    // Its own Access objects updated in place, nothing new made.
    expect(account.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
  });

  it('puts a missing secret on desk-hub alone, its value on stdin', async () => {
    const wrangler = fakeWrangler(['VAPID_KEY']);
    await deployHub(production, SECRETS, { assets, quiet: true }, { wrangler: wrangler.run, fetch: fakeAccount().fetcher });
    expect(wrangler.calls[2]).toMatchObject({ args: ['secret', 'put', 'CF_API_TOKEN', ...pinned('desk-hub')], input: 'service-tokens' });
  });
});

describe('the target guard', () => {
  const mismatched: DeployConfig = { ...staging, worker: 'desk-hub' };

  it('refuses a config whose Worker is not the one its host names, before Access or wrangler is touched', async () => {
    const wrangler = fakeWrangler();
    const account = fakeAccount();
    await expect(deployHub(mismatched, SECRETS, { assets, quiet: true }, { wrangler: wrangler.run, fetch: account.fetcher })).rejects.toThrow(
      /desk-hub-staging\.opencognita-platform\.workers\.dev is not the Worker desk-hub's/,
    );
    expect(wrangler.calls).toEqual([]);
    expect(account.calls).toEqual([]);
  });

  it('refuses a call that would choose its own target, and runs nothing', async () => {
    const wrangler = fakeWrangler();
    const run = workerWrangler(staging, wrangler.run, () => {});
    for (const flag of [['--name', 'desk-hub'], ['--name=desk-hub'], ['--env', 'production'], ['-e', 'x'], ['--config', 'other.jsonc'], ['-c', 'x'], ['--cwd', '/'], ['--env-file', '.env'], ['--profile', 'other']]) {
      await expect(run(['secret', 'put', 'VAPID_KEY', ...flag], 'v')).rejects.toThrow(/would choose the Worker/);
    }
    expect(wrangler.calls).toEqual([]);
  });

  it('prints the target it checked for each call, and no value', async () => {
    const lines: string[] = [];
    const wrangler = fakeWrangler();
    const run = workerWrangler(staging, wrangler.run, (line) => lines.push(line));
    await run(['secret', 'put', 'CF_API_TOKEN'], 'service-tokens');
    await run(['deploy', '--var', 'ORG_ID:staging-ssfskim']);
    expect(lines).toEqual([
      `wrangler target desk-hub-staging (config worker desk-hub-staging, account ${staging.account}): secret put CF_API_TOKEN`,
      `wrangler target desk-hub-staging (config worker desk-hub-staging, account ${staging.account}): deploy`,
    ]);
  });
});

describe('the suites have no network', () => {
  it('refuses the global fetch to any host but loopback, before a request leaves', async () => {
    await expect(fetch('https://api.cloudflare.com/client/v4/accounts/x/access/organizations')).rejects.toThrow(/no network in tests: https:\/\/api\.cloudflare\.com refused/);
  });

  it('so a deploy given no fake account fails at its first Access call, and runs no wrangler', async () => {
    const wrangler = fakeWrangler();
    await expect(deployHub(staging, SECRETS, { assets, quiet: true }, { wrangler: wrangler.run, fetch })).rejects.toThrow(/no network in tests/);
    expect(wrangler.calls).toEqual([]);
  });
});

describe('the options of a command that deploys', () => {
  it('refuses a second --config, which would silently win over the first', () => {
    expect(() => deployArgs(['--config', 'deploy/staging.json', '--config', 'deploy/config.json'])).toThrow(/--config given 2 times/);
  });

  it('takes one --config, or the default', () => {
    expect(deployArgs(['--config', join(import.meta.dirname, '../../deploy/staging.json')]).config.worker).toBe('desk-hub-staging');
    expect(deployArgs([]).config.worker).toBe('desk-hub');
  });
});
