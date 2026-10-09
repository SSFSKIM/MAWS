// The detail's model (P2-B execution document §5.7): the scope chips and the default one, the two facts that never merge
// (enabled for this project, loaded in this session), Update's offer, and What's inside's summary and tabs in Desktop's
// orders, over hand-built rows and views shaped as the host answers them.
import { describe, expect, it } from 'vitest';
import type { InstalledPlugin, PluginManifestView } from '@shared/ipc/schema/plugins';
import { chipLabel, chipsOf, insideItems, insideSummary, insideTabs, loadedFactOf, OTHER_PROJECTS, projectCount, projectLabels, updateOffer } from './detail';
import { identitiesOf } from './library';
import type { LoadedPlugins } from '../../sessions/observed';

const HERE = '/work/maws';
const inst = (id: string, over: Partial<InstalledPlugin> = {}): InstalledPlugin => {
  const [name, marketplace] = id.split('@');
  return { id, name, marketplace, version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `/cfg/plugins/cache/${marketplace}/${name}/1.0.0`, errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false, ...over };
};
const project = (id: string, projectPath: string, over: Partial<InstalledPlugin> = {}) => inst(id, { scope: 'project', projectPath, here: projectPath === HERE, coversHere: projectPath === HERE, ...over });
const identity = (installations: InstalledPlugin[], loadedIds: ReadonlySet<string> | null = null) => identitiesOf(installations, [], new Map(), loadedIds)[0];

const EMPTY: PluginManifestView['components'] = { mcpServers: [], mcpBundles: 0, agents: [], hooks: [], hookModules: 0, monitors: [], lspServers: [], commands: [], skills: [] };
const item = (name: string, description: string | null = null) => ({ name, description });

describe('the detail: scope chips', () => {
  it('one chip per installation here, the user’s, one covering here and a pseudo-scope one, in that order; the rest as one chip of other projects', () => {
    const p = 'doperpowers@doperpowers';
    const chips = chipsOf(
      identity([
        project(p, '/work/elsewhere'),
        inst(p),
        project(p, '/work', { coversHere: true }), // a parent project of this worktree
        project(p, HERE, { scope: 'local' }),
        project(p, HERE),
        project(p, '/work/third'),
        inst(p, { scope: 'synced' }),
      ]),
    );
    expect(chips.chips.map((c) => [c.kind, chipLabel(c), c.actionable])).toEqual([
      ['local', 'This project · only you', true],
      ['project', 'This project', true],
      ['user', 'User', true],
      ['covering', 'work', false],
      ['synced', 'Synced', false],
    ]);
    expect(chips.others.map((o) => o.projectPath)).toEqual(['/work/elsewhere', '/work/third']);
    expect(chips.defaultKey).toBe(chips.chips[0].key); // the representative installation: the narrowest here
  });

  it('the default chip is the representative installation’s; with only other projects, the other-projects chip', () => {
    const p = 'code-review@claude-plugins-official';
    const userOnly = chipsOf(identity([inst(p), project(p, '/work/other')]));
    expect(userOnly.chips.map((c) => chipLabel(c))).toEqual(['User']);
    expect(userOnly.chips.find((c) => c.key === userOnly.defaultKey)?.kind).toBe('user');
    const elsewhere = chipsOf(identity([project(p, '/work/other'), project(p, '/work/more')]));
    expect(elsewhere.chips).toEqual([]);
    expect(elsewhere.defaultKey).toBe(OTHER_PROJECTS);
    expect(elsewhere.others).toHaveLength(2);
  });

  it('a skills-directory plugin and a session folder read Created by you, never actionable', () => {
    expect(chipsOf(identity([inst('notes@skills-dir')])).chips.map((c) => [chipLabel(c), c.actionable])).toEqual([['Created by you', false]]);
    expect(chipsOf(identity([inst('local-thing@inline', { scope: 'session' })])).chips.map((c) => [chipLabel(c), c.actionable])).toEqual([['Created by you', false]]);
  });
});

describe('the detail: other projects', () => {
  it('counts projects, not installation records: a project and a local installation in one folder are one other project', () => {
    const p = 'e8-probe@e8-scratch';
    const { others } = chipsOf(identity([inst(p), project(p, '/work/other'), project(p, '/work/other', { scope: 'local' })]));
    expect(others).toHaveLength(2); // the list keeps a row per installation
    expect(projectCount(others)).toBe(1);
    expect(projectCount([...others, project(p, '/work/third')])).toBe(2);
  });

  it('names a project by its folder, and by its parent and folder only when two share a name; never an absolute path', () => {
    expect([...projectLabels(['/Users/me/MAWS/.claude/worktrees/agent-x', '/Users/me/other/agent-x', '/work/solo', '/work/solo/'])]).toEqual([
      ['/Users/me/MAWS/.claude/worktrees/agent-x', 'worktrees/agent-x'],
      ['/Users/me/other/agent-x', 'other/agent-x'],
      ['/work/solo', 'solo'],
      ['/work/solo/', 'solo'],
    ]);
  });
});

describe('the detail: enabled for this project and loaded in this session never merge', () => {
  const loaded = (sources: string[], freshness: LoadedPlugins['freshness']): LoadedPlugins => ({
    plugins: sources.map((source) => ({ name: source.split('@')[0], path: `/cfg/${source}`, source, version: null })),
    errors: [],
    warnings: [],
    freshness,
  });

  it('loaded now, last time, absent from a known list, or not observed', () => {
    const id = 'code-review@claude-plugins-official';
    expect(loadedFactOf(id, loaded([id], { kind: 'now' }), new Set([id]))).toEqual({ kind: 'loaded', freshness: { kind: 'now' } });
    expect(loadedFactOf(id, loaded([id], { kind: 'last', at: '2026-10-07T12:00:00Z' }), new Set([id]))).toEqual({ kind: 'loaded', freshness: { kind: 'last', at: '2026-10-07T12:00:00Z' } });
    expect(loadedFactOf(id, loaded(['other@x'], { kind: 'now' }), new Set(['other@x']))).toEqual({ kind: 'absent' });
    expect(loadedFactOf(id, loaded([], { kind: 'unknown' }), null)).toEqual({ kind: 'unknown' });
  });
});

describe('the detail: Update', () => {
  it('names the marketplace’s version when it differs, and is disabled as On latest version only on an equal pair', () => {
    expect(updateOffer('1.0.0', '1.1.0')).toEqual({ available: true, latest: false, title: 'Update to 1.1.0' });
    expect(updateOffer(null, '1.1.0')).toEqual({ available: true, latest: false, title: 'Update to 1.1.0' });
    expect(updateOffer('1.1.0', '1.1.0')).toEqual({ available: false, latest: true, title: 'On latest version' });
    expect(updateOffer('1.1.0', null)).toEqual({ available: false, latest: false, title: 'Update' });
    expect(updateOffer('unknown', null)).toEqual({ available: false, latest: false, title: 'Update' });
    expect(updateOffer('unknown', 'unknown')).toEqual({ available: false, latest: false, title: 'Update' }); // "unknown" is no version
  });
});

describe('the detail: What’s inside', () => {
  const components: PluginManifestView['components'] = {
    ...EMPTY,
    skills: [item('frontend-design', 'Distinctive interfaces'), item('review'), item('ship'), item('polish'), item('audit')],
    commands: [item('deploy', 'Ships it')],
    hooks: [
      { event: 'PostToolUse', matcher: 'Write' },
      { event: 'PostToolUse', matcher: 'Edit' },
      { event: 'SessionStart', matcher: null },
    ],
    hookModules: 1,
    mcpServers: [{ name: 'supabase', transport: 'http' }],
    mcpBundles: 1,
    lspServers: [{ name: 'pyright' }],
  };

  it('summarises each non-empty kind in Desktop’s order with up to three names and how many more', () => {
    expect(insideSummary(components)).toEqual([
      { kind: 'mcpServers', count: 2, names: ['supabase'], more: 1 },
      { kind: 'hooks', count: 4, names: ['PostToolUse', 'SessionStart'], more: 0 }, // events once each, a module counted
      { kind: 'lspServers', count: 1, names: ['pyright'], more: 0 },
      { kind: 'commands', count: 1, names: ['deploy'], more: 0 },
      { kind: 'skills', count: 5, names: ['frontend-design', 'review', 'ship'], more: 2 },
    ]);
    expect(insideSummary(EMPTY)).toEqual([]);
  });

  it('draws a tab per non-empty kind in Desktop’s tab order, with its count', () => {
    expect(insideTabs(components)).toEqual([
      { kind: 'skills', count: 5 },
      { kind: 'commands', count: 1 },
      { kind: 'mcpServers', count: 2 },
      { kind: 'hooks', count: 4 },
      { kind: 'lspServers', count: 1 },
    ]);
  });

  it('lists a tab’s items: slash names for skills and commands, the transport for a server, event and matcher for a hook', () => {
    expect(insideItems(components, 'skills')[0]).toEqual({ name: '/frontend-design', description: 'Distinctive interfaces' });
    expect(insideItems(components, 'commands')).toEqual([{ name: '/deploy', description: 'Ships it' }]);
    expect(insideItems(components, 'mcpServers')).toEqual([
      { name: 'supabase', description: 'http' },
      { name: '1 MCP bundle', description: null },
    ]);
    expect(insideItems(components, 'hooks')).toEqual([
      { name: 'PostToolUse · Write', description: null },
      { name: 'PostToolUse · Edit', description: null },
      { name: 'SessionStart', description: null },
      { name: '1 hooks module', description: null },
    ]);
    expect(insideItems(components, 'lspServers')).toEqual([{ name: 'pyright', description: null }]);
  });
});
