// The library's model (P2-B execution document §5.4): which identities My items lists and where, the representative
// installation, the row's words, and the view's search, filter and sort, over hand-built rows shaped as the host answers
// them (M2's `here`/`coversHere` computed through realpaths, so plain booleans here).
import { describe, expect, it } from 'vitest';
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import type { InstalledPlugin, PluginManifestView } from '@shared/ipc/schema/plugins';
import { dateWords, displayNameOf, groupOfMarketplace, identitiesOf, isNew, loadedOnly, manifestKeyOf, myItems, representativeOf, versionWords, type PluginIdentity } from './library';

const HERE = '/work/maws';
const NOW = Date.parse('2026-10-09T12:00:00');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const inst = (id: string, over: Partial<InstalledPlugin> = {}): InstalledPlugin => {
  const [name, marketplace] = id.split('@');
  return { id, name, marketplace, version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `/cfg/plugins/cache/${marketplace}/${name}/1.0.0`, errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false, ...over };
};
const project = (id: string, projectPath: string, over: Partial<InstalledPlugin> = {}) => inst(id, { scope: 'project', projectPath, here: projectPath === HERE, coversHere: projectPath === HERE, ...over });
const market = (name: string, source: string, locator: string | null): Marketplace => ({ name, source, locator, installLocation: `/cfg/plugins/marketplaces/${name}`, ref: null });

const OFFICIAL = market('claude-plugins-official', 'github', 'anthropics/claude-plugins-official');
const COMMUNITY = market('claude-community', 'github', 'anthropics/claude-plugins-community');
const FORK = market('claude-plugins-official', 'github', 'someone/claude-plugins-official');
const MINE = market('doperpowers', 'directory', '/Users/me/doperpowers');
const MARKETS = [OFFICIAL, COMMUNITY, MINE];

const view = (key: PluginManifestView['key'], over: Partial<PluginManifestView> = {}): PluginManifestView => ({
  key,
  state: 'read',
  name: null,
  displayName: null,
  version: null,
  marketplaceVersion: null,
  description: null,
  author: null,
  license: null,
  keywords: [],
  components: { mcpServers: [], mcpBundles: 0, agents: [], hooks: [], hookModules: 0, monitors: [], lspServers: [], commands: [], skills: [] },
  partial: false,
  problems: [],
  ...over,
});
const keyOf = (p: InstalledPlugin) => ({ kind: 'installation' as const, id: p.id, scope: p.scope, projectPath: p.projectPath });
const NO_VIEWS = new Map<string, PluginManifestView>();
const ids = (identities: readonly PluginIdentity[]) => identities.map((i) => i.id);
const groupOf = (identities: readonly PluginIdentity[], id: string) => identities.find((i) => i.id === id)?.group;

describe('the library model: groups', () => {
  it('Anthropic & Partners is the official repository by repo or GitHub URL, and the built-in directory; never the community one or a fork', () => {
    expect(groupOfMarketplace('claude-plugins-official', [OFFICIAL])).toBe('anthropic');
    for (const locator of ['https://github.com/anthropics/claude-plugins-official', 'https://github.com/anthropics/claude-plugins-official.git']) {
      expect(groupOfMarketplace('claude-plugins-official', [market('claude-plugins-official', 'git', locator)])).toBe('anthropic');
    }
    expect(groupOfMarketplace('anthropic-plugin-directory', [])).toBe('anthropic'); // the engine lists no row for it
    expect(groupOfMarketplace('claude-community', [COMMUNITY])).toBe('added');
    expect(groupOfMarketplace('claude-plugins-official', [FORK])).toBe('added');
    expect(groupOfMarketplace('claude-plugins-official', [])).toBe('added'); // by its repository, never by a name alone
    expect(groupOfMarketplace('doperpowers', MARKETS)).toBe('added');
  });

  it('places each identity by Desktop’s priority: this project, created by you, synced, Anthropic, marketplaces you added', () => {
    const identities = identitiesOf(
      [
        inst('code-review@claude-plugins-official'),
        project('frontend-design@claude-plugins-official', HERE),
        project('doperpowers@doperpowers', '/work', { here: false, coversHere: true }), // a parent project covers this worktree
        inst('chatgpt-advisor@skills-dir'),
        inst('folder-thing@inline', { scope: 'session' }),
        inst('cloud@claude-ai', { scope: 'synced' }),
        inst('eli5@claude-community'),
        inst('ptc@doperpowers'),
      ],
      MARKETS,
      NO_VIEWS,
      null,
    );
    expect(groupOf(identities, 'code-review@claude-plugins-official')).toBe('anthropic');
    expect(groupOf(identities, 'frontend-design@claude-plugins-official')).toBe('here');
    expect(groupOf(identities, 'doperpowers@doperpowers')).toBe('here');
    expect(groupOf(identities, 'chatgpt-advisor@skills-dir')).toBe('yours');
    expect(groupOf(identities, 'folder-thing@inline')).toBe('yours');
    expect(groupOf(identities, 'cloud@claude-ai')).toBe('synced');
    expect(groupOf(identities, 'eli5@claude-community')).toBe('added');
    expect(groupOf(identities, 'ptc@doperpowers')).toBe('added');
  });

  it('a plugin this project enables whose records are only in sibling worktrees is in this project, read-only', () => {
    const [identity] = identitiesOf([project('supabase@claude-plugins-official', '/work/maws-wt-1', { projectEnabled: true, enabled: true }), project('supabase@claude-plugins-official', '/work/maws-wt-2', { projectEnabled: true, enabled: true })], MARKETS, NO_VIEWS, null);
    expect(identity.group).toBe('here');
    expect(identity.actionable).toEqual([]);
    expect(identity.enabledHere).toBe(true);
  });

  it('a plugin installed only for other projects and not enabled here is listed under no group; loaded here, it is listed', () => {
    const rows = [project('supabase@claude-plugins-official', '/work/other', { enabled: false })];
    expect(identitiesOf(rows, MARKETS, NO_VIEWS, null)[0].group).toBeNull();
    expect(identitiesOf(rows, MARKETS, NO_VIEWS, new Set(['supabase@claude-plugins-official']))[0].group).toBe('anthropic');
    // enabled here through a setting that is not the project's: still relevant, grouped by its marketplace
    expect(identitiesOf([project('supabase@claude-plugins-official', '/work/other', { enabled: true })], MARKETS, NO_VIEWS, null)[0].group).toBe('anthropic');
  });

  it('enabled here is the CLI’s effective enabled alone: a project that enables a plugin its local settings turn off reads Disabled, still in this project (U3 F1)', () => {
    // the project's settings enable it (`projectEnabled`), a local override disables it: the CLI's effective `enabled` is false
    const [identity] = identitiesOf([project('frontend-design@claude-plugins-official', HERE, { projectEnabled: true, enabled: false })], MARKETS, NO_VIEWS, null);
    expect(identity.enabledHere).toBe(false);
    expect(identity.group).toBe('here');
    const base = { search: '', sort: 'updated' as const, loadedIds: null };
    expect(myItems([identity], { ...base, filter: 'disabled' }).flatMap((g) => ids(g.rows))).toEqual(['frontend-design@claude-plugins-official']);
    expect(myItems([identity], { ...base, filter: 'enabled' }).flatMap((g) => ids(g.rows))).toEqual([]);
    // records only in sibling worktrees, enabled by the project but off here: listed in this project, disabled
    const [sibling] = identitiesOf([project('supabase@claude-plugins-official', '/work/maws-wt-1', { projectEnabled: true, enabled: false })], MARKETS, NO_VIEWS, null);
    expect(sibling.group).toBe('here');
    expect(sibling.enabledHere).toBe(false);
  });

  it('draws one identity for 47 installations of one id', () => {
    const rows = [project('doperpowers@doperpowers', HERE), ...Array.from({ length: 45 }, (_, i) => project('doperpowers@doperpowers', `${HERE}/.claude/worktrees/wt-${i}`, { coversHere: false })), project('doperpowers@doperpowers', '/elsewhere')];
    const identities = identitiesOf(rows, MARKETS, NO_VIEWS, null);
    expect(identities).toHaveLength(1);
    expect(identities[0].installations).toHaveLength(47);
    expect(identities[0].representative.projectPath).toBe(HERE);
    expect(identities[0].actionable.map((i) => i.projectPath)).toEqual([HERE]);
  });
});

describe('the library model: the representative installation', () => {
  it('prefers the narrowest installation here, then the user’s, then one covering here, then a pseudo-scope one, then the latest other', () => {
    const other = project('x@m', '/a', { lastUpdated: ago(9) });
    const latest = project('x@m', '/b', { lastUpdated: ago(1) });
    const covering = project('x@m', '/work', { here: false, coversHere: true });
    const pseudo = inst('x@m', { scope: 'session' });
    const user = inst('x@m');
    const shared = project('x@m', HERE);
    const local = inst('x@m', { scope: 'local', projectPath: HERE, here: true, coversHere: true });
    const all = [other, latest, covering, pseudo, user, shared, local];
    expect(representativeOf(all)).toBe(local);
    expect(representativeOf(all.filter((p) => p !== local))).toBe(shared);
    expect(representativeOf([other, latest, covering, pseudo, user])).toBe(user);
    expect(representativeOf([other, latest, covering, pseudo])).toBe(covering);
    expect(representativeOf([other, latest, pseudo])).toBe(pseudo);
    expect(representativeOf([other, latest])).toBe(latest);
  });

  it('acts only on an installation here or the user’s', () => {
    const [identity] = identitiesOf([inst('x@m'), project('x@m', HERE), project('x@m', '/work', { here: false, coversHere: true }), project('x@m', '/a')], MARKETS, NO_VIEWS, null);
    expect(identity.actionable.map((i) => i.scope)).toEqual(['user', 'project']);
    expect(identity.actionable.every((i) => i.scope === 'user' || i.projectPath === HERE)).toBe(true);
  });
});

describe('the library model: pseudo-scope installations are never actionable', () => {
  it('a skills-directory plugin offers no change at user or project scope, even one here (U3 F1)', () => {
    const user = inst('chatgpt-advisor@skills-dir');
    const here = project('chatgpt-advisor@skills-dir', HERE);
    for (const installation of [user, here]) {
      const [identity] = identitiesOf([installation], MARKETS, NO_VIEWS, null);
      expect(identity.actionable).toEqual([]);
      expect(identity.group).toBe(installation.scope === 'project' ? 'here' : 'yours');
    }
  });

  it('a session folder or a claude.ai sync offers no change', () => {
    for (const scope of ['session', 'synced']) {
      const [identity] = identitiesOf([inst('x@m', { scope, here: true, coversHere: true })], MARKETS, NO_VIEWS, null);
      expect(identity.actionable).toEqual([]);
    }
  });
});

describe('the library model: the row’s words', () => {
  it('names a plugin by its manifest’s display name, else Desktop’s rule', () => {
    expect(displayNameOf('code-review', null)).toBe('Code review');
    expect(displayNameOf('typescript-lsp', null)).toBe('Typescript lsp');
    expect(displayNameOf('ptc', null)).toBe('Ptc');
    const p = inst('code-review@claude-plugins-official');
    expect(displayNameOf('code-review', view(keyOf(p), { displayName: 'Code Review Pro' }))).toBe('Code Review Pro');
    expect(displayNameOf('code-review', view(keyOf(p), { state: 'unknown', displayName: null }))).toBe('Code review');
  });

  it('marks New within 14 days of the last update and not at 15', () => {
    expect(isNew(ago(14), NOW)).toBe(true);
    expect(isNew(ago(15), NOW)).toBe(false);
    expect(isNew(ago(0), NOW)).toBe(true);
    expect(isNew(new Date(NOW + DAY).toISOString(), NOW)).toBe(false); // a clock ahead of ours is not New
    expect(isNew(null, NOW)).toBe(false);
  });

  it('dates relative under a week, then the month and day, the year added when it is not this year', () => {
    expect(dateWords(ago(3), NOW)?.text).toBe('3 days ago');
    expect(dateWords(ago(6.9), NOW)?.text).toBe('6 days ago');
    expect(dateWords(ago(7), NOW)?.text).toBe('Oct 2');
    expect(dateWords('2025-10-03T12:00:00', NOW)?.text).toBe('Oct 3, 2025');
    expect(dateWords(ago(3), NOW)?.title).toMatch(/Oct 6, 2026/); // the full date and time in the tooltip
    expect(dateWords(null, NOW)).toBeNull();
    expect(dateWords('not a date', NOW)).toBeNull();
  });

  it('shows a version only when the engine reports a real one, a commit prefix as it is', () => {
    expect(versionWords('1.2.0')).toBe('1.2.0');
    expect(versionWords('a1b2c3d4e5f6')).toBe('a1b2c3d4e5f6');
    expect(versionWords('unknown')).toBeNull();
    expect(versionWords('')).toBeNull();
    expect(versionWords(null)).toBeNull();
  });

  it('carries the representative installation’s manifest view, keyed as the request keys it', () => {
    const p = project('frontend-design@claude-plugins-official', HERE);
    const manifests = new Map([[manifestKeyOf(keyOf(p)), view(keyOf(p), { author: 'Anthropic', description: 'Distinctive interfaces' })]]);
    const [identity] = identitiesOf([inst('frontend-design@claude-plugins-official', { scope: 'user' }), p], MARKETS, manifests, null);
    expect(identity.representative).toBe(p);
    expect(identity.manifest?.author).toBe('Anthropic');
  });
});

describe('the library model: the view', () => {
  const rows = [
    inst('code-review@claude-plugins-official', { lastUpdated: ago(2) }),
    project('frontend-design@claude-plugins-official', HERE, { lastUpdated: ago(20) }),
    inst('eli5@claude-community', { lastUpdated: ago(1), enabled: false }),
    inst('ptc@doperpowers', { lastUpdated: null }),
    inst('designer@doperpowers', { lastUpdated: ago(5) }),
    project('supabase@claude-plugins-official', '/work/other', { enabled: false, lastUpdated: ago(3) }),
  ];
  const manifests = new Map([[manifestKeyOf(keyOf(rows[2])), view(keyOf(rows[2]), { author: 'Kim', description: 'Explain like I am five' })]]);
  const identities = identitiesOf(rows, MARKETS, manifests, null);
  const base = { search: '', filter: 'all' as const, sort: 'updated' as const, loadedIds: null };

  it('lists the relevant groups in Desktop’s order, newest first within each, undated last, other projects left out', () => {
    expect(myItems(identities, base).map((g) => [g.group, ids(g.rows)])).toEqual([
      ['here', ['frontend-design@claude-plugins-official']],
      ['anthropic', ['code-review@claude-plugins-official']],
      ['added', ['eli5@claude-community', 'designer@doperpowers', 'ptc@doperpowers']],
    ]);
  });

  it('keeps an empty In this project in the default view only', () => {
    const elsewhere = identitiesOf([inst('code-review@claude-plugins-official')], MARKETS, NO_VIEWS, null);
    expect(myItems(elsewhere, base).map((g) => g.group)).toEqual(['here', 'anthropic']);
    expect(myItems(elsewhere, base)[0].rows).toEqual([]);
    expect(myItems(elsewhere, { ...base, sort: 'name' }).map((g) => g.group)).toEqual([null]);
    expect(myItems(elsewhere, { ...base, filter: 'enabled' }).map((g) => g.group)).toEqual(['anthropic']);
    expect(myItems(elsewhere, { ...base, search: 'code' }).map((g) => g.group)).toEqual(['anthropic']);
    // nothing relevant here at all: the default view still says so under its heading; Name, unfiltered, says it in its
    // one list; only a filter or a search finds nothing
    const otherOnly = identitiesOf([project('supabase@claude-plugins-official', '/work/other', { enabled: false })], MARKETS, NO_VIEWS, null);
    expect(myItems(otherOnly, base)).toEqual([{ group: 'here', rows: [] }]);
    expect(myItems(otherOnly, { ...base, sort: 'name' })).toEqual([{ group: null, rows: [] }]);
    expect(myItems(otherOnly, { ...base, filter: 'enabled' })).toEqual([]);
    expect(myItems(otherOnly, { ...base, search: 'supa' })).toEqual([]);
    expect(myItems(otherOnly, { ...base, sort: 'name', search: 'supa' })).toEqual([]);
  });

  it('Name flattens the groups into one list by display name', () => {
    expect(myItems(identities, { ...base, sort: 'name' }).map((g) => [g.group, ids(g.rows)])).toEqual([[null, ['code-review@claude-plugins-official', 'designer@doperpowers', 'eli5@claude-community', 'frontend-design@claude-plugins-official', 'ptc@doperpowers']]]);
  });

  it('searches the display name, the id, the author and the description, ignoring case', () => {
    const found = (search: string) => myItems(identities, { ...base, search }).flatMap((g) => ids(g.rows));
    expect(found('FRONTEND design')).toEqual(['frontend-design@claude-plugins-official']);
    expect(found('@claude-community')).toEqual(['eli5@claude-community']);
    expect(found('kim')).toEqual(['eli5@claude-community']);
    expect(found('like i am')).toEqual(['eli5@claude-community']);
    expect(found('nothing like this')).toEqual([]);
  });

  it('filters by enabled, disabled, loaded in this session and other projects', () => {
    const shown = (filter: 'enabled' | 'disabled' | 'loaded' | 'otherProjects', loadedIds: ReadonlySet<string> | null = null) => myItems(identities, { ...base, filter, loadedIds }).map((g) => [g.group, ids(g.rows)]);
    expect(shown('disabled')).toEqual([['added', ['eli5@claude-community']]]);
    expect(shown('enabled').flatMap(([, r]) => r)).not.toContain('eli5@claude-community');
    expect(shown('loaded', new Set(['code-review@claude-plugins-official', 'agents-md@builtin']))).toEqual([['anthropic', ['code-review@claude-plugins-official']]]);
    expect(shown('loaded', null)).toEqual([]);
    expect(shown('otherProjects')).toEqual([['otherProjects', ['supabase@claude-plugins-official']]]);
  });
});

describe('the library model: loaded plugins that are no identity', () => {
  it('credits the engine’s built-in plugins and a folder’s, and leaves out what My items lists', () => {
    const identities = identitiesOf([inst('designer@designer')], MARKETS, NO_VIEWS, null);
    const loaded = [
      { name: 'designer', path: '/cfg/plugins/cache/designer/designer/2.1.0', source: 'designer@designer', version: '2.1.0' },
      { name: 'agents-md', path: 'builtin', source: 'agents-md@builtin', version: null },
      { name: 'chatgpt-advisor', path: '/Users/me/.claude/skills/chatgpt-advisor', source: 'chatgpt-advisor@skills-dir', version: '0.1.0' },
      { name: 'scratch', path: '/tmp/scratch-plugin', source: null, version: null },
      { name: 'ptc', path: '/cfg/plugins/cache/ptc-tool/ptc/0.5.0', source: 'ptc@ptc-tool', version: '0.5.0' },
    ];
    expect(loadedOnly(loaded, identities)).toEqual([
      { name: 'agents-md', source: 'agents-md@builtin', kind: 'builtin' },
      { name: 'chatgpt-advisor', source: 'chatgpt-advisor@skills-dir', kind: 'folder' },
      { name: 'scratch', source: '', kind: 'folder' },
      { name: 'ptc', source: 'ptc@ptc-tool', kind: 'other' },
    ]);
  });
});
