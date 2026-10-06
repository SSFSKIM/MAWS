// E8 M1: the one argument list the confirm sheet shows and the runner runs, and the one write manifest the sheet, the
// tests and the live run's delta check read. The manifest's oracle is G0's CLI probe (the files after each step).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandLine, isPluginsArgument, PLUGINS_ACTIONS, PLUGINS_SCOPES, READ_LINES, writesOf, type PluginsAction, type PluginsActionInputs } from './cli';

const ROOT = resolve(__dirname, '../../..');

describe('commandLine', () => {
  it('builds the probe’s exact argument lists, action by action', () => {
    expect(commandLine('install', { plugin: 'e8-probe@e8-scratch' })).toEqual(['plugin', 'install', 'e8-probe@e8-scratch', '--json']);
    expect(commandLine('install', { plugin: 'p@m', scope: 'project', acceptCommand: 'a'.repeat(64) })).toEqual(['plugin', 'install', 'p@m', '--scope', 'project', '--accept-command', 'a'.repeat(64), '--json']);
    expect(commandLine('update', { plugin: 'p@m', scope: 'local' })).toEqual(['plugin', 'update', 'p@m', '--scope', 'local', '--json']);
    expect(commandLine('update', { plugin: 'p@m', acceptCommand: 'b'.repeat(64) })).toEqual(['plugin', 'update', 'p@m', '--accept-command', 'b'.repeat(64), '--json']);
    expect(commandLine('uninstall', { plugin: 'p@m', scope: 'user', keepData: true })).toEqual(['plugin', 'uninstall', 'p@m', '--scope', 'user', '--keep-data', '--json']);
    expect(commandLine('uninstall', { plugin: 'p@m', keepData: false })).toEqual(['plugin', 'uninstall', 'p@m', '--json']);
    expect(commandLine('enable', { plugin: 'p@m', scope: 'project' })).toEqual(['plugin', 'enable', 'p@m', '--scope', 'project', '--json']);
    expect(commandLine('disable', { plugin: 'p@m' })).toEqual(['plugin', 'disable', 'p@m', '--json']);
    expect(commandLine('marketplace-add', { source: '/tmp/e8-g0/run1/market' })).toEqual(['plugin', 'marketplace', 'add', '/tmp/e8-g0/run1/market', '--json']);
    expect(commandLine('marketplace-add', { source: 'owner/repo', scope: 'project' })).toEqual(['plugin', 'marketplace', 'add', 'owner/repo', '--scope', 'project', '--json']);
    expect(commandLine('marketplace-update', { name: 'e8-scratch' })).toEqual(['plugin', 'marketplace', 'update', 'e8-scratch', '--json']);
    expect(commandLine('marketplace-remove', { name: 'e8-scratch', scope: 'local' })).toEqual(['plugin', 'marketplace', 'remove', 'e8-scratch', '--scope', 'local', '--json']);
  });

  it('always ends with --json and never carries -y or --yes, whatever the input', () => {
    const inputs: { [A in PluginsAction]: PluginsActionInputs[A] } = {
      install: { plugin: 'p@m', scope: 'local', acceptCommand: 'c'.repeat(64) },
      update: { plugin: 'p@m', scope: 'user', acceptCommand: 'c'.repeat(64) },
      uninstall: { plugin: 'p@m', scope: 'project', keepData: true },
      enable: { plugin: 'p@m', scope: 'user' },
      disable: { plugin: 'p@m', scope: 'local' },
      'marketplace-add': { source: 'https://example.com/m.git', scope: 'user' },
      'marketplace-update': { name: 'm' },
      'marketplace-remove': { name: 'm', scope: 'project' },
    };
    for (const action of PLUGINS_ACTIONS) {
      const argv = commandLine(action, inputs[action] as never);
      expect(argv.at(-1), action).toBe('--json');
      expect(argv, action).not.toContain('-y');
      expect(argv, action).not.toContain('--yes');
    }
  });

  it('refuses a plugin, source or name the CLI would read as an option', () => {
    expect(isPluginsArgument('owner/repo')).toBe(true);
    expect(isPluginsArgument('-y')).toBe(false);
    expect(isPluginsArgument('--scope')).toBe(false);
    expect(isPluginsArgument('')).toBe(false);
    expect(() => commandLine('install', { plugin: '-y' })).toThrow(/option/);
    expect(() => commandLine('marketplace-add', { source: '--yes' })).toThrow(/option/);
    expect(() => commandLine('marketplace-remove', { name: '-x' })).toThrow(/option/);
  });

  it('names the three reads', () => {
    expect(READ_LINES).toEqual({
      installed: ['plugin', 'list', '--json'],
      available: ['plugin', 'list', '--json', '--available'],
      marketplaces: ['plugin', 'marketplace', 'list', '--json'],
    });
  });
});

// One `--- files after: <step>` block of g0-cli-probe.txt: the config home's settings.json, the two registries, the
// CLI's own `.claude.json` and the `plugins/` tree, as the probe printed them.
interface Snapshot { step: string; files: Map<string, string>; tree: Set<string> }

function probeSnapshots(): Snapshot[] {
  const text = readFileSync(resolve(ROOT, 'docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt'), 'utf8');
  const parts = text.split(/^--- files after: (.*)$/m);
  const snapshots: Snapshot[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1].split(/^===/m)[0];
    const files = new Map<string, string>();
    let tree = new Set<string>();
    for (const section of body.split(/^## /m).slice(1)) {
      const newline = section.indexOf('\n');
      const head = section.slice(0, newline).trim();
      const rest = section.slice(newline + 1).trim();
      if (head === 'plugins/ tree') tree = new Set(rest.split('\n').filter((line) => line.length > 0));
      else files.set(head.replace(/ \(absent\)$/, ''), head.endsWith('(absent)') ? '(absent)' : rest);
    }
    snapshots.push({ step: parts[i], files, tree });
  }
  return snapshots;
}

// What one step changed: files whose content moved, and `plugins/` tree entries that appeared or went.
function delta(before: Snapshot, after: Snapshot): string[] {
  const changed = [...after.files.keys()].filter((name) => after.files.get(name) !== before.files.get(name));
  const tree = [...after.tree].filter((p) => !before.tree.has(p)).concat([...before.tree].filter((p) => !after.tree.has(p)));
  return [...new Set([...changed, ...tree])].sort();
}

// A manifest entry with placeholders (`cache/<marketplace>/<plugin>/<version>/`) as segment patterns.
const segments = (entry: string) => entry.replace(/\/$/, '').split('/');
const segmentMatches = (pattern: string, segment: string) => /^<[^>]+>$/.test(pattern) || pattern === segment;

// Inside the manifest: the settings file itself, or a path under the config home's `plugins/` that is a manifest entry,
// lies beneath one (a file the entry's directory holds), or is an ancestor the CLI creates on the way to one.
function covered(path: string, manifest: { settings: string; others: string[] }): boolean {
  if (path === manifest.settings) return true;
  if (path === 'plugins') return manifest.others.length > 0;
  if (!path.startsWith('plugins/')) return false;
  const observed = path.slice('plugins/'.length).split('/');
  return manifest.others.some((entry) => {
    const pattern = segments(entry);
    const shared = Math.min(pattern.length, observed.length);
    for (let i = 0; i < shared; i += 1) if (!segmentMatches(pattern[i], observed[i])) return false;
    return true;
  });
}

// The probe's mutating steps, with the action, scope and marketplace source kind each ran (all at user scope against
// the directory marketplace `e8-scratch`).
const PROBE_STEPS: Record<string, PluginsAction> = {
  'marketplace add (directory)': 'marketplace-add',
  'install e8-probe@e8-scratch': 'install',
  'disable e8-probe@e8-scratch': 'disable',
  'enable e8-probe@e8-scratch': 'enable',
  'update e8-probe@e8-scratch': 'update',
  'marketplace update e8-scratch': 'marketplace-update',
  'uninstall e8-probe@e8-scratch': 'uninstall',
  'marketplace remove e8-scratch': 'marketplace-remove',
};
// The probe's failing mutations: a failure writes nothing.
const FAILED_STEPS = ['disable again (no-op)', 'install unknown plugin (error shape)', 'marketplace add unknown directory (error shape)', 'uninstall again (error shape)', 'marketplace remove again (error shape)'];

// `.claude.json` is the engine's own global config (first-start identifiers, `pluginUsage` counters, project trust),
// which every engine start rewrites; it is bookkeeping, not plugin configuration, and is not part of the manifest (D-12's
// reasoning; the uninstall step's snapshot also follows the reload probe's sessions, which wrote their trust keys).
const BOOKKEEPING = '.claude.json';

describe('writesOf', () => {
  it('names the settings file of each scope, relative to the config home or the project', () => {
    for (const action of PLUGINS_ACTIONS) {
      expect(writesOf(action, 'user', null).settings, action).toBe('settings.json');
      expect(writesOf(action, 'project', null).settings, action).toBe('.claude/settings.json');
      expect(writesOf(action, 'local', null).settings, action).toBe('.claude/settings.local.json');
    }
  });

  it('names the registry and cache entries of each action under plugins/', () => {
    // a dependency may come from another marketplace the root one allowlists (allowCrossMarketplaceDependenciesOn)
    expect(writesOf('install', 'user', null).others).toEqual(['installed_plugins.json', 'cache/<marketplace>/<plugin>/<version>/', 'cache/<any-marketplace>/<dependency>/']);
    expect(writesOf('update', 'project', null).others).toEqual(['installed_plugins.json', 'cache/<marketplace>/<plugin>/<version>/', 'cache/<any-marketplace>/<dependency>/']);
    expect(writesOf('uninstall', 'user', null).others).toEqual(['installed_plugins.json', 'cache/<marketplace>/<plugin>/<version>/', 'data/<id>/']);
    expect(writesOf('enable', 'user', null).others).toEqual([]);
    expect(writesOf('disable', 'local', null).others).toEqual([]);
    expect(writesOf('marketplace-add', 'user', 'directory').others).toEqual(['known_marketplaces.json', 'marketplaces/']);
    expect(writesOf('marketplace-add', 'user', 'github').others).toEqual(['known_marketplaces.json', 'marketplaces/<name>/']);
    expect(writesOf('marketplace-add', 'user', null).others).toEqual(['known_marketplaces.json', 'marketplaces/<name>/']);
    expect(writesOf('marketplace-update', 'user', 'directory').others).toEqual(['known_marketplaces.json']);
    expect(writesOf('marketplace-update', 'user', 'git').others).toEqual(['known_marketplaces.json', 'marketplaces/<name>/']);
    expect(writesOf('marketplace-update', 'user', 'url').others).toEqual(['known_marketplaces.json', 'marketplaces/<name>/']);
    expect(writesOf('marketplace-remove', 'user', 'directory').others).toEqual(['known_marketplaces.json']);
    expect(writesOf('marketplace-remove', 'user', 'github').others).toEqual(['known_marketplaces.json', 'marketplaces/<name>/']);
  });

  it('covers every file G0’s probe saw each action change, and a failed action changed nothing', () => {
    const snapshots = probeSnapshots();
    const at = (step: string) => {
      const index = snapshots.findIndex((s) => s.step === step);
      expect(index, step).toBeGreaterThan(0);
      return delta(snapshots[index - 1], snapshots[index]).filter((path) => path !== BOOKKEEPING);
    };
    const seen = new Set<PluginsAction>();
    for (const [step, action] of Object.entries(PROBE_STEPS)) {
      const manifest = writesOf(action, 'user', 'directory');
      const changed = at(step);
      expect(changed.filter((path) => !covered(path, manifest)), step).toEqual([]);
      seen.add(action);
    }
    expect([...seen].sort()).toEqual([...PLUGINS_ACTIONS].sort()); // the probe ran every action once
    for (const step of FAILED_STEPS) expect(at(step), step).toEqual([]);
    // the oracle is not vacuous: install's delta is the settings file, the registry and the cache tree
    expect(at('install e8-probe@e8-scratch')).toEqual(expect.arrayContaining(['settings.json', 'plugins/installed_plugins.json', 'plugins/cache/e8-scratch/e8-probe/0.1.0']));
  });

  it('a marketplace removal announces what uninstalling its plugins writes: the registry, its cache, each plugin’s data and every settings file that may hold one of them or an override for it', () => {
    // 2.1.291 uninstalls a removed marketplace's plugins and clears their enable or disable overrides at any scope (the
    // E8 whole-branch review: a user install disabled with --scope local in a project lost that local override too)
    const installed = [
      { id: 'a@m', scope: 'user', projectPath: null },
      { id: 'b@m', scope: 'project', projectPath: '/w/app' },
      { id: 'c@m', scope: 'local', projectPath: '/w/app' },
      { id: 'd@m', scope: 'session', projectPath: null }, // a pseudo-scope: no settings file of its own
    ];
    const writes = writesOf('marketplace-remove', 'user', 'directory', installed, '/w/session');
    expect(writes.settings).toBe('settings.json');
    expect(writes.others).toEqual(['known_marketplaces.json', 'installed_plugins.json', 'cache/<name>/', 'data/a@m/', 'data/b@m/', 'data/c@m/', 'data/d@m/']);
    // the config home's, and both project files of every project an installation names and of the session's directory
    expect(writes.scopeSettings).toEqual([
      { project: null, file: 'settings.json' },
      { project: '/w/app', file: '.claude/settings.json' },
      { project: '/w/app', file: '.claude/settings.local.json' },
      { project: '/w/session', file: '.claude/settings.json' },
      { project: '/w/session', file: '.claude/settings.local.json' },
    ]);
    // a user-scoped plugin with a local override in the session's project: that project's settings.local.json is named
    expect(writesOf('marketplace-remove', 'user', 'directory', installed.slice(0, 1), '/w/session').scopeSettings).toEqual([
      { project: null, file: 'settings.json' },
      { project: '/w/session', file: '.claude/settings.json' },
      { project: '/w/session', file: '.claude/settings.local.json' },
    ]);
    // the session's directory named by an installation too: each file once
    expect(writesOf('marketplace-remove', 'user', 'directory', installed.slice(1, 2), '/w/app').scopeSettings).toHaveLength(3);
    expect(writesOf('marketplace-remove', 'user', 'github', installed.slice(0, 1)).others).toEqual(['known_marketplaces.json', 'marketplaces/<name>/', 'installed_plugins.json', 'cache/<name>/', 'data/a@m/']);
    // with nothing installed from it, the removal writes only the catalogue's records; no other action names other scopes
    expect(writesOf('marketplace-remove', 'user', 'directory', [])).toEqual({ settings: 'settings.json', others: ['known_marketplaces.json'], scopeSettings: [] });
    expect(writesOf('marketplace-remove', 'user', 'directory', [], '/w/session').scopeSettings).toEqual([]);
    for (const action of PLUGINS_ACTIONS.filter((a) => a !== 'marketplace-remove')) expect(writesOf(action, 'user', null, installed, '/w/session').scopeSettings, action).toEqual([]);
  });

  it('knows the three scopes', () => {
    expect(PLUGINS_SCOPES).toEqual(['user', 'project', 'local']);
  });
});
