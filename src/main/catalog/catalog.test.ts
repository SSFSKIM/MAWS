// P4-AGG M2: the catalog over M1's recordings (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M2
// "Proves"): the item count, the joins, route precedence, installed here versus elsewhere for two cwds,
// `runsOnYourComputer` for a stdio-only, a remote-only and an unknown item, the publisher chain, the category axis'
// coverage, deterministic pagination across a tie, a failed source leaving the others, an added marketplace no other
// source knows, and the test-source seam before the add.
import { describe, expect, it } from 'vitest';
import { CatalogItemSchema, type CatalogItem } from '@shared/ipc/schema/catalog';
import { PROJECT_A, PROJECT_B, recordedEngine, recordedNetwork, recordedSources, testSourceData } from '../../../test/support/catalog-inputs';
import { buildCatalog } from './join';
import { connectorName, type EngineView } from './normalize';
import { categoryTitle, homeOf, queryOf } from './query';
import { TAXONOMY_AXES } from './records';
import { axisCoverage } from './summary';

const catalog = async (over: { engine?: EngineView | null; omit?: string[]; tests?: boolean } = {}) =>
  buildCatalog({ network: recordedNetwork(over.omit), engine: over.engine === undefined ? await recordedEngine(PROJECT_A) : over.engine, tests: over.tests === false ? [] : [await testSourceData()] });
const byId = (items: readonly CatalogItem[], id: string) => {
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
};
const named = (items: readonly CatalogItem[], name: string) => items.filter((i) => i.name === name || i.installName === name);
const OFFICIAL = (path: string) => `github.com/anthropics/claude-plugins-official#${path}`;
const TEST = (plugin: string) => `local:/scratch-root/maws-discover-test#plugins/${plugin}`;

describe('the catalog over the recorded sources', () => {
  it('holds one valid item per thing: 78 plugins and 10 Claude Code connectors', async () => {
    const items = await catalog();
    for (const item of items) expect(CatalogItemSchema.safeParse(item).success, item.id).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    // 12 seeds' 69 entries, 61 directory records, 4 test-marketplace and 3 recorded-pin entries, joined: 78 plugins.
    // The servers' 12 records less the local desktop extension and the one not made for Claude Code: 10 connectors.
    expect(items.filter((i) => i.kind === 'plugin')).toHaveLength(78);
    expect(items.filter((i) => i.kind === 'connector').map((i) => i.name)).toEqual(['Linear', 'Google Drive', 'Gmail', 'Google Calendar', 'Canva', 'Microsoft 365', 'Notion', 'Salesforce - Beta', 'Microsoft Learn', 'alphaXiv']);
  });

  it('joins by repository and path whatever the refs: official and community at different pins are one item', async () => {
    const items = await catalog();
    const crunch = named(items, '42crunch-api-security-testing');
    expect(crunch).toHaveLength(1); // official pins v1.5.5, community v1.0.1
    expect(crunch[0]).toMatchObject({ install: { marketplaceName: 'claude-plugins-official', pluginName: '42crunch-api-security-testing', ref: 'faf5305385de8afed9468904e8639be737aff39e', present: false }, alsoListedBy: ['claude-community'], reviewTier: 'partner' });
    expect(crunch[0]!.sources).toEqual(expect.arrayContaining(['directory:plugins', 'plugin-details', 'seed:claude-plugins-official', 'seed:claude-community']));
    // three sources, three names: the directory's display name, the install name, a third seed listing it
    const adobe = byId(items, 'github.com/adobe/skills#plugins/creative-cloud/adobe-for-creativity');
    expect(adobe).toMatchObject({ name: 'Adobe', installName: 'adobe-for-creativity', alsoListedBy: ['knowledge-work-plugins'] });
  });

  it('never joins by name: the two skill-creator plugins stay two; one marketplace’s entries at one place stay apart', async () => {
    const items = await catalog();
    expect(named(items, 'skill-creator').map((i) => i.id).sort()).toEqual(['github.com/aisa-one/skill-creator#', OFFICIAL('plugins/skill-creator')]);
    const skills = items.filter((i) => i.id.startsWith('github.com/anthropics/skills#?entry='));
    expect(skills.map((i) => i.name)).toEqual(['document-skills', 'example-skills', 'claude-api', 'academy-guide', 'discernment-nudge']);
    expect(byId(items, 'github.com/anthropics/skills#?entry=document-skills').components?.skills).toEqual(['xlsx', 'docx', 'pptx', 'pdf']);
  });

  it('chooses the route the engine already has, then claude-plugins-official, the seeds, the directory, community, an added one', async () => {
    const items = await catalog();
    // a marketplace the engine has (the recorded pins) comes before community's, which it would have to add
    expect(byId(items, 'github.com/aisa-one/skill-creator#')).toMatchObject({ install: { marketplaceName: 'maws-recorded-pins', present: true }, alsoListedBy: ['claude-community'], ownership: 'added' });
    // with the engine's directory on, its present entry wins over the official seed the engine has not added
    const engine = await recordedEngine(PROJECT_A);
    engine.available = [...engine.available!, { pluginId: 'frontend-design@anthropic-plugin-directory', name: 'frontend-design', marketplaceName: 'anthropic-plugin-directory', description: null, version: null, source: { kind: 'git-subdir', url: 'https://github.com/anthropics/claude-plugins-official', repo: null, path: 'plugins/frontend-design', ref: null, sha: '5'.repeat(40) }, installCount: null }];
    const withDirectory = await catalog({ engine });
    expect(byId(withDirectory, OFFICIAL('plugins/frontend-design'))).toMatchObject({ install: { marketplaceName: 'anthropic-plugin-directory', pluginName: 'frontend-design', present: true }, alsoListedBy: ['claude-plugins-official'], ownership: 'anthropic', installs: 1266133 });
    // without it, a directory plugin no seed lists is shown with its reason and no route
    expect(byId(items, 'github.com/agentmail-to/agentmail-plugins#').install).toEqual({ kind: 'manual', docsUrl: expect.any(String), reason: 'Not installable by this engine: Anthropic Directory is off in this engine' });
    expect(byId(items, 'github.com/maws-fixtures/no-reviewed-commit#').install).toMatchObject({ kind: 'manual', reason: 'Not installable by this engine: no reviewed commit' });
    expect(byId(items, 'github.com/maws-fixtures/failed-scan#').scanBlocked).toBe('Fixture: the scan found a component that sends data it does not declare.');
  });

  it('says installed here, elsewhere or not per cwd: a project install reads here in its project and elsewhere in another', async () => {
    const inA = await catalog({ engine: await recordedEngine(PROJECT_A) });
    const inB = await catalog({ engine: await recordedEngine(PROJECT_B) });
    expect(byId(inA, TEST('remote-server')).installed).toBe('here');
    expect(byId(inB, TEST('remote-server')).installed).toBe('elsewhere');
    expect(byId(inA, TEST('skills-only')).installed).toBe('here'); // user scope applies everywhere
    expect(byId(inB, TEST('skills-only')).installed).toBe('here');
    expect(byId(inB, TEST('hooked')).installed).toBe('no');
    // the Not installed filter hides it in A and keeps it in B
    const notInstalled = (items: CatalogItem[]) => queryOf(items, { tab: 'plugins', cwd: null, notInstalled: true, limit: 200 }, 'r').items.map((i) => i.id);
    expect(notInstalled(inA)).not.toContain(TEST('remote-server'));
    expect(notInstalled(inB)).toContain(TEST('remote-server'));
    // a connector is here when its name is configured for the cwd
    const linear = await catalog({ engine: await recordedEngine(PROJECT_A, { servers: ['linear'] }) });
    expect(named(linear, 'Linear')[0]!.installed).toBe('here');
  });

  it('knows an installed Anthropic Directory plugin by the source it was last listed with, and makes no card of one it never saw', async () => {
    const source = { kind: 'git-subdir', url: 'https://github.com/anthropics/claude-plugins-official', repo: null, path: 'plugins/frontend-design', ref: null, sha: '5'.repeat(40) };
    const engine = await recordedEngine(PROJECT_A);
    const row = { ...engine.installed![0]!, id: 'frontend-design@anthropic-plugin-directory', name: 'frontend-design', marketplace: 'anthropic-plugin-directory', scope: 'user', projectPath: null, here: false, coversHere: false };
    const unseen = { ...row, id: 'never-listed@anthropic-plugin-directory', name: 'never-listed' };
    const items = await catalog({ engine: { ...engine, installed: [...engine.installed!, row, unseen], directorySources: new Map([['frontend-design', source]]) } });
    expect(byId(items, OFFICIAL('plugins/frontend-design'))).toMatchObject({ installed: 'here', install: { marketplaceName: 'anthropic-plugin-directory', present: true } });
    expect(items.some((i) => i.name === 'never-listed')).toBe(false);
  });

  it('says whether an item runs code on the computer: a stdio server yes, a remote one no, unknown contents unknown', async () => {
    const items = await catalog();
    expect(byId(items, TEST('local-server'))).toMatchObject({ runsOnYourComputer: true, components: { mcpServers: [{ name: 'echo', transport: 'stdio' }] } });
    expect(byId(items, TEST('remote-server'))).toMatchObject({ runsOnYourComputer: false, components: { mcpServers: [{ name: 'fixture', transport: 'http' }] } });
    expect(byId(items, TEST('hooked'))).toMatchObject({ runsOnYourComputer: true, components: { hooks: true } });
    // a remote community entry the directory has never heard of
    expect(byId(items, 'github.com/qressy/10x-claude-plugin#')).toMatchObject({ components: null, runsOnYourComputer: 'unknown' });
    // the directory's own record with no components says nothing either
    expect(byId(items, 'github.com/mhgar/claude-simple-progress-bars#plugins/simple-progress-bars')).toMatchObject({ components: null, runsOnYourComputer: 'unknown' });
    expect(byId(items, OFFICIAL('external_plugins/playwright')).runsOnYourComputer).toBe(true); // its server runs on the computer
    expect(byId(items, OFFICIAL('external_plugins/github')).runsOnYourComputer).toBe(false); // its server sends data out
  });

  it('names the publisher: the directory’s, else the entry’s author, else the owner of the repository the code lives in', async () => {
    const items = await catalog();
    expect(byId(items, 'github.com/anthropics/claude-for-legal#commercial-legal').publisher).toBe('Anthropic'); // the manifest's author
    expect(byId(items, TEST('hooked')).publisher).toBe('MAWS e2e hooks');
    expect(byId(items, 'github.com/carta/plugins#plugins/carta-crm').publisher).toBe('Carta Engineering'); // the owner, its own code
    expect(byId(items, 'github.com/makenotion/claude-code-notion-plugin#').publisher).toBe('Notion Labs, Inc.'); // the owner's own repository
    // the owner does not publish what it only lists: community plugins, and the official marketplace's external plugins
    expect(byId(items, 'github.com/qressy/10x-claude-plugin#').publisher).toBeNull();
    expect(byId(items, OFFICIAL('external_plugins/github')).publisher).toBeNull();
    const network = recordedNetwork();
    network.plugins = network.plugins!.map((r) => (r.name === 'commercial-legal' || r.repository.endsWith('claude-for-legal') ? { ...r, publisher: 'A directory publisher' } : r));
    const withPublisher = buildCatalog({ network, engine: null, tests: [] });
    expect(byId(withPublisher, 'github.com/anthropics/claude-for-legal#commercial-legal').publisher).toBe('A directory publisher');
  });

  it('chooses object_acted_on: it covers the most plugins and servers of the five axes', () => {
    const coverage = axisCoverage(recordedNetwork());
    for (const axis of TAXONOMY_AXES.filter((a) => a !== 'object_acted_on')) {
      expect(coverage.plugins.object_acted_on, axis).toBeGreaterThan(coverage.plugins[axis]);
      expect(coverage.servers.object_acted_on, axis).toBeGreaterThan(coverage.servers[axis]);
    }
  });

  it('pages deterministically under one sort, a tie in `updated` included, in both directions', async () => {
    const items = await catalog();
    const official = items.filter((i) => i.alsoListedBy.includes('claude-plugins-official') || (i.install.kind === 'plugin' && i.install.marketplaceName === 'claude-plugins-official'));
    expect(new Set(official.map((i) => i.updatedAt)).size).toBeLessThan(official.length); // the recorded ties
    for (const reverse of [false, true]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = queryOf(items, { tab: 'plugins', cwd: null, sort: 'updated', reverse, cursor, limit: 7 }, 'r1');
        expect(page.restarted).toBe(false);
        expect(page.total).toBe(78);
        seen.push(...page.items.map((i) => i.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(seen).toHaveLength(78);
      expect(new Set(seen).size).toBe(78);
    }
    // ties fall to name then id: code-review, code-simplifier and claude-md-management share a date
    const tied = queryOf(items, { tab: 'plugins', cwd: null, sort: 'updated', limit: 200 }, 'r1').items.filter((i) => i.updatedAt === '2026-02-20T01:06:49Z');
    expect(tied.map((i) => i.name)).toEqual(['claude-md-management', 'code-review', 'code-simplifier']);
    // a cursor from another revision restarts the walk and says so
    const first = queryOf(items, { tab: 'plugins', cwd: null, limit: 5 }, 'r1');
    const moved = queryOf(items, { tab: 'plugins', cwd: null, limit: 5, cursor: first.nextCursor }, 'r2');
    expect(moved).toMatchObject({ restarted: true, items: first.items });
  });

  it('searches both names and the description, a name match first', async () => {
    const items = await catalog();
    const ids = (text: string) => queryOf(items, { tab: 'plugins', cwd: null, text, limit: 200 }, 'r').items.map((i) => i.name);
    expect(ids('Adobe')).toContain('Adobe');
    expect(ids('adobe-for-creativity')).toEqual(['Adobe']);
    const legal = queryOf(items, { tab: 'plugins', cwd: null, text: 'legal', limit: 200 }, 'r').items;
    const byName = legal.findIndex((i) => !`${i.name} ${i.installName ?? ''}`.toLowerCase().includes('legal'));
    expect(byName).toBe(12); // claude-for-legal's twelve with "legal" in the name, then those whose description says it
    expect(legal.slice(byName).every((i) => !`${i.name} ${i.installName ?? ''}`.toLowerCase().includes('legal') && i.description!.toLowerCase().includes('legal'))).toBe(true);
  });

  it('keeps the others when a source fails: without the directory, plugins come from the manifests and the engine, untiered', async () => {
    const items = await catalog({ omit: ['directory:plugins', 'directory:servers'] });
    expect(items.some((i) => i.kind === 'connector')).toBe(false);
    expect(items.every((i) => i.reviewTier === null)).toBe(true);
    expect(byId(items, OFFICIAL('plugins/frontend-design'))).toMatchObject({ name: 'frontend-design', installs: 1266133, categories: [] });
    const withoutDetails = await catalog({ omit: ['plugin-details'] });
    expect(byId(withoutDetails, OFFICIAL('plugins/frontend-design')).installs).toBeNull();
    expect(homeOf(withoutDetails, 'plugins').featured).toBeNull();
    // and with no engine at all, the network's items still stand
    expect((await catalog({ engine: null })).length).toBeGreaterThan(70);
  });
});

describe('an added marketplace', () => {
  it('that no other source knows yields author, skills and a stdio server’s runsOnYourComputer from the host’s read', async () => {
    const items = await catalog({ tests: false });
    expect(byId(items, TEST('skills-only'))).toMatchObject({ publisher: 'MAWS e2e skills', ownership: 'added', components: { skills: ['greet', 'summarize-diff'] }, install: { kind: 'plugin', present: true, marketplaceSource: '/scratch-root/maws-discover-test' } });
    expect(byId(items, TEST('local-server'))).toMatchObject({ publisher: 'MAWS e2e servers', runsOnYourComputer: true });
  });

  it('described by a test source yields the same before the engine has it, with the add step', async () => {
    const engine = await recordedEngine(PROJECT_A, { marketplaces: [], available: [], installed: [], manifests: new Map() });
    const items = await catalog({ engine });
    expect(byId(items, TEST('skills-only'))).toMatchObject({ publisher: 'MAWS e2e skills', ownership: 'added', components: { skills: ['greet', 'summarize-diff'] }, sources: ['test:maws-discover-test'], install: { kind: 'plugin', marketplaceName: 'maws-discover-test', marketplaceSource: '/scratch-root/maws-discover-test', present: false } });
    expect(byId(items, TEST('local-server')).runsOnYourComputer).toBe(true);
    expect(homeOf(items, 'plugins').shelves[0]).toMatchObject({ key: 'added', title: 'Your sources', total: 4 });
  });
});

describe('the home', () => {
  it('features the most-installed Anthropic-listed plugin not installed here, then the shelves in order, community on none', async () => {
    const items = await catalog();
    const home = homeOf(items, 'plugins');
    expect(home.featured?.name).toBe('frontend-design');
    expect(home.total).toBe(78);
    expect(home.shelves.map((s) => s.key)).toEqual([
      'added',
      'seed:claude-plugins-official',
      'seed:anthropic-agent-skills',
      'seed:claude-for-financial-services',
      'seed:knowledge-work-plugins',
      'seed:claude-for-legal',
      'seed:life-sciences',
      'seed:carta-plugins',
      ...home.shelves.filter((s) => s.kind === 'category').map((s) => s.key),
    ]);
    expect(home.shelves.filter((s) => s.kind === 'category')).toHaveLength(4);
    expect(categoryTitle('files-documents')).toBe('Files & documents');
    expect(categoryTitle('apis')).toBe('APIs');
    expect(categoryTitle('code')).toBe('Code');
    for (const s of home.shelves) expect(s.items.every((i) => (i.reviewTier ?? i.ownership) !== 'community'), s.key).toBe(true);
    const official = home.shelves.find((s) => s.key === 'seed:claude-plugins-official')!;
    expect(official.items.slice(0, 3).map((i) => i.name)).toEqual(['frontend-design', 'Superpowers', 'code-review']); // by installs
  });

  it('on Skills lists only items whose skills are known; on Connectors features the best rank not configured here', async () => {
    const items = await catalog();
    const skills = homeOf(items, 'skills');
    expect(queryOf(items, { tab: 'skills', cwd: null, limit: 200 }, 'r').items.every((i) => (i.components?.skills.length ?? 0) > 0)).toBe(true);
    expect(skills.featured?.components?.skills.length).toBeGreaterThan(0);
    expect(homeOf(items, 'connectors').featured?.name).toBe('Google Drive'); // popularity rank 1
    const configured = await catalog({ engine: await recordedEngine(PROJECT_A, { servers: ['google-drive-drivemcp'] }) });
    expect(homeOf(configured, 'connectors').featured?.name).toBe('Gmail');
  });

  it('filters a shelf’s See all by its source or category, removable', async () => {
    const items = await catalog();
    const fs = queryOf(items, { tab: 'plugins', cwd: null, source: 'seed:claude-for-financial-services', limit: 200 }, 'r');
    expect(fs.total).toBe(19);
    expect(queryOf(items, { tab: 'plugins', cwd: null, category: 'finances', limit: 200 }, 'r').items.every((i) => i.categories.includes('finances'))).toBe(true);
    expect(queryOf(items, { tab: 'plugins', cwd: null, chips: ['community'], limit: 200 }, 'r').items.every((i) => (i.reviewTier ?? i.ownership) === 'community')).toBe(true);
  });
});

describe('a connector’s route', () => {
  it('names a server as its own command does, else its slug, else its display name made engine-legal', async () => {
    const items = await catalog();
    expect(named(items, 'Linear')[0]).toMatchObject({ installName: 'linear', rank: 14, reviewTier: 'partner', install: { kind: 'connector', name: 'linear', url: 'https://mcp.linear.app/mcp', urlPattern: null, transport: 'http', authPosture: 'auth_required' } });
    expect(named(items, 'alphaXiv')[0]!.install).toMatchObject({ name: 'alphaxiv', transport: 'sse' });
    expect(named(items, 'Microsoft Learn')[0]!.install).toMatchObject({ authPosture: 'no_auth' });
    expect(named(items, 'Salesforce - Beta')[0]!.install).toMatchObject({ url: null, urlPattern: expect.stringContaining('salesforce') });
    expect(connectorName({ copyText: 'claude mcp add --transport http --scope user my_server https://x', slug: 'other', name: 'X' })).toBe('my_server');
    expect(connectorName({ copyText: null, slug: 'has space', name: 'Google Drive' })).toBe('google-drive');
    expect(connectorName({ copyText: null, slug: null, name: 'Salesforce - Beta' })).toBe('salesforce-beta');
  });
});

describe('the recorded sources parse whole', () => {
  it('drops and counts no recorded record', () => {
    for (const [key, source] of recordedSources()) expect(source.dropped, key).toBe(0);
  });
});
