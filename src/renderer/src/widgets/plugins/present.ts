// The plugin-management presenters (E8 execution document, M2): what the confirm sheet shows for one request (the
// binary and the exact argument list from M1's `commandLine`, the files from its `writesOf`, what follows), a row's
// operation line in the engine's own words with the reload report beside it, the marketplace-declared command a
// refusal carries. Pure: the components and the tests read these.
import { runnerCommandLine, writesOf, type PluginsAction, type PluginsInstallation, type PluginsScope, type RunnerAction, type RunnerActionInputs } from '@shared/plugins/cli';
import type { InstalledPlugin, PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { OPERATION, PLUGIN_MANAGEMENT as W } from '../copy';

// An install asked from Discover (P4-AGG M3; the Discover spec, Design "Adding"): what the sheet shows beside the
// command, in words the caller already chose (customize/discover/present.ts), and the marketplace the route installs
// from, which a first step adds at the sheet's scope when the engine does not have it yet.
export interface CatalogInstall {
  name: string; // the item's display name
  marketplace: { name: string; source: string; present: boolean };
  skills: string[] | null; // asked from Skills: the skills the plugin carries, which the sheet names
  contents: string[] | null; // what comes with it ("2 skills", "hooks", …); null when no source lists it
  runsCode: string | null; // the runs-code warning, or the softer one for unknown contents
  alsoListedBy: string[];
}

// What a request knows beyond the CLI's input: for a marketplace removal, the installations it uninstalls; for an install
// from Discover, its catalog words and route; for an install that followed adding its marketplace, that marketplace,
// which stays added when the install fails.
// P4-AGG M4: a connector added from Discover: what its sheet shows beside the command (customize/connectors).
export interface ConnectorAdd {
  name: string; // the display name
  publisher: string | null;
  trust: string; // the trust label
  urlPattern: string | null; // the directory's url_regex: an instance URL is asked for and checked against it
  urlOptions: { url: string; label: string; description: string | null }[]; // the directory's url_options: a choice
  authPosture: 'auth_required' | 'no_auth';
}

export interface RequestContext {
  uninstalls?: PluginsInstallation[];
  connector?: ConnectorAdd; // P4-AGG M4
  catalog?: CatalogInstall;
  afterAdd?: { marketplace: string; scope: PluginsScope };
}

// One mutation as the owner asked for it: the action, the CLI's input, and the marketplace's source kind when known
// (`writesOf` announces a clone directory for any source not read in place).
// P4-AGG M4: the runner's MCP verbs too, which Customize › Connectors asks through the same operations.
export type PluginsRequest = { [A in RunnerAction]: { action: A; input: RunnerActionInputs[A]; source: string | null } & RequestContext }[RunnerAction];

// The installations a removal of `name` uninstalls (the engine uninstalls every plugin installed from it, 2.1.291).
export const uninstallsOf = (installed: readonly InstalledPlugin[], name: string) => installed.filter((p) => p.marketplace === name).map(({ id, scope, projectPath }) => ({ id, scope, projectPath }));

export const requestFor = <A extends RunnerAction>(action: A, input: RunnerActionInputs[A], source: string | null, context: RequestContext = {}): PluginsRequest => ({ action, input, source, ...context }) as PluginsRequest;

// The actions whose sheet offers a scope, and the two that destroy something (the acknowledgement first).
// P4-AGG M3: adding a marketplace takes a scope too (the Discover spec, M3 Decisions), as `plugin marketplace add` does.
export const SCOPED: ReadonlySet<RunnerAction> = new Set(['install', 'update', 'uninstall', 'enable', 'disable', 'marketplace-add']);
export const DESTRUCTIVE: ReadonlySet<RunnerAction> = new Set(['uninstall', 'marketplace-remove', 'mcp-remove']);

export const scopeOf = (request: PluginsRequest): PluginsScope => ('scope' in request.input && request.input.scope) || 'user';

export const targetOf = (request: PluginsRequest): string => {
  const input = request.input as { plugin?: string; name?: string; source?: string };
  return input.plugin ?? input.name ?? input.source ?? '';
};

export const argvOf = (request: PluginsRequest): string[] => runnerCommandLine(request.action, request.input as never);

// A shell-safe word as-is; anything else single-quoted, so a path with a space reads as one argument.
const word = (arg: string): string => (/^[\w@%+=:,./~-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);

// The sheet's mono line: the resolved binary's basename (its real path is in the tooltip) and the argument list. There
// is no default name: a sheet whose binary is unresolved shows no command at all.
export const commandWords = (binary: string, argv: readonly string[]): string => [binary.slice(binary.lastIndexOf('/') + 1), ...argv].map(word).join(' ');

// A path typed into "Add marketplace" is a directory source (read in place); any other source is left unknown, so the
// sheet announces the clone directory too (the manifest is a superset, M1's decision 4).
export const sourceKindOfTyped = (source: string): string | null => (/^[/~.]/.test(source.trim()) ? 'directory' : null);

// `writesOf`'s files as paths: the scope's settings file under the config home (user) or the project (`where.cwd`, the
// session's directory, where the request runs), the others under `<config home>/plugins/` with the segments the request
// already names filled in, then for a marketplace removal every settings file that may hold its uninstalled plugins or
// an override for them, each once.
export function writesWords(request: PluginsRequest, where: { configHome: string; cwd: string }): string[] {
  const scope = scopeOf(request);
  const manifest = writesOf(request.action as PluginsAction, scope, request.source, request.uninstalls ?? [], where.cwd);
  const input = request.input as { plugin?: string; name?: string };
  const fill = (path: string): string => {
    if (input.plugin !== undefined) {
      const at = input.plugin.lastIndexOf('@');
      const name = at > 0 ? input.plugin.slice(0, at) : input.plugin;
      const marketplace = at > 0 ? input.plugin.slice(at + 1) : '<marketplace>';
      return path.replaceAll('<id>', input.plugin).replaceAll('<plugin>', name).replaceAll('<marketplace>', marketplace);
    }
    return input.name !== undefined ? path.replaceAll('<name>', input.name) : path;
  };
  const paths = [
    `${scope === 'user' ? where.configHome : where.cwd}/${manifest.settings}`,
    ...manifest.others.map((other) => `${where.configHome}/plugins/${fill(other)}`),
    ...manifest.scopeSettings.map(({ project, file }) => `${project ?? where.configHome}/${file}`),
  ];
  return [...new Set(paths)];
}

// The first step of an install from Discover whose marketplace the engine does not have: adding it at `scope`.
export function addStepOf(request: PluginsRequest, scope: PluginsScope = scopeOf(request)): PluginsRequest | null {
  const marketplace = request.action === 'install' ? request.catalog?.marketplace : undefined;
  if (!marketplace || marketplace.present) return null;
  return requestFor('marketplace-add', { source: marketplace.source, scope }, sourceKindOfTyped(marketplace.source));
}

// The install after its marketplace was added: no add step left, and the marketplace named for a failure's words.
export function afterAddOf(request: PluginsRequest): PluginsRequest {
  const catalog = request.catalog;
  if (!catalog) return request;
  return { ...request, catalog: { ...catalog, marketplace: { ...catalog.marketplace, present: true } }, afterAdd: { marketplace: catalog.marketplace.name, scope: scopeOf(request) } };
}

// For an install or update, what the `<dependency>` cache entry stands for (null for any other action).
export const dependencyWords = (action: RunnerAction): string | null => (action === 'install' || action === 'update' ? W.dependencies : null);

// For a marketplace removal that uninstalls plugins, what its project settings files are named for.
export const overridesWords = (request: PluginsRequest): string | null => (request.action === 'marketplace-remove' && (request.uninstalls ?? []).length > 0 ? W.overrides : null);

// For a marketplace removal, the installed plugins it uninstalls with it (the engine deletes their saved options and
// data too), each with its scope and, for a project or local one, its project; null when none is installed from it.
export function uninstallsWords(request: PluginsRequest): string | null {
  const uninstalls = request.action === 'marketplace-remove' ? (request.uninstalls ?? []) : [];
  if (uninstalls.length === 0) return null;
  return W.alsoUninstalls(uninstalls.map(({ id, scope, projectPath }) => `${id} (${projectPath !== null && scope !== 'user' ? `${scope}, ${projectPath}` : scope})`));
}

// What follows a confirmed change: the reload of every running session, or nothing for an added marketplace.
export const thenWords = (action: RunnerAction, readySessions: number): string =>
  action === 'marketplace-add' ? W.nothingToReload : readySessions > 0 ? W.reloadsIn(readySessions) : W.noSessionToReload;

// ---- a row's operation ---------------------------------------------------------------------------------------------

export type PluginOpState =
  | { phase: 'idle' }
  | { phase: 'working'; opId: string | null; line: string | null; reloading: boolean } // line: the CLI's last progress line
  | { phase: 'done'; event: PluginsOperationEvent }
  | { phase: 'unsent'; error: string }; // the invoke itself was refused: nothing ran

export interface OperationWords {
  text: string;
  failed: boolean; // drawn in red: the engine's failure, or nothing ran
  reloadAgain: boolean; // a session did not reflect the change or failed to reload
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function reloadParts(reload: NonNullable<PluginsOperationEvent['reload']>, titleOf: (appSessionId: string) => string, scope: PluginsScope): string[] {
  const { sessions } = reload;
  if (sessions.length === 0) return [W.noSessionToReload];
  const parts: string[] = [];
  const reloaded = sessions.filter((s) => s.outcome !== 'failed').length;
  if (reloaded > 0) parts.push(W.reloadedIn(reloaded));
  const missed = sessions.filter((s) => s.outcome === 'not_reflected');
  if (missed.length === 0 && sessions.some((s) => s.outcome === 'reflected')) parts.push(W.reflected);
  for (const s of missed) parts.push(scope === 'user' ? `${W.notReflectedIn(titleOf(s.appSessionId))} · ${W.mayOverride}` : W.notReflectedIn(titleOf(s.appSessionId)));
  for (const s of sessions) if (s.outcome === 'failed') parts.push(W.failedIn(titleOf(s.appSessionId), s.error ?? ''));
  return parts;
}

// `Working…`, the CLI's last line while it runs, then its result (`message`, an update's version change) or its failure
// (`message · failureCode`), and on a success the reload of the running sessions, each named where it fell short.
export function operationWords(state: PluginOpState, titleOf: (appSessionId: string) => string, scope: PluginsScope): OperationWords | null {
  switch (state.phase) {
    case 'idle':
      return null;
    case 'unsent':
      return { text: state.error, failed: true, reloadAgain: false };
    case 'working':
      return { text: state.reloading ? W.reloading : (state.line ?? OPERATION.working), failed: false, reloadAgain: false };
    case 'done': {
      const { outcome, reload } = state.event;
      if (!outcome) return { text: OPERATION.working, failed: false, reloadAgain: false };
      if (!outcome.ok) return { text: OPERATION.failed(outcome.error.message, outcome.error.failureCode ?? outcome.error.code), failed: true, reloadAgain: false };
      const parts = [str(outcome.result.message) ?? W.done];
      const from = str(outcome.result.oldVersion);
      const to = str(outcome.result.newVersion);
      if (from !== null && to !== null && from !== to) parts.push(W.versionChange(from, to));
      if (reload) parts.push(...reloadParts(reload, titleOf, scope));
      const reloadAgain = reload?.sessions.some((s) => s.outcome === 'not_reflected' || s.outcome === 'failed') ?? false;
      return { text: parts.join(' · '), failed: false, reloadAgain };
    }
  }
}

// ---- a marketplace-declared command (D-5) ---------------------------------------------------------------------------

const SHA256 = /^[0-9a-f]{64}$/;

// The command a refusal carries for the owner to accept, when the action can rerun with `--accept-command` (install and
// update) and the CLI reported its sha256; the command as the marketplace declares it.
export function declaredOf(event: PluginsOperationEvent | null, action: RunnerAction): { sha256: string; command: string } | null {
  if (action !== 'install' && action !== 'update') return null;
  const outcome = event?.outcome;
  if (!outcome || outcome.ok || outcome.error.shownCommand === null) return null;
  const shown = outcome.error.shownCommand;
  const sha256 = str(shown.sha256);
  if (sha256 === null || !SHA256.test(sha256)) return null;
  const command = Array.isArray(shown.command) && shown.command.every((part) => typeof part === 'string') ? shown.command.join(' ') : (str(shown.command) ?? JSON.stringify(shown.command ?? shown));
  return { sha256, command };
}
