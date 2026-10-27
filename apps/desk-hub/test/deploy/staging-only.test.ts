// The commands that write org state for a test (O11 M8: relay-measure, acceptance, redeploy-check's RL1 leg) act on a
// staging hub or the suites' local one, and never on production, by name: whatever a configuration's org, its pinned
// genesis or `--test-org` say, production's host and Worker are refused before any request. Stubs and the suites'
// no-network fetch only: never a deployment.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main as acceptance } from '../../deploy/acceptance.ts';
import { checkTestHub, checkTestTarget, PRODUCTION_HOST, PRODUCTION_WORKER, readDeployConfig, STAGING_HOST, STAGING_WORKER, type DeployConfig } from '../../deploy/config.ts';
import { Person } from '../../deploy/hub.ts';
import { newAdminDevice, OrgAdmin } from '../../deploy/org-admin.ts';
import { Cleanup } from '../../deploy/proof.ts';
import { main as redeployCheckMain, redeployCheck } from '../../deploy/redeploy-check.ts';
import { main as relayMeasure } from '../../deploy/relay-measure.ts';

process.env.DESK_HUB_APP ??= join(import.meta.dirname, '../..');

const production = readDeployConfig(join(import.meta.dirname, '../../deploy/config.json'));
const staging = readDeployConfig(join(import.meta.dirname, '../../deploy/staging.json'));

/** A configuration file written for one test. */
function configFile(config: DeployConfig): string {
  const file = join(mkdtempSync(join(tmpdir(), 'm8-target-')), 'config.json');
  writeFileSync(file, JSON.stringify(config));
  return file;
}

afterEach(() => vi.restoreAllMocks());

describe('production, by name', () => {
  it('is the host and Worker deploy/config.json names', () => {
    expect(production.host).toBe(PRODUCTION_HOST);
    expect(production.worker).toBe(PRODUCTION_WORKER);
  });

  it('is refused as a target whatever the configuration calls its org or pins', () => {
    for (const config of [
      production,
      { ...production, org: { id: 'elsewhere', name: 'Elsewhere' }, orgGenesis: staging.orgGenesis },
      // Production's Worker on another account's subdomain, and production's host under another Worker's name.
      { ...production, host: 'desk-hub.someone-else.workers.dev' },
      { ...staging, host: PRODUCTION_HOST },
    ]) {
      expect(() => checkTestTarget(config, 'write org state')).toThrow(/production|not the Worker/);
    }
  });

  it('is refused as a hub, before anything is asked of it', () => {
    for (const hub of [`https://${PRODUCTION_HOST}`, `https://${PRODUCTION_HOST}/`, 'https://desk-hub.someone-else.workers.dev', `HTTPS://${PRODUCTION_HOST.toUpperCase()}`]) {
      expect(() => checkTestHub(hub, 'write org state')).toThrow(/production/);
    }
  });

  // Wrangler names a version's preview alias `<alias>-<worker>.<subdomain>.workers.dev`: an alias of production's Worker
  // reaches production's objects, whatever the alias says, a name starting `desk-hub-staging` included.
  it('is refused through a preview alias of its Worker, as a hub and as a configuration', () => {
    for (const host of ['desk-hub-staging-desk-hub.opencognita-platform.workers.dev', 'preview-desk-hub.opencognita-platform.workers.dev']) {
      expect(() => checkTestHub(`https://${host}`, 'write org state')).toThrow(/production/);
      expect(() => checkTestTarget({ ...staging, worker: host.split('.')[0], host }, 'write org state')).toThrow(/production/);
    }
  });
});

describe('what a test command may write to', () => {
  it('is a staging Worker, as its configuration names it, or the suites’ local hub', () => {
    expect(() => checkTestTarget(staging, 'write org state')).not.toThrow();
    expect(() => checkTestHub(`https://${staging.host}`, 'write org state')).not.toThrow();
    expect(() => checkTestHub('http://127.0.0.1:8787', 'write org state')).not.toThrow();
    expect(() => checkTestHub('http://localhost:8787', 'write org state')).not.toThrow();
  });

  it('is staging’s Worker and host by their exact names, which staging.json holds', () => {
    expect(staging.worker).toBe(STAGING_WORKER);
    expect(staging.host).toBe(STAGING_HOST);
  });

  it('is nothing else: another Worker, another host, a sibling or an alias of staging’s, plain http to a remote host', () => {
    expect(() => checkTestTarget({ ...staging, worker: 'shop', host: 'shop.opencognita-platform.workers.dev' }, 'write org state')).toThrow(/not the staging/);
    // A Worker named after staging is not staging, nor is staging's Worker on another account's subdomain.
    expect(() => checkTestTarget({ ...staging, worker: 'desk-hub-staging-2', host: 'desk-hub-staging-2.opencognita-platform.workers.dev' }, 'write org state')).toThrow(/not the staging/);
    expect(() => checkTestTarget({ ...staging, host: 'desk-hub-staging.someone-else.workers.dev' }, 'write org state')).toThrow(/not the staging/);
    for (const hub of [
      'https://shop.opencognita-platform.workers.dev',
      'https://example.com',
      `http://${staging.host}`,
      'https://desk-hub-staging.example.com',
      'https://desk-hub-staging-2.opencognita-platform.workers.dev',
      'https://preview-desk-hub-staging.opencognita-platform.workers.dev',
      'https://desk-hub-staging.someone-else.workers.dev',
    ]) {
      expect(() => checkTestHub(hub, 'write org state')).toThrow(/not the staging/);
    }
  });
});

describe('the commands', () => {
  // The bypass a review found: a configuration naming production's host with another default org, so that
  // `--test-org ssfskim` (production's org) passes as a throwaway, and a production token would let the admin post a
  // genesis there.
  const bypass = () => configFile({ ...production, org: { id: 'elsewhere', name: 'Elsewhere' } });

  it('refuse production before reading a credential or making a request', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A terminal's stdin: readSecrets would answer from the environment rather than wait for input.
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const config = bypass();
    try {
      expect(await relayMeasure(['--config', config, '--device-keys', 'x', '--test-org', 'ssfskim'])).toBe(2);
      expect(await acceptance(['--config', config, '--device-keys', 'x', '--test-org', 'ssfskim'])).toBe(2);
      expect(await redeployCheckMain(['--config', config, '--test-org', 'ssfskim'])).toBe(2);
      expect(await relayMeasure(['--device-keys', 'x'])).toBe(2);
      expect(await acceptance(['--device-keys', 'x'])).toBe(2);
    } finally {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
    const said = errors.mock.calls.flat().join('\n');
    expect(said.match(/production/g)?.length).toBeGreaterThanOrEqual(5);
    expect(said).not.toMatch(/DESK_ACCESS_TOKEN/);
    expect(fetched).not.toHaveBeenCalled();
  });

  it('cannot be led to production through the admin or the redeploy check’s entry, a throwaway org named or not', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch');
    const owner = new Person(`https://${PRODUCTION_HOST}`, 'unused');
    const device = await newAdminDevice();
    await expect(OrgAdmin.open(owner, { org: 'ssfskim', throwaway: true }, device, () => {})).rejects.toThrow(/production/);
    await expect(OrgAdmin.open(owner, { org: 'ssfskim', pinnedGenesis: 'x' }, device, () => {})).rejects.toThrow(/production/);
    await expect(redeployCheck(owner, 'ssfskim', { seconds: '1', 'redeploy-at': '0' }, new Cleanup(), async () => {}, device)).rejects.toThrow(/production/);
    expect(fetched).not.toHaveBeenCalled();
  });
});
