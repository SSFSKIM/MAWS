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

// P4-AGG M4 (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Adding", Connectors): the engine's
// `claude mcp add|remove` for a remote server, run by the same runner as the plugin verbs. The CLI has no `--json`: its
// result is the line it prints (`mcpOutcome` in the engine host). A name holds letters, digits, hyphens and underscores
// (the engine's own rule, which refuses anything else: "Invalid name …"); a URL is http or https. `--scope` is always
// given, so the command the sheet shows is the scope the person chose, never the engine's default (local).
export const MCP_ACTIONS = ['mcp-add', 'mcp-remove'] as const;
export type McpAction = (typeof MCP_ACTIONS)[number];
export const MCP_TRANSPORTS = ['http', 'sse'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

// UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §A): a custom connector is the same
// action with its own input, a whole entry run as `claude mcp add-json` (one action, two inputs: a new member of the
// runner's action list would be a wire major).
export type McpRemoteAdd = { name: string; url: string; transport: McpTransport; scope: PluginsScope };
export type McpEntryAdd = { name: string; scope: PluginsScope; entry: McpEntry };
export interface McpActionInputs {
  'mcp-add': McpRemoteAdd | McpEntryAdd;
  'mcp-remove': { name: string; scope: PluginsScope };
}
export const isMcpEntryAdd = (input: McpActionInputs[McpAction]): input is McpEntryAdd => 'entry' in input;

export const isMcpName = (name: string): boolean => /^[A-Za-z0-9_-]+$/.test(name) && name.length <= 128 && !name.startsWith('-');

export function isMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.length > 0 && url === url.trim();
  } catch {
    return false;
  }
}

export function mcpCommandLine<A extends McpAction>(action: A, input: McpActionInputs[A]): string[] {
  if (!isMcpName(input.name)) throw new Error(`"${input.name}" is not a server name the engine accepts (letters, digits, hyphens and underscores)`);
  if (action === 'mcp-add') {
    const add = input as McpActionInputs['mcp-add'];
    if (isMcpEntryAdd(add)) return addJsonLine(add, checkedEntry(add.entry));
    const { url, transport, scope } = add;
    if (!isMcpUrl(url)) throw new Error(`"${url}" is not an http or https URL`);
    return ['mcp', 'add', '--transport', transport, input.name, url, '--scope', scope];
  }
  return ['mcp', 'remove', input.name, '--scope', (input as McpActionInputs['mcp-remove']).scope];
}

// ── UX wave U11g: a custom connector's entry (§A "The entry and its one rule") ──

export const MCP_ENTRY_TYPES = ['http', 'sse', 'stdio'] as const;
export type McpPair = { name: string; value: string }; // `value` is a value slot; `name` is public
export type McpEntry =
  | { type: 'http' | 'sse'; url: string; headers: McpPair[] }
  | { type: 'stdio'; command: string; args: string[]; env: McpPair[] };
export const MCP_ENTRY_BOUNDS = { headers: 64, env: 128, args: 256, pairName: 256, value: 8192, command: 4096, arg: 8192, url: 4096, json: 32768 } as const;
export type McpEntryProblem = { field: 'url' | 'command' | 'args' | 'headers' | 'env' | 'entry'; index: number | null; code: 'url' | 'empty' | 'space' | 'name' | 'duplicate' | 'control' | 'too-long' | 'too-many' | 'too-large' };

// eslint-disable-next-line no-control-regex -- the control characters are what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]{1,256}$/; // an HTTP token
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/;

// A row's name, its value, then whether an earlier row holds the name: the first problem, or null.
function pairsProblem(field: 'headers' | 'env', pairs: readonly McpPair[]): McpEntryProblem | null {
  const B = MCP_ENTRY_BOUNDS;
  if (pairs.length > (field === 'headers' ? B.headers : B.env)) return { field, index: null, code: 'too-many' };
  const seen = new Set<string>();
  for (const [index, { name, value }] of pairs.entries()) {
    const at = (code: McpEntryProblem['code']): McpEntryProblem => ({ field, index, code });
    if (CONTROL.test(name)) return at('control');
    // `__proto__` is no ordinary key of a JSON object
    if (!(field === 'headers' ? HEADER_NAME : VARIABLE_NAME).test(name) || name === '__proto__') return at('name');
    if (CONTROL.test(value)) return at('control');
    if (value.length > B.value) return at('too-long');
    const key = field === 'headers' ? name.toLowerCase() : name; // header names are case-insensitive
    if (seen.has(key)) return at('duplicate');
    seen.add(key);
  }
  return null;
}

/** The entry's first problem, or null: the one rule the builder, the command's schema and the form all read, so they
 * cannot disagree. A problem names a field and a row, never a slot's content. */
export function mcpEntryProblem(entry: McpEntry): McpEntryProblem | null {
  const B = MCP_ENTRY_BOUNDS;
  if (entry.type === 'stdio') {
    const { command, args } = entry;
    if (CONTROL.test(command)) return { field: 'command', index: null, code: 'control' };
    if (command.length > B.command) return { field: 'command', index: null, code: 'too-long' };
    if (command.length === 0) return { field: 'command', index: null, code: 'empty' };
    if (command.trim() !== command) return { field: 'command', index: null, code: 'space' };
    if (args.length > B.args) return { field: 'args', index: null, code: 'too-many' };
    for (const [index, arg] of args.entries()) {
      if (CONTROL.test(arg)) return { field: 'args', index, code: 'control' };
      if (arg.length > B.arg) return { field: 'args', index, code: 'too-long' };
    }
    const env = pairsProblem('env', entry.env);
    if (env) return env;
  } else {
    const { url } = entry;
    if (CONTROL.test(url)) return { field: 'url', index: null, code: 'control' };
    if (url.length > B.url) return { field: 'url', index: null, code: 'too-long' };
    if (!isMcpUrl(url)) return { field: 'url', index: null, code: 'url' };
    const headers = pairsProblem('headers', entry.headers);
    if (headers) return headers;
  }
  if (new TextEncoder().encode(mcpEntryJson(entry)).length > B.json) return { field: 'entry', index: null, code: 'too-large' };
  return null;
}

/** The entry as `add-json` takes it, a serialiser that applies no rule: `headers` only with a header, `env` only with a
 * variable, `args` always. */
export function mcpEntryJson(entry: McpEntry): string {
  const record = (pairs: readonly McpPair[]) => Object.fromEntries(pairs.map(({ name, value }) => [name, value]));
  if (entry.type === 'stdio') return JSON.stringify({ type: entry.type, command: entry.command, args: entry.args, ...(entry.env.length > 0 && { env: record(entry.env) }) });
  return JSON.stringify({ type: entry.type, url: entry.url, ...(entry.headers.length > 0 && { headers: record(entry.headers) }) });
}

function checkedEntry(entry: McpEntry): McpEntry {
  const problem = mcpEntryProblem(entry);
  if (problem) throw new Error(`the connector's ${problem.field}${problem.index === null ? '' : ` row ${problem.index + 1}`} is not one Claude Code can be given (${problem.code})`);
  return entry;
}

const addJsonLine = ({ name, scope }: McpEntryAdd, entry: McpEntry): string[] => ['mcp', 'add-json', name, mcpEntryJson(entry), '--scope', scope];

// ── the value slots, and what is built from the structure (§A) ──

export const MCP_MASK = '•••';

/** The content of every header's and variable's value of an entry that is not empty; none for any other input. */
export function mcpValueSlotsOf(input: McpActionInputs[McpAction]): string[] {
  if (!isMcpEntryAdd(input)) return [];
  const pairs = input.entry.type === 'stdio' ? input.entry.env : input.entry.headers;
  return pairs.map(({ value }) => value).filter((value) => value.length > 0);
}

/** Whether the text contains a slot's content, as written or as JSON.stringify writes it inside a string. A test:
 * nothing replaces text inside a line. An empty slot is in every text, so it is no slot. */
export const holdsValueSlot = (text: string, slots: readonly string[]): boolean =>
  slots.some((slot) => slot.length > 0 && (text.includes(slot) || text.includes(JSON.stringify(slot).slice(1, -1))));

/** The same input with MCP_MASK in every value slot, empty ones too; the input itself when it has no entry. */
export function mcpShown<I extends McpActionInputs[McpAction]>(input: I): I {
  if (!isMcpEntryAdd(input)) return input;
  const masked = (pairs: readonly McpPair[]) => pairs.map(({ name }) => ({ name, value: MCP_MASK }));
  const { entry } = input;
  return { ...input, entry: entry.type === 'stdio' ? { ...entry, env: masked(entry.env) } : { ...entry, headers: masked(entry.headers) } } as I;
}

/** The line a sheet shows: the real input validated once, as `mcpCommandLine` does, then the masked structure serialised
 * with no rule applied to the substituted text (R5). For every input but a custom add, `mcpCommandLine`'s line. */
export function mcpShownLine<A extends McpAction>(action: A, input: McpActionInputs[A]): string[] {
  const real = mcpCommandLine(action, input);
  const add = input as McpActionInputs['mcp-add'];
  if (action !== 'mcp-add' || !isMcpEntryAdd(add)) return real;
  return addJsonLine(add, mcpShown(add).entry);
}

const shellWord = (word: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

/** The shown line as a terminal takes it: `claude mcp add-json <name> '<json>' --scope <scope>`. */
export const mcpShownCommand = (input: McpActionInputs['mcp-add']): string => ['claude', ...mcpShownLine('mcp-add', input).map(shellWord)].join(' ');

// Every verb the runner runs: the plugin CLI's and the MCP CLI's.
export const RUNNER_ACTIONS = [...PLUGINS_ACTIONS, ...MCP_ACTIONS] as const;
export type RunnerAction = (typeof RUNNER_ACTIONS)[number];
export type RunnerActionInputs = PluginsActionInputs & McpActionInputs;
export const isMcpAction = (action: RunnerAction): action is McpAction => (MCP_ACTIONS as readonly string[]).includes(action);

export function runnerCommandLine<A extends RunnerAction>(action: A, input: RunnerActionInputs[A]): string[] {
  return isMcpAction(action) ? mcpCommandLine<McpAction>(action, input as McpActionInputs[McpAction]) : commandLine(action as PluginsAction, input as PluginsActionInputs[PluginsAction]);
}

export interface PluginsWrites {
  settings: string; // the scope's settings file: relative to the config home (user) or to the project (project, local)
  others: string[]; // relative to the config home's `plugins/`; `<…>` names a segment the operation fills
  // a marketplace removal only: every settings file that may hold one of the plugins it uninstalls or an enable or
  // disable override for one, relative to the config home (`project: null`) or to a project
  scopeSettings: { project: string | null; file: string }[];
  // top-level keys of the engine's global config file (`.claude.json`) that hold a choice of the person's: a key there
  // that changes what the engine does later is configuration, named here; its own records (usage counters, identifiers,
  // migration flags) are not
  globalConfig: string[];
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

// The settings files an uninstall-by-removal may write: the engine clears the plugins' entries and any enable or disable
// override for them at every scope (a user install disabled with `--scope local` loses that local override too), so a
// conservative superset: the config home's, and both project files of every project an installation names and of the
// session's directory (`cwd`, where the CLI runs and an override may sit), each project once.
function settingsOfRemoval(installations: readonly PluginsInstallation[], cwd: string | null): PluginsWrites['scopeSettings'] {
  const projects = [...new Set([...installations.flatMap((i) => (i.projectPath === null ? [] : [i.projectPath])), ...(cwd === null ? [] : [cwd])])];
  return [{ project: null, file: settingsOf('user') }, ...projects.flatMap((project) => [{ project, file: settingsOf('project') }, { project, file: settingsOf('local') }])];
}

// The files the engine's CLI writes for one action (the sheet's "Writes" line). `source` is the marketplace's source
// kind when known, null otherwise (then the clone directory is announced). The oracle is G0's probe
// (`docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt`, the files after each step): a directory `marketplace add` creates
// the empty `plugins/marketplaces/`; an update writes the settings file only when the version pin changes; an
// uninstall's cache and data entries are what the engine may remove. Two writes the probe did not exercise (E8's
// whole-branch review, 2.1.291): an install or update also installs the dependencies the marketplace declares (each its
// own cache directory, in this marketplace or one it allowlists through `allowCrossMarketplaceDependenciesOn`, and its
// `enabledPlugins` entry in the same settings file), and a marketplace removal uninstalls the plugins installed from it
// (`uninstalls`, that marketplace's installations: the registry, the marketplace's cache, each one's data and every
// settings file that may hold them or an override for them, `settingsOfRemoval` with the session's directory `cwd`). The
// CLI's own `.claude.json` bookkeeping (usage counters, first-start identifiers) is not plugin configuration and is not
// listed (D-12). The plugins the person uninstalled or turned off are configuration there (2.1.331, `declinedPlugins`:
// a plugin listed in it is not installed again as another plugin's optional dependency): an uninstall at any scope, a
// marketplace removal (its plugins turned off in a settings file) and a user-scope disable may add to it, a user-scope
// install or enable takes the plugin out (E8 execution document, the Decision Log's entry of 2026-11-23).
export function writesOf(action: PluginsAction, scope: PluginsScope, source: string | null, uninstalls: readonly PluginsInstallation[] = [], cwd: string | null = null): PluginsWrites {
  const settings = settingsOf(scope);
  const cloned = source === null || !READ_IN_PLACE.has(source);
  const cache = 'cache/<marketplace>/<plugin>/<version>/';
  const declined = action === 'uninstall' || action === 'marketplace-remove' || (scope === 'user' && (action === 'install' || action === 'enable' || action === 'disable'));
  const writes = (others: string[], scopeSettings: PluginsWrites['scopeSettings'] = []): PluginsWrites => ({ settings, others, scopeSettings, globalConfig: declined ? ['declinedPlugins'] : [] });
  switch (action) {
    case 'install':
    case 'update':
      return writes(['installed_plugins.json', cache, 'cache/<any-marketplace>/<dependency>/']);
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
      return writes([...own, 'installed_plugins.json', 'cache/<name>/', ...uninstalls.map((u) => `data/${u.id}/`)], settingsOfRemoval(uninstalls, cwd));
    }
  }
  throw new Error(`unknown plugins action ${String(action)}`);
}
