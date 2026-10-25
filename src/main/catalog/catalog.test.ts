// P4-AGG M2: the catalog over M1's recordings (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M2
// "Proves"): the item count, the joins, route precedence, installed here versus elsewhere for two cwds,
// `runsOnYourComputer` for a stdio-only, a remote-only and an unknown item, the publisher chain, the category axis'
// coverage, deterministic pagination across a tie, a failed source leaving the others, an added marketplace no other
// source knows, and the test-source seam before the add.
import { describe, expect, it } from 'vitest';
import { CatalogItemSchema, type CatalogItem } from '@shared/ipc/schema/catalog';
import { PROJECT_A, PROJECT_B, recordedEngine, recordedNetwork, recordedSources, testSourceData } from '../../../test/support/catalog-inputs';
import { buildCatalog } from './join';
import { connectorName, knownFromEntry, type EngineView } from './normalize';
import { categoryTitle, homeOf, queryOf } from './query';
import { networkData, parseSource, TAXONOMY_AXES } from './records';
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
  it('holds one valid item per thing: 77 plugins and 10 Claude Code connectors', async () => {
    const items = await catalog();
    for (const item of items) expect(CatalogItemSchema.safeParse(item).success, item.id).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    // 12 seeds' 69 entries, 61 directory records, 4 test-marketplace and 3 recorded-pin entries, joined: 77 plugins.
    // The servers' 12 records less the local desktop extension and the one not made for Claude Code: 10 connectors.
    expect(items.filter((i) => i.kind === 'plugin')).toHaveLength(77);
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

  it('tells entries at one place apart in every source: the directory’s document-skills joins the seed entry of that name', async () => {
    const items = await catalog();
    expect(named(items, 'document-skills')).toHaveLength(1);
    const documents = byId(items, 'github.com/anthropics/skills#?entry=document-skills');
    // the route from the seed, the tier from the directory; what is installed is the entry's four skills, not the
    // nineteen the directory's record finds in the whole repository
    expect(documents).toMatchObject({ reviewTier: 'anthropic', install: { kind: 'plugin', marketplaceName: 'anthropic-agent-skills', pluginName: 'document-skills' }, components: { skills: ['xlsx', 'docx', 'pptx', 'pdf'] } });
    expect(documents.sources).toEqual(expect.arrayContaining(['directory:plugins', 'seed:anthropic-agent-skills']));
    // the engine's directory entry at that place joins it too, by the engine's own entry name
    const engine = await recordedEngine(PROJECT_A);
    engine.available = [...engine.available!, { pluginId: 'document-skills@anthropic-plugin-directory', name: 'document-skills', marketplaceName: 'anthropic-plugin-directory', description: null, version: null, source: { kind: 'url', url: 'https://github.com/anthropics/skills.git', repo: null, path: null, ref: null, sha: '3'.repeat(40) }, installCount: null }];
    const withDirectory = await catalog({ engine });
    expect(named(withDirectory, 'document-skills')).toHaveLength(1);
    const viaDirectory = byId(withDirectory, 'github.com/anthropics/skills#?entry=document-skills');
    expect(viaDirectory).toMatchObject({ install: { marketplaceName: 'anthropic-plugin-directory' }, alsoListedBy: ['anthropic-agent-skills'] });
    // the directory's route installs the whole repository: its contents are the directory record's nineteen, never the
    // seed entry's four borrowed from another route
    expect(viaDirectory.components?.skills).toHaveLength(19);
    expect(viaDirectory.components?.skills).toEqual(expect.arrayContaining(['xlsx', 'algorithmic-art', 'webapp-testing']));
  });

  it('never borrows another route’s contents unless it installs the same bundle', async () => {
    // claude-for-legal's commercial-legal: the seed's strict entry says nothing of its contents, the directory's record
    // describes the same place, so the record stands for the route
    const items = await catalog();
    const legal = byId(items, 'github.com/anthropics/claude-for-legal#commercial-legal');
    expect(legal.install).toMatchObject({ marketplaceName: 'claude-for-legal' });
    expect(legal.components).not.toBeNull();
    // example-skills, routed through the seed, keeps its own twelve declared skills; no route at the place borrows them
    expect(byId(items, 'github.com/anthropics/skills#?entry=example-skills').components?.skills).toHaveLength(12);
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

  it('knows an installed Anthropic Directory plugin by the repository the engine recorded for it, after a restart too', async () => {
    const engine = await recordedEngine(PROJECT_A);
    const row = { ...engine.installed![0]!, id: 'frontend-design@anthropic-plugin-directory', name: 'frontend-design', marketplace: 'anthropic-plugin-directory', scope: 'user', projectPath: null, here: false, coversHere: false };
    const unseen = { ...row, id: 'never-recorded@anthropic-plugin-directory', name: 'never-recorded' };
    // a cold start: the available listing omits it (installed), and only the engine's own record of it names its code
    const items = await catalog({ engine: { ...engine, installed: [...engine.installed!, row, unseen], directoryInstalled: new Map([['frontend-design', 'github.com/anthropics/claude-plugins-official#plugins/frontend-design']]) } });
    expect(byId(items, OFFICIAL('plugins/frontend-design'))).toMatchObject({ installed: 'here', install: { marketplaceName: 'anthropic-plugin-directory', pluginName: 'frontend-design', present: true }, alsoListedBy: ['claude-plugins-official'] });
    expect(items.some((i) => i.name === 'never-recorded')).toBe(false); // no name join: My items shows it
  });

  it('keeps an installed item’s route, whatever ranks first: installed from community, it is not offered from official', async () => {
    const engine = await recordedEngine(PROJECT_A);
    const official = { name: 'claude-plugins-official', source: 'github', locator: 'anthropics/claude-plugins-official', ref: null, installLocation: '/scratch-root/config/plugins/marketplaces/claude-plugins-official' };
    const community = { ...official, name: 'claude-community', locator: 'anthropics/claude-plugins-community', installLocation: '/scratch-root/config/plugins/marketplaces/claude-community' };
    const row = { ...engine.installed![0]!, id: '42crunch-api-security-testing@claude-community', name: '42crunch-api-security-testing', marketplace: 'claude-community', scope: 'user', projectPath: null, here: false, coversHere: false };
    const read = { state: 'read' as const, owner: 'Anthropic', plugins: [{ name: '42crunch-api-security-testing', author: null, description: null, source: { kind: 'git-subdir' as const, url: '42Crunch-AI/claude-plugins', repo: null, path: 'plugins/api-security-testing', ref: 'v1.0.1', sha: '30287f5e3f122a646d1ac5ca3ab96e130c52a3ad' }, components: null, partial: false, problems: [] }] };
    const items = await catalog({ engine: { ...engine, marketplaces: [...engine.marketplaces!, official, community], manifests: new Map([...engine.manifests, ['claude-community', read]]), installed: [...engine.installed!, row] } });
    expect(named(items, '42crunch-api-security-testing')[0]).toMatchObject({ installed: 'here', install: { marketplaceName: 'claude-community', present: true }, alsoListedBy: ['claude-plugins-official'] });
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

  it('never says no from a partial inventory: unknown, unless what was read already runs code', async () => {
    const tests = await testSourceData();
    const partial = (name: string, change: (c: NonNullable<(typeof tests.manifest.plugins)[number]['components']>) => void) => {
      const plugin = tests.manifest.plugins.find((p) => p.name === name)!;
      change(plugin.components!);
      plugin.partial = true;
      plugin.problems = ['hooks/hooks.json: too large'];
    };
    partial('hooked', (c) => (c.hooks = []));
    partial('local-server', () => {});
    const engine = await recordedEngine(PROJECT_A, { marketplaces: [], available: [], installed: [], manifests: new Map() });
    const items = buildCatalog({ network: recordedNetwork(), engine, tests: [tests] });
    expect(byId(items, TEST('hooked')).runsOnYourComputer).toBe('unknown');
    expect(byId(items, TEST('local-server')).runsOnYourComputer).toBe(true);
    expect(byId(items, TEST('skills-only')).runsOnYourComputer).toBe(false); // read whole
  });

  it('names the publisher: the directory’s, else the entry’s author, else the seed’s organisation for its own code', async () => {
    const items = await catalog();
    expect(byId(items, 'github.com/anthropics/claude-for-legal#commercial-legal').publisher).toBe('Anthropic'); // the manifest's author
    expect(byId(items, TEST('hooked')).publisher).toBe('MAWS e2e hooks');
    expect(byId(items, 'github.com/carta/plugins#plugins/carta-crm').publisher).toBe('Carta'); // the seed's organisation, its own code
    expect(byId(items, 'github.com/makenotion/claude-code-notion-plugin#').publisher).toBe('Notion'); // the seed's own repository
    // a person as the manifest's owner is not who publishes Anthropic's skills
    expect(byId(items, 'github.com/anthropics/skills#?entry=example-skills').publisher).toBe('Anthropic');
    // so with the engine holding that seed's clone, read by the host
    const engine = await recordedEngine(PROJECT_A);
    const skillsClone = { name: 'anthropic-agent-skills', source: 'github', locator: 'anthropics/skills', ref: null, installLocation: '/scratch-root/config/plugins/marketplaces/anthropic-agent-skills' };
    const read = { state: 'read' as const, owner: 'Keith Lazuka', plugins: ['document-skills', 'example-skills'].map((name) => ({ name, author: null, description: null, source: './', components: null, partial: false, problems: [] })) };
    const held = await catalog({ engine: { ...engine, marketplaces: [...engine.marketplaces!, skillsClone], manifests: new Map([...engine.manifests, ['anthropic-agent-skills', read]]) } });
    expect(byId(held, 'github.com/anthropics/skills#?entry=example-skills').publisher).toBe('Anthropic');
    // an added marketplace's owner stands in for its own entries
    const owned = await testSourceData();
    owned.manifest.plugins.find((p) => p.name === 'skills-only')!.author = null;
    expect(byId(buildCatalog({ network: recordedNetwork(), engine: null, tests: [owned] }), TEST('skills-only')).publisher).toBe('MAWS e2e');
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
        expect(page.total).toBe(77);
        seen.push(...page.items.map((i) => i.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(seen).toHaveLength(77);
      expect(new Set(seen).size).toBe(77);
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
    expect(byId(items, TEST('skills-only'))).toMatchObject({ publisher: 'MAWS e2e skills', description: 'A plugin carrying two skills and nothing else.', ownership: 'added', components: { skills: ['greet', 'summarize-diff'] }, install: { kind: 'plugin', present: true, marketplaceSource: '/scratch-root/maws-discover-test' } });
    expect(byId(items, TEST('local-server'))).toMatchObject({ publisher: 'MAWS e2e servers', runsOnYourComputer: true });
  });

  it('described by a test source yields the same before the engine has it, with the add step', async () => {
    const engine = await recordedEngine(PROJECT_A, { marketplaces: [], available: [], installed: [], manifests: new Map() });
    const items = await catalog({ engine });
    expect(byId(items, TEST('skills-only'))).toMatchObject({ publisher: 'MAWS e2e skills', description: 'A plugin carrying two skills and nothing else.', ownership: 'added', components: { skills: ['greet', 'summarize-diff'] }, sources: ['test:maws-discover-test'], install: { kind: 'plugin', marketplaceName: 'maws-discover-test', marketplaceSource: '/scratch-root/maws-discover-test', present: false } });
    expect(byId(items, TEST('local-server')).runsOnYourComputer).toBe(true);
    expect(homeOf(items, 'plugins').shelves[0]).toMatchObject({ key: 'added', title: 'Your sources', total: 4 });
  });
});

describe('the home', () => {
  it('features the most-installed Anthropic-listed plugin not installed here, then the shelves in order, community on none', async () => {
    const items = await catalog();
    const home = homeOf(items, 'plugins');
    expect(home.featured?.name).toBe('frontend-design');
    expect(home.total).toBe(77);
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

  it('lists every category of the tab for the Category filter, by count, each with its title and its count over the whole tab', async () => {
    const items = await catalog();
    const { categories } = homeOf(items, 'plugins');
    expect(categories.length).toBeGreaterThan(4);
    for (const c of categories) expect(c).toEqual({ value: c.value, title: categoryTitle(c.value), total: queryOf(items, { tab: 'plugins', cwd: null, category: c.value, limit: 1 }, 'r').total });
    expect(categories.map((c) => c.total)).toEqual([...categories.map((c) => c.total)].sort((a, b) => b - a));
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

  it('offers a server’s fixed choice of URLs; one with no URL, pattern or choice is not a connector', () => {
    const server = (remote: Record<string, unknown>) => ({ id: `s-${Object.keys(remote).join('-')}`, type: 'remote', name: 'Regional', display_name: 'Regional', works_with: ['claude-code'], remote: { transport: 'streamable-http', auth_posture: 'auth_required', ...remote } });
    const parsed = parseSource('directory:servers', [{ servers: [server({ url: null, url_regex: null, url_options: [{ url: 'https://eu.example.com/mcp', label: 'EU', description: 'Data in the EU' }, { url: 'https://us.example.com/mcp', label: 'US' }, { label: 'no url' }] }), server({ url: '', url_regex: '' })], next_cursor: null }]);
    const items = buildCatalog({ network: networkData(new Map([['directory:servers', parsed]])), engine: null, tests: [] });
    expect(items).toHaveLength(1);
    expect(items[0]!.install).toEqual({ kind: 'connector', name: 'regional', url: null, urlPattern: null, urlOptions: [{ url: 'https://eu.example.com/mcp', label: 'EU', description: 'Data in the EU' }, { url: 'https://us.example.com/mcp', label: 'US', description: null }], transport: 'http', authPosture: 'auth_required' });
  });
});

describe('the recorded sources parse whole', () => {
  it('drops and counts no recorded record', () => {
    for (const [key, source] of recordedSources()) expect(source.dropped, key).toBe(0);
  });
});

// The branch review panel's findings on the catalog (panel-discover.json: scalpel-1#1 to #4).
describe('what a card claims, from the route it installs', () => {
  const COMPONENTS = { mcpServers: [], mcpBundles: 0, agents: [], hooks: [], hookModules: 0, monitors: [], lspServers: [], commands: [], skills: [{ name: 'frontend-design', description: null }] };
  const clone = (name: string, locator: string) => ({ name, source: 'github', locator, ref: null, installLocation: `/scratch-root/config/plugins/marketplaces/${name}` });

  it('keeps the hooks and the runs-code warning the selected clone shows, whatever the directory record says (scalpel-1#1)', async () => {
    const engine = await recordedEngine(PROJECT_A);
    const read = { state: 'read' as const, owner: 'Anthropic', plugins: [{ name: 'frontend-design', author: null, description: null, source: './plugins/frontend-design', components: { ...COMPONENTS, hooks: [{ event: 'SessionStart', matcher: null }] }, partial: false, problems: [] }] };
    const items = await catalog({ engine: { ...engine, marketplaces: [...engine.marketplaces!, clone('claude-plugins-official', 'anthropics/claude-plugins-official')], manifests: new Map([...engine.manifests, ['claude-plugins-official', read]]) } });
    const design = byId(items, OFFICIAL('plugins/frontend-design'));
    expect(design.install).toMatchObject({ marketplaceName: 'claude-plugins-official', present: true });
    expect(design).toMatchObject({ runsOnYourComputer: true, components: { hooks: true }, reviewTier: 'anthropic' }); // the record still gives the tier
  });

  it('gives a seed’s ownership and shelf only to the seed’s own repository (scalpel-1#2)', async () => {
    const engine = await recordedEngine(PROJECT_A);
    const read = { state: 'read' as const, owner: 'Acme', plugins: [{ name: 'unrelated', author: null, description: null, source: './plugins/unrelated', components: COMPONENTS, partial: false, problems: [] }] };
    const items = await catalog({ engine: { ...engine, marketplaces: [...engine.marketplaces!, clone('k12-teacher-skills', 'acme/unrelated')], manifests: new Map([...engine.manifests, ['k12-teacher-skills', read]]) } });
    const unrelated = byId(items, 'github.com/acme/unrelated#plugins/unrelated');
    expect(unrelated).toMatchObject({ ownership: 'added', publisher: 'Acme', install: { marketplaceName: 'k12-teacher-skills', present: true } });
    const ids = (source: string) => queryOf(items, { tab: 'plugins', cwd: null, source, limit: 200 }, 'r').items.map((i) => i.id);
    expect(ids('added')).toContain(unrelated.id);
    expect(ids('seed:k12-teacher-skills')).not.toContain(unrelated.id);
  });

  it('counts array-valued MCP declarations before saying a strict:false entry runs no code (scalpel-1#3)', () => {
    const entry = (mcpServers: unknown) => ({ name: 'e', description: null, author: null, source: './', strict: false, declared: { skills: undefined, mcpServers, hooks: undefined, commands: undefined, agents: undefined }, homepage: null });
    expect(knownFromEntry(entry([{ local: { command: 'node' } }, { remote: { type: 'http', url: 'https://x' } }]))).toEqual({ components: expect.objectContaining({ mcpServers: [{ name: 'local', transport: 'stdio' }, { name: 'remote', transport: 'http' }] }), runs: true });
    expect(knownFromEntry(entry(['./mcp.json']))?.runs).toBe('unknown'); // a configuration file the entry names: unread
    expect(knownFromEntry(entry([{ remote: { type: 'http', url: 'https://x' } }]))?.runs).toBe(false);
  });

  it('never names the marketplace as publisher of other publishers’ code, however its source is written (scalpel-1#4)', () => {
    const network = recordedNetwork();
    const official = network.seeds.get('seed:claude-plugins-official')!;
    const vendor = (name: string, source: unknown) => ({ name, description: null, author: null, source, strict: true, declared: { skills: undefined, mcpServers: undefined, hooks: undefined, commands: undefined, agents: undefined }, homepage: null });
    official.entries.records.push(
      vendor('vendor-object', { kind: 'github', url: null, repo: 'anthropics/claude-plugins-official', path: 'external_plugins/vendor-object', ref: null, sha: null }) as never,
      vendor('vendor-dotted', './plugins/../external_plugins/vendor-dotted') as never,
      vendor('own-object', { kind: 'github', url: null, repo: 'anthropics/claude-plugins-official', path: 'plugins/own-object', ref: null, sha: null }) as never,
    );
    const items = buildCatalog({ network, engine: null, tests: [] });
    expect(byId(items, OFFICIAL('external_plugins/vendor-object')).publisher).toBeNull();
    expect(byId(items, OFFICIAL('external_plugins/vendor-dotted')).publisher).toBeNull();
    expect(byId(items, OFFICIAL('plugins/own-object')).publisher).toBe('Anthropic');
  });
});
