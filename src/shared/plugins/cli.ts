// The engine's plugin CLI as MAWS runs it (E8 execution document, Interfaces "The shared module"): the eight mutations,
// the exact argument list each runs (`commandLine`, which the confirm sheet shows and the engine host's runner spawns, so
// the two cannot drift), the three reads, and the write manifest (`writesOf`) the sheet announces and the live run's
// file-delta check reads. Pure and zod-free: the renderer and the engine host both import it. `-y` is never built (D-5):
// a marketplace-declared command is accepted only through `--accept-command <sha256>` after a person saw it.

export const PLUGINS_ACTIONS = ['install', 'update', 'uninstall', 'enable', 'disable', 'marketplace-add', 'marketplace-update', 'marketplace-remove'] as const;
export type PluginsAction = (typeof PLUGINS_ACTIONS)[number];

export const PLUGINS_SCOPES = ['user', 'project', 'local'] as const;
export type PluginsScope = (typeof PLUGINS_SCOPES)[number];

export interface PluginsActionInputs {
  install: { plugin: string; scope?: PluginsScope; acceptCommand?: string };
  update: { plugin: string; scope?: PluginsScope; acceptCommand?: string };
  uninstall: { plugin: string; scope?: PluginsScope; keepData?: boolean };
  enable: { plugin: string; scope?: PluginsScope };
  disable: { plugin: string; scope?: PluginsScope };
  'marketplace-add': { source: string; scope?: PluginsScope };
  'marketplace-update': { name: string };
  'marketplace-remove': { name: string; scope?: PluginsScope };
}

// The argv after the binary for each read; the listings write no configuration (D-12).
export const READ_LINES = {
  installed: ['plugin', 'list', '--json'],
  available: ['plugin', 'list', '--json', '--available'],
  marketplaces: ['plugin', 'marketplace', 'list', '--json'],
} as const;

// A positional the CLI takes as a value, never as an option: a typed `-y` must not become the flag.
export const isPluginsArgument = (value: string): boolean => value.length > 0 && !value.startsWith('-');

function positional(value: string): string {
  if (!isPluginsArgument(value)) throw new Error(`"${value}" would be read as an option, not a plugin, source or marketplace`);
  return value;
}

const scopeArgs = (scope: PluginsScope | undefined): string[] => (scope ? ['--scope', scope] : []);

// The exact argv after the binary; pure; always ends with `--json`; never contains `-y`.
export function commandLine<A extends PluginsAction>(action: A, input: PluginsActionInputs[A]): string[] {
  const i = input as Partial<PluginsActionInputs['install'] & PluginsActionInputs['uninstall'] & PluginsActionInputs['marketplace-add'] & PluginsActionInputs['marketplace-update']>;
  switch (action) {
    case 'install':
    case 'update':
      return ['plugin', action, positional(i.plugin!), ...scopeArgs(i.scope), ...(i.acceptCommand ? ['--accept-command', i.acceptCommand] : []), '--json'];
    case 'uninstall':
      return ['plugin', 'uninstall', positional(i.plugin!), ...scopeArgs(i.scope), ...(i.keepData ? ['--keep-data'] : []), '--json'];
    case 'enable':
    case 'disable':
      return ['plugin', action, positional(i.plugin!), ...scopeArgs(i.scope), '--json'];
    case 'marketplace-add':
      return ['plugin', 'marketplace', 'add', positional(i.source!), ...scopeArgs(i.scope), '--json'];
    case 'marketplace-update':
      return ['plugin', 'marketplace', 'update', positional(i.name!), '--json'];
    case 'marketplace-remove':
      return ['plugin', 'marketplace', 'remove', positional(i.name!), ...scopeArgs(i.scope), '--json'];
  }
  throw new Error(`unknown plugins action ${String(action)}`);
}

export interface PluginsWrites {
  settings: string; // the scope's settings file: relative to the config home (user) or to the project (project, local)
  others: string[]; // relative to the config home's `plugins/`; `<…>` names a segment the operation fills
  // a marketplace removal only: the settings file of every scope one of the plugins it uninstalls is installed at,
  // relative to the config home (`project: null`) or to that installation's project
  scopeSettings: { project: string | null; file: string }[];
}

// One installation as `claude plugin list --json` lists it (the scope may be a pseudo-scope such as `session`).
export interface PluginsInstallation {
  id: string;
  scope: string;
  projectPath: string | null;
}

// Marketplace sources the engine reads where they are; every other kind (github, git, url, npm, …, or unknown) is
// cloned or fetched under `plugins/marketplaces/<name>/`.
const READ_IN_PLACE = new Set(['directory', 'file']);

const settingsOf = (scope: PluginsScope): string => (scope === 'user' ? 'settings.json' : scope === 'project' ? '.claude/settings.json' : '.claude/settings.local.json');

// The settings file of each scope the installations are at (a pseudo-scope has none), each named once.
function settingsOfInstallations(installations: readonly PluginsInstallation[]): PluginsWrites['scopeSettings'] {
  const out: PluginsWrites['scopeSettings'] = [];
  for (const { scope, projectPath } of installations) {
    const entry = scope === 'user' ? { project: null, file: settingsOf('user') } : (scope === 'project' || scope === 'local') && projectPath !== null ? { project: projectPath, file: settingsOf(scope) } : null;
    if (entry && !out.some((seen) => seen.project === entry.project && seen.file === entry.file)) out.push(entry);
  }
  return out;
}

// The files the engine's CLI writes for one action (the sheet's "Writes" line). `source` is the marketplace's source
// kind when known, null otherwise (then the clone directory is announced). The oracle is G0's probe
// (`docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt`, the files after each step): a directory `marketplace add` creates
// the empty `plugins/marketplaces/`; an update writes the settings file only when the version pin changes; an
// uninstall's cache and data entries are what the engine may remove. Two writes the probe did not exercise (E8's
// whole-branch review, 2.1.291): an install or update also installs the dependencies the marketplace declares (each its
// own cache directory, and its `enabledPlugins` entry in the same settings file), and a marketplace removal uninstalls
// the plugins installed from it (`uninstalls`, that marketplace's installations: the registry, the marketplace's cache,
// each one's data and the settings of each scope one is installed at). The CLI's own `.claude.json` bookkeeping (usage
// counters, first-start identifiers) is not plugin configuration and is not listed (D-12).
export function writesOf(action: PluginsAction, scope: PluginsScope, source: string | null, uninstalls: readonly PluginsInstallation[] = []): PluginsWrites {
  const settings = settingsOf(scope);
  const cloned = source === null || !READ_IN_PLACE.has(source);
  const cache = 'cache/<marketplace>/<plugin>/<version>/';
  const writes = (others: string[], scopeSettings: PluginsWrites['scopeSettings'] = []): PluginsWrites => ({ settings, others, scopeSettings });
  switch (action) {
    case 'install':
    case 'update':
      return writes(['installed_plugins.json', cache, 'cache/<marketplace>/<dependency>/']);
    case 'uninstall':
      return writes(['installed_plugins.json', cache, 'data/<id>/']);
    case 'enable':
    case 'disable':
      return writes([]);
    case 'marketplace-add':
      return writes(['known_marketplaces.json', cloned ? 'marketplaces/<name>/' : 'marketplaces/']);
    case 'marketplace-update':
      return writes(['known_marketplaces.json', ...(cloned ? ['marketplaces/<name>/'] : [])]);
    case 'marketplace-remove': {
      const own = ['known_marketplaces.json', ...(cloned ? ['marketplaces/<name>/'] : [])];
      if (uninstalls.length === 0) return writes(own);
      return writes([...own, 'installed_plugins.json', 'cache/<name>/', ...uninstalls.map((u) => `data/${u.id}/`)], settingsOfInstallations(uninstalls));
    }
  }
  throw new Error(`unknown plugins action ${String(action)}`);
}
