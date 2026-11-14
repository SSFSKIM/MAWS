// E8 M1: the one argument list the confirm sheet shows and the runner runs, and the one write manifest the sheet, the
// tests and the live run's delta check read. The manifest's oracle is G0's CLI probe (the files after each step).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commandLine, holdsValueSlot, isMcpAction, isMcpName, isMcpUrl, isPluginsArgument, MCP_ENTRY_BOUNDS, MCP_MASK, mcpCommandLine, mcpEntryJson, mcpEntryProblem, mcpShown, mcpShownCommand, mcpShownLine, mcpValueSlotsOf,
  PLUGINS_ACTIONS, PLUGINS_SCOPES, READ_LINES, RUNNER_ACTIONS, runnerCommandLine, writesOf, type McpEntry, type McpEntryProblem, type PluginsAction, type PluginsActionInputs,
} from './cli';

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

// P4-AGG M4: the engine's `claude mcp add|remove` (its printed lines measured against 2.1.309 on a scratch HOME,
// spikes/p4-aggregator/m4-signin-spike.mjs's adds and the M4 report)
describe('mcpCommandLine', () => {
  it('adds a remote server at the chosen scope, the transport and scope always named', () => {
    expect(mcpCommandLine('mcp-add', { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'user' })).toEqual(['mcp', 'add', '--transport', 'http', 'linear', 'https://mcp.linear.app/mcp', '--scope', 'user']);
    expect(mcpCommandLine('mcp-add', { name: 'atlassian_sse', url: 'https://mcp.atlassian.com/v1/sse', transport: 'sse', scope: 'project' })).toEqual(['mcp', 'add', '--transport', 'sse', 'atlassian_sse', 'https://mcp.atlassian.com/v1/sse', '--scope', 'project']);
    expect(runnerCommandLine('mcp-remove', { name: 'linear', scope: 'local' })).toEqual(['mcp', 'remove', 'linear', '--scope', 'local']);
    expect(runnerCommandLine('install', { plugin: 'p@m' })).toEqual(['plugin', 'install', 'p@m', '--json']);
  });

  it('refuses a name the engine refuses, or one it would read as an option', () => {
    for (const name of ['Google Drive', '-y', '', 'a/b', 'é']) expect(() => mcpCommandLine('mcp-remove', { name, scope: 'user' }), name).toThrow(/server name/);
    expect(isMcpName('google-drive_2')).toBe(true);
  });

  it('refuses a URL that is not http or https', () => {
    for (const url of ['ftp://x.example/mcp', '--scope', 'mcp.linear.app/mcp', 'https://', ' https://x.example/mcp']) expect(() => mcpCommandLine('mcp-add', { name: 'x', url, transport: 'http', scope: 'user' }), url).toThrow(/URL/);
    expect(isMcpUrl('http://127.0.0.1:9/mcp')).toBe(true);
  });

  it('tells the runner\'s two families apart', () => {
    expect(RUNNER_ACTIONS.filter(isMcpAction)).toEqual(['mcp-add', 'mcp-remove']);
  });
});

// UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §A): a custom connector's entry,
// its one rule, the `claude mcp add-json` line (Engine facts, 1: written exactly as given), its value slots, and the
// line MAWS shows, built from the structure with the slots replaced and never by searching text.
const remote: McpEntry = { type: 'http', url: 'https://files.example.test/mcp', headers: [{ name: 'X-Files-Key', value: 'value-one' }] };
const local: McpEntry = { type: 'stdio', command: '/opt/files probe/bin/files-probe', args: ['--root', '/tmp/my files'], env: [{ name: 'FILES_PROBE_KEY', value: 'value-two' }] };
const add = (entry: McpEntry, name = 'files-probe', scope: 'user' | 'project' | 'local' = 'user') => ({ name, scope, entry });

describe('the custom add’s command line', () => {
  it('builds `mcp add-json <name> <json> --scope <scope>` whose JSON parses back to the entry, for each type, with and without headers, variables and arguments', () => {
    const cases: [McpEntry, Record<string, unknown>][] = [
      [remote, { type: 'http', url: 'https://files.example.test/mcp', headers: { 'X-Files-Key': 'value-one' } }],
      [{ ...remote, type: 'sse' }, { type: 'sse', url: 'https://files.example.test/mcp', headers: { 'X-Files-Key': 'value-one' } }],
      [{ type: 'http', url: 'https://files.example.test/mcp', headers: [] }, { type: 'http', url: 'https://files.example.test/mcp' }],
      [local, { type: 'stdio', command: '/opt/files probe/bin/files-probe', args: ['--root', '/tmp/my files'], env: { FILES_PROBE_KEY: 'value-two' } }],
      [{ type: 'stdio', command: 'files-probe', args: [], env: [] }, { type: 'stdio', command: 'files-probe', args: [] }],
      [{ type: 'stdio', command: 'files-probe', args: [''], env: [{ name: 'EMPTY_ONE', value: '' }] }, { type: 'stdio', command: 'files-probe', args: [''], env: { EMPTY_ONE: '' } }],
    ];
    for (const scope of PLUGINS_SCOPES) {
      for (const [entry, written] of cases) {
        const argv = mcpCommandLine('mcp-add', add(entry, 'files-probe', scope));
        expect(argv.length).toBe(6);
        expect([argv[0], argv[1], argv[2], argv[4], argv[5]]).toEqual(['mcp', 'add-json', 'files-probe', '--scope', scope]);
        expect(JSON.parse(argv[3])).toEqual(written);
        expect(argv[3]).toBe(mcpEntryJson(entry));
        expect(runnerCommandLine('mcp-add', add(entry, 'files-probe', scope))).toEqual(argv);
      }
    }
  });

  it('leaves today’s `mcp add` and `mcp remove` lines as they were', () => {
    expect(mcpCommandLine('mcp-add', { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'user' })).toEqual(['mcp', 'add', '--transport', 'http', 'linear', 'https://mcp.linear.app/mcp', '--scope', 'user']);
    expect(mcpCommandLine('mcp-remove', { name: 'linear', scope: 'local' })).toEqual(['mcp', 'remove', 'linear', '--scope', 'local']);
  });

  it('refuses a name the engine refuses before anything of the entry is read', () => {
    for (const name of ['two words', '-y', '', 'dot.name']) expect(() => mcpCommandLine('mcp-add', add(local, name)), name).toThrow(/server name/);
  });
});

describe('mcpEntryProblem', () => {
  const B = MCP_ENTRY_BOUNDS;
  const pairs = (n: number, prefix = 'K') => Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, value: 'v' }));
  const problemOf = (entry: McpEntry): McpEntryProblem | null => mcpEntryProblem(entry);
  // one case per rule of §A's table, each answering the field, the row and the code
  const refused: [string, McpEntry, McpEntryProblem][] = [
    ['a URL that is not http or https', { ...remote, url: 'ftp://files.example.test/mcp' }, { field: 'url', index: null, code: 'url' }],
    ['a URL with a space at its end', { ...remote, url: 'https://files.example.test/mcp ' }, { field: 'url', index: null, code: 'url' }],
    ['a URL over 4,096', { ...remote, url: `https://files.example.test/${'x'.repeat(B.url)}` }, { field: 'url', index: null, code: 'too-long' }],
    ['an empty command', { ...local, command: '' }, { field: 'command', index: null, code: 'empty' }],
    ['a command with a space at an end', { ...local, command: ' files-probe' }, { field: 'command', index: null, code: 'space' }],
    ['a command over 4,096', { ...local, command: 'x'.repeat(B.command + 1) }, { field: 'command', index: null, code: 'too-long' }],
    ['257 arguments', { ...local, args: Array.from({ length: B.args + 1 }, () => 'a') }, { field: 'args', index: null, code: 'too-many' }],
    ['an argument over 8,192', { ...local, args: ['ok', 'x'.repeat(B.arg + 1)] }, { field: 'args', index: 1, code: 'too-long' }],
    ['65 headers', { ...remote, headers: pairs(B.headers + 1, 'X-H') }, { field: 'headers', index: null, code: 'too-many' }],
    ['129 variables', { ...local, env: pairs(B.env + 1) }, { field: 'env', index: null, code: 'too-many' }],
    ['a header name that is no HTTP token', { ...remote, headers: [{ name: 'X Files', value: 'v' }] }, { field: 'headers', index: 0, code: 'name' }],
    ['an empty header name', { ...remote, headers: [{ name: '', value: 'value-one' }] }, { field: 'headers', index: 0, code: 'name' }],
    ['a header name over 256', { ...remote, headers: [{ name: 'x'.repeat(B.pairName + 1), value: 'v' }] }, { field: 'headers', index: 0, code: 'name' }],
    ['a header named __proto__', { ...remote, headers: [{ name: '__proto__', value: 'v' }] }, { field: 'headers', index: 0, code: 'name' }],
    ['a variable name starting with a digit', { ...local, env: [{ name: '1KEY', value: 'v' }] }, { field: 'env', index: 0, code: 'name' }],
    ['a variable name with a hyphen', { ...local, env: [{ name: 'FILES-KEY', value: 'v' }] }, { field: 'env', index: 0, code: 'name' }],
    ['a variable named __proto__', { ...local, env: [{ name: '__proto__', value: 'v' }] }, { field: 'env', index: 0, code: 'name' }],
    ['two headers of one name, case ignored', { ...remote, headers: [{ name: 'X-Files-Key', value: 'a' }, { name: 'x-files-key', value: 'b' }] }, { field: 'headers', index: 1, code: 'duplicate' }],
    ['two variables of one name', { ...local, env: [{ name: 'KEY', value: 'a' }, { name: 'OTHER', value: 'b' }, { name: 'KEY', value: 'c' }] }, { field: 'env', index: 2, code: 'duplicate' }],
    ['a header value over 8,192', { ...remote, headers: [{ name: 'X-A', value: 'x'.repeat(B.value + 1) }] }, { field: 'headers', index: 0, code: 'too-long' }],
    ['a variable value over 8,192', { ...local, env: [{ name: 'A', value: 'x'.repeat(B.value + 1) }] }, { field: 'env', index: 0, code: 'too-long' }],
    ['a control character in the URL', { ...remote, url: 'https://files.example.test/m\ncp' }, { field: 'url', index: null, code: 'control' }],
    ['a control character in the command', { ...local, command: 'files\u0007probe' }, { field: 'command', index: null, code: 'control' }],
    ['a control character in an argument', { ...local, args: ['a', 'b\tc'] }, { field: 'args', index: 1, code: 'control' }],
    ['a control character in a header value', { ...remote, headers: [{ name: 'X-A', value: 'value\none' }] }, { field: 'headers', index: 0, code: 'control' }],
    ['a delete character in a variable value', { ...local, env: [{ name: 'A', value: 'value\u007f' }] }, { field: 'env', index: 0, code: 'control' }],
    ['a JSON text over 32,768 bytes', { ...local, args: Array.from({ length: 5 }, () => 'x'.repeat(B.arg)) }, { field: 'entry', index: null, code: 'too-large' }],
  ];
  it.each(refused)('refuses %s', (_what, entry, problem) => {
    expect(problemOf(entry)).toEqual(problem);
  });

  it('accepts the entries of both kinds at their bounds: an empty value, an empty argument, the maximum counts, a value of 8,192', () => {
    expect(problemOf(remote)).toBeNull();
    expect(problemOf(local)).toBeNull();
    expect(problemOf({ ...remote, headers: [{ name: "!#$%&'*+-.^_`|~Az09", value: '' }] })).toBeNull();
    expect(problemOf({ ...local, args: [''], env: [{ name: '_A1', value: '' }] })).toBeNull();
    expect(problemOf({ ...remote, headers: pairs(B.headers, 'X-H') })).toBeNull();
    expect(problemOf({ ...local, env: pairs(B.env) })).toBeNull();
    expect(problemOf({ ...local, env: [{ name: 'A', value: 'x'.repeat(B.value) }] })).toBeNull();
    expect(problemOf({ ...local, env: [{ name: 'KEY', value: 'a' }, { name: 'key', value: 'b' }] })).toBeNull(); // variables are case-sensitive
  });

  it('makes the builder throw on each problem in words that name the field and the row, never a slot’s content', () => {
    for (const [what, entry] of refused) {
      let message = '';
      try {
        mcpCommandLine('mcp-add', add(entry));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, what).not.toBe('');
      for (const slot of mcpValueSlotsOf(add(entry))) expect(message.includes(slot), what).toBe(false);
    }
    expect(() => mcpCommandLine('mcp-add', add({ ...remote, headers: [{ name: 'X-A', value: 'value\none' }] }))).toThrow(/headers/);
  });
});

describe('the value slots and the shown line', () => {
  it('names the content of every header’s and variable’s value that is not empty, and nothing for any other input', () => {
    expect(mcpValueSlotsOf(add(remote))).toEqual(['value-one']);
    expect(mcpValueSlotsOf(add({ ...local, env: [{ name: 'A', value: 'value-two' }, { name: 'B', value: '' }, { name: 'C', value: 'value-three' }] }))).toEqual(['value-two', 'value-three']);
    expect(mcpValueSlotsOf({ name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'user' })).toEqual([]);
    expect(mcpValueSlotsOf({ name: 'linear', scope: 'user' })).toEqual([]);
  });

  it('finds a slot’s content in a text as written and as JSON escapes it inside a string, and an empty slot nowhere', () => {
    expect(holdsValueSlot('the key was value-one, refused', ['value-one'])).toBe(true);
    expect(holdsValueSlot('nothing here', ['value-one'])).toBe(false);
    const quoted = 'value "one" \\ two';
    expect(holdsValueSlot(`could not parse ${JSON.stringify({ k: quoted })}`, [quoted])).toBe(true); // as JSON escapes it
    expect(holdsValueSlot(`raw ${quoted}`, [quoted])).toBe(true); // as written
    expect(holdsValueSlot('a line', [''])).toBe(false);
    expect(holdsValueSlot('a line', [])).toBe(false);
  });

  it('masks every value slot, empty ones too, and keeps every public field as typed, also where it equals a value', () => {
    const same = add({ type: 'http', url: 'https://value-one.example.test/mcp', headers: [{ name: 'value-one', value: 'value-one' }, { name: 'X-Empty', value: '' }] }, 'value-one');
    expect(mcpShown(same)).toEqual({ name: 'value-one', scope: 'user', entry: { type: 'http', url: 'https://value-one.example.test/mcp', headers: [{ name: 'value-one', value: MCP_MASK }, { name: 'X-Empty', value: MCP_MASK }] } });
    expect(mcpShown(add(local))).toEqual(add({ ...local, env: [{ name: 'FILES_PROBE_KEY', value: MCP_MASK }] }));
    const plain = { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http' as const, scope: 'user' as const };
    expect(mcpShown(plain)).toBe(plain);
    expect(MCP_MASK).toBe('•••');
  });

  it('shows the line with ••• in every slot, the public fields as typed, and holds no slot’s content', () => {
    const input = add(local, 'files-probe', 'project');
    const shown = mcpShownLine('mcp-add', input);
    expect([shown[0], shown[1], shown[2], shown[4], shown[5]]).toEqual(['mcp', 'add-json', 'files-probe', '--scope', 'project']);
    expect(JSON.parse(shown[3])).toEqual({ type: 'stdio', command: '/opt/files probe/bin/files-probe', args: ['--root', '/tmp/my files'], env: { FILES_PROBE_KEY: MCP_MASK } });
    expect(shown.join(' ').includes('value-two')).toBe(false);
    expect(mcpShownLine('mcp-add', { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'user' })).toEqual(['mcp', 'add', '--transport', 'http', 'linear', 'https://mcp.linear.app/mcp', '--scope', 'user']);
    expect(mcpShownLine('mcp-remove', { name: 'linear', scope: 'user' })).toEqual(['mcp', 'remove', 'linear', '--scope', 'user']);
    expect(() => mcpShownLine('mcp-add', add({ ...local, env: [{ name: '1KEY', value: 'value-two' }] }))).toThrow(); // validated once, as the real line is
  });

  it('builds both lines for an entry a few bytes under the JSON bound whose values are empty or one character, the mask past it (R5)', () => {
    const values = Array.from({ length: 100 }, (_, i) => ({ name: `K${i}`, value: i % 2 === 0 ? '' : 'v' }));
    const base: McpEntry = { type: 'stdio', command: 'files-probe', args: [], env: values };
    const bytes = (e: McpEntry) => new TextEncoder().encode(mcpEntryJson(e)).length;
    // five arguments fill the room to six bytes under the bound: each adds its length, its two quotes and a comma between
    const fill = MCP_ENTRY_BOUNDS.json - 6 - bytes(base) - 5 * 2 - 4;
    const each = Math.floor(fill / 5);
    const entry: McpEntry = { ...base, args: [...Array.from({ length: 4 }, () => 'x'.repeat(each)), 'x'.repeat(fill - 4 * each)] };
    expect(bytes(entry)).toBe(MCP_ENTRY_BOUNDS.json - 6);
    expect(mcpEntryProblem(entry)).toBeNull();
    expect(mcpCommandLine('mcp-add', add(entry))).toHaveLength(6);
    const shown = mcpShownLine('mcp-add', add(entry));
    expect(new TextEncoder().encode(shown[3]).length).toBeGreaterThan(MCP_ENTRY_BOUNDS.json); // nine bytes for each mask
    expect(Object.values(JSON.parse(shown[3]).env as Record<string, string>).every((value) => value === MCP_MASK)).toBe(true);
  });

  it('words the shown command for a terminal, the JSON single-quoted for a shell', () => {
    expect(mcpShownCommand(add(remote))).toBe(`claude mcp add-json files-probe '{"type":"http","url":"https://files.example.test/mcp","headers":{"X-Files-Key":"•••"}}' --scope user`);
    expect(mcpShownCommand(add({ ...local, args: ["it's"], env: [] }))).toBe(`claude mcp add-json files-probe '{"type":"stdio","command":"/opt/files probe/bin/files-probe","args":["it'\\''s"]}' --scope user`);
  });
});
