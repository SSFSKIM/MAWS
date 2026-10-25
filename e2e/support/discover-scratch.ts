// P4-AGG M1 (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M1 Touches): what a Discover launch writes
// around the real engine before the app starts, under the launch's profile `userData` and its engine store
// `configDir` (launch.ts's `realEngine` option):
// - the engine's Anthropic Directory turned off through its on/off file, `<configDir>/plugins/plugin-directory-
//   marketplace.json` = {"enabled": false} (2.1.309 cli.pretty.js 780384 to 780398; `plugin list --available` then lists
//   no `anthropic-plugin-directory` entry and reads nothing from the network), so the engine's listings are
//   deterministic. The harness writes it; MAWS never does (the spec's Constraints);
// - one or two scratch projects, real paths (the engine records a project scope's path as the realpath), trusted in the
//   engine store's `.claude.json` as the owner's trust dialog would leave them;
// - the test marketplace (e2e/fixtures/catalog/marketplace) copied in, `remote-server`'s MCP URL pointed where the scene
//   says, and the catalog's test-source descriptor naming it (src/main/catalog/sources.ts's seam);
// - the environment: the recorded network sources (src/main/catalog/fetch.ts's seam), the descriptor, and a scratch
//   HOME (the live smoke, `live`: the real sources and the engine's directory on). Under a scratch HOME `security` finds
//   no login keychain, so the engine can store no credential (its client-secret write reports "could not be stored",
//   nothing falls back to a file; spikes/p4-aggregator/findings-m1.txt): a scene whose engine must sign in to a server
//   keeps the runner's HOME (`home: 'runner'`) and takes custody of the one Keychain item its scratch CLAUDE_CONFIG_DIR
//   names (connector-oauth.ts's engineKeychainCustody).
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATALOG_FIXTURES_ENV, CATALOG_LIVE_ENV } from '../../src/main/catalog/fetch';
import { CATALOG_TEST_SOURCES_ENV } from '../../src/main/catalog/sources';

const FIXTURES = resolve(__dirname, '../fixtures/catalog');
export const TEST_MARKETPLACE = 'maws-discover-test';
// The URL remote-server's `.mcp.json` carries in the repository: the discard port, so an unpointed copy reaches nothing.
export const REMOTE_SERVER_PLACEHOLDER = 'http://127.0.0.1:9/mcp';

export interface DiscoverScratchOptions {
  projects?: 1 | 2;
  home?: 'scratch' | 'runner';
  remoteServerUrl?: string; // remote-server's MCP URL, e.g. an engine-mode OAuth fixture's `resourceUrl`
  omitSources?: string[]; // P4-AGG M3: network source keys left out of the recordings, as sources that fail (acceptance 11)
  // P4-AGG M5, the opt-in live smoke (e2e/discover-live.spec.ts) alone: the real network sources in place of the
  // recordings (MAWS_CATALOG_LIVE=1, no test-source descriptor), and the engine's Anthropic Directory left on, so a
  // directory plugin installs as it does for the owner.
  live?: boolean;
}

export interface DiscoverScratch {
  home: string | null; // the scratch HOME, or null under the runner's
  configDir: string;
  projects: string[];
  marketplace: string; // the test marketplace's copy, the path `plugin marketplace add` takes
  testSources: string; // the descriptor file
  env: Record<string, string>; // for the app's environment
}

export function writeDiscoverScratch(userData: string, configDir: string, options: DiscoverScratchOptions = {}): DiscoverScratch {
  mkdirSync(join(configDir, 'plugins'), { recursive: true });
  if (!options.live) writeFileSync(join(configDir, 'plugins', 'plugin-directory-marketplace.json'), '{"enabled": false}\n');

  const projects = ['project-a', 'project-b'].slice(0, options.projects ?? 1).map((name) => {
    mkdirSync(join(userData, name), { recursive: true });
    return realpathSync(join(userData, name));
  });
  const globalConfig = join(configDir, '.claude.json');
  const config = (existsSync(globalConfig) ? JSON.parse(readFileSync(globalConfig, 'utf8')) : {}) as { projects?: Record<string, object> };
  const trusted = Object.fromEntries(projects.map((project) => [project, { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }]));
  writeFileSync(globalConfig, `${JSON.stringify({ ...config, hasCompletedOnboarding: true, projects: { ...config.projects, ...trusted } }, null, 2)}\n`);

  const copy = join(userData, TEST_MARKETPLACE);
  cpSync(join(FIXTURES, 'marketplace'), copy, { recursive: true });
  const marketplace = realpathSync(copy);
  if (options.remoteServerUrl !== undefined) {
    const mcp = join(marketplace, 'plugins', 'remote-server', '.mcp.json');
    writeFileSync(mcp, readFileSync(mcp, 'utf8').replace(REMOTE_SERVER_PLACEHOLDER, options.remoteServerUrl));
  }
  const testSources = join(userData, 'catalog-test-sources.json');
  const descriptor = { key: `test:${TEST_MARKETPLACE}`, label: 'MAWS Discover test marketplace', ownership: 'added', marketplaceName: TEST_MARKETPLACE, marketplaceSource: marketplace, manifestPath: join(marketplace, '.claude-plugin', 'marketplace.json') };
  writeFileSync(testSources, `${JSON.stringify([descriptor], null, 2)}\n`);

  let home: string | null = null;
  if ((options.home ?? 'scratch') === 'scratch') {
    mkdirSync(join(userData, 'home'), { recursive: true });
    home = realpathSync(join(userData, 'home'));
  }
  // the recordings, or a copy of them without the sources a scene leaves out (a missing file is that source failing)
  let fixtures = FIXTURES;
  if (options.omitSources?.length) {
    fixtures = join(userData, 'catalog-fixtures');
    cpSync(FIXTURES, fixtures, { recursive: true, filter: (path) => !options.omitSources!.some((key) => path === join(FIXTURES, `${key}.json`)) });
  }
  const catalog: Record<string, string> = options.live ? { [CATALOG_LIVE_ENV]: '1' } : { [CATALOG_FIXTURES_ENV]: fixtures, [CATALOG_TEST_SOURCES_ENV]: testSources };
  return { home, configDir, projects, marketplace, testSources, env: { ...catalog, ...(home !== null && { HOME: home }) } };
}
