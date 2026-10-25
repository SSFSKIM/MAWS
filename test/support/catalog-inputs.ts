// P4-AGG M2: the catalog's inputs from M1's recordings, for its unit tests. The network sources are
// e2e/fixtures/catalog/<source key>.json parsed as the store parses them; the engine's reads are the scratch 2.1.309
// engine's raw CLI JSON (test/fixtures/catalog/, `<scratch>` standing for its scratch root) reduced by the host's own
// reducers, and the host's `plugins.marketplaceManifest` answer recorded for the local test marketplace.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MarketplaceManifestView } from '@shared/ipc/schema/plugins';
import { availableOf, installedOf, marketplacesOf, pluginRowsOf } from '../../src/engine-host/plugins/cli-result';
import { readMarketplaceManifest } from '../../src/engine-host/plugins/manifest';
import type { EngineView, TestSourceData } from '../../src/main/catalog/normalize';
import { networkData, parseSource, type NetworkData, type ParsedSource } from '../../src/main/catalog/records';

export const REPO = resolve(__dirname, '../..');
export const NETWORK_FIXTURES = join(REPO, 'e2e/fixtures/catalog');
export const TEST_MARKETPLACE = join(NETWORK_FIXTURES, 'marketplace');
const ENGINE_FIXTURES = join(REPO, 'test/fixtures/catalog');
export const SCRATCH = '/scratch-root';
export const PROJECT_A = `${SCRATCH}/project-a`;
export const PROJECT_B = `${SCRATCH}/project-b`;

/** The recorded network sources by key, parsed; `omit` leaves sources out, as a source that failed and was never fetched. */
export function recordedSources(omit: readonly string[] = []): Map<string, ParsedSource> {
  const parsed = new Map<string, ParsedSource>();
  for (const file of readdirSync(NETWORK_FIXTURES).filter((name) => name.endsWith('.json'))) {
    const key = file.slice(0, -'.json'.length);
    if (omit.includes(key)) continue;
    const { pages } = JSON.parse(readFileSync(join(NETWORK_FIXTURES, file), 'utf8')) as { pages: unknown[] };
    parsed.set(key, parseSource(key, pages));
  }
  return parsed;
}
export const recordedNetwork = (omit: readonly string[] = []): NetworkData => networkData(recordedSources(omit));

const recorded = (file: string) => (JSON.parse(readFileSync(join(ENGINE_FIXTURES, file), 'utf8').replaceAll('<scratch>', SCRATCH)) as { output: unknown }).output;

/** The scratch engine's reads, as the host answers them in `cwd` (realpaths are the paths themselves here). */
export async function recordedEngine(cwd: string, over: Partial<EngineView> = {}): Promise<EngineView> {
  const rows = pluginRowsOf(JSON.stringify(recorded('plugin-list.json')));
  const manifest = recorded('marketplace-manifest.json') as MarketplaceManifestView;
  return {
    cwd,
    installed: await installedOf(rows, cwd, async (path) => path),
    available: availableOf(JSON.stringify(recorded('plugin-list-available.json'))),
    marketplaces: marketplacesOf(JSON.stringify(recorded('marketplace-list.json'))),
    manifests: new Map([['maws-discover-test', manifest]]), // maws-recorded-pins' clone is not recorded: its listing stands in
    servers: [],
    directoryInstalled: new Map(),
    ...over,
  };
}

/** The e2e's test-source descriptor for the local test marketplace, read from disk as the catalog reads it. */
export async function testSourceData(): Promise<TestSourceData> {
  const source = { key: 'test:maws-discover-test', label: 'MAWS Discover test marketplace', ownership: 'added' as const, marketplaceName: 'maws-discover-test', marketplaceSource: `${SCRATCH}/maws-discover-test`, manifestPath: join(TEST_MARKETPLACE, '.claude-plugin/marketplace.json') };
  return { source, manifest: await readMarketplaceManifest(TEST_MARKETPLACE) };
}
