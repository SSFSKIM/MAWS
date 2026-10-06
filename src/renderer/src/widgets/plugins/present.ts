// The plugin-management presenters (E8 execution document, M2): what the confirm sheet shows for one request (the
// binary and the exact argument list from M1's `commandLine`, the files from its `writesOf`, what follows), a row's
// operation line in the engine's own words with the reload report beside it, the marketplace-declared command a
// refusal carries, and the available catalogue grouped per marketplace. Pure: the components and the tests read these.
import { commandLine, writesOf, type PluginsAction, type PluginsActionInputs, type PluginsScope } from '@shared/plugins/cli';
import type { AvailablePlugin, PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { OPERATION, PLUGIN_MANAGEMENT as W } from '../copy';

// One mutation as the owner asked for it: the action, the CLI's input, and the marketplace's source kind when known
// (`writesOf` announces a clone directory for any source not read in place).
export type PluginsRequest = { [A in PluginsAction]: { action: A; input: PluginsActionInputs[A]; source: string | null } }[PluginsAction];

export const requestFor = <A extends PluginsAction>(action: A, input: PluginsActionInputs[A], source: string | null): PluginsRequest => ({ action, input, source }) as PluginsRequest;

// The actions whose sheet offers a scope, and the two that destroy something (the acknowledgement first).
export const SCOPED: ReadonlySet<PluginsAction> = new Set(['install', 'update', 'uninstall', 'enable', 'disable']);
export const DESTRUCTIVE: ReadonlySet<PluginsAction> = new Set(['uninstall', 'marketplace-remove']);

export const scopeOf = (request: PluginsRequest): PluginsScope => ('scope' in request.input && request.input.scope) || 'user';

export const targetOf = (request: PluginsRequest): string => {
  const input = request.input as { plugin?: string; name?: string; source?: string };
  return input.plugin ?? input.name ?? input.source ?? '';
};

export const argvOf = (request: PluginsRequest): string[] => commandLine(request.action, request.input as never);

// A shell-safe word as-is; anything else single-quoted, so a path with a space reads as one argument.
const word = (arg: string): string => (/^[\w@%+=:,./~-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);

// The sheet's mono line: the binary's basename (the probe's real path is in the tooltip) and the argument list.
export const commandWords = (binary: string | null, argv: readonly string[]): string => [binary === null ? 'claude' : binary.slice(binary.lastIndexOf('/') + 1), ...argv].map(word).join(' ');

// A path typed into "Add marketplace" is a directory source (read in place); any other source is left unknown, so the
// sheet announces the clone directory too (the manifest is a superset, M1's decision 4).
export const sourceKindOfTyped = (source: string): string | null => (/^[/~.]/.test(source.trim()) ? 'directory' : null);

// `writesOf`'s files as paths: the scope's settings file under the config home (user) or the project, the others under
// `<config home>/plugins/`, with the segments the request already names filled in.
export function writesWords(request: PluginsRequest, where: { configHome: string; cwd: string }): string[] {
  const scope = scopeOf(request);
  const manifest = writesOf(request.action, scope, request.source);
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
  return [`${scope === 'user' ? where.configHome : where.cwd}/${manifest.settings}`, ...manifest.others.map((other) => `${where.configHome}/plugins/${fill(other)}`)];
}

// What follows a confirmed change: the reload of every running session, or nothing for an added marketplace.
export const thenWords = (action: PluginsAction, readySessions: number): string =>
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
export function declaredOf(event: PluginsOperationEvent | null, action: PluginsAction): { sha256: string; command: string } | null {
  if (action !== 'install' && action !== 'update') return null;
  const outcome = event?.outcome;
  if (!outcome || outcome.ok || outcome.error.shownCommand === null) return null;
  const shown = outcome.error.shownCommand;
  const sha256 = str(shown.sha256);
  if (sha256 === null || !SHA256.test(sha256)) return null;
  const command = Array.isArray(shown.command) && shown.command.every((part) => typeof part === 'string') ? shown.command.join(' ') : (str(shown.command) ?? JSON.stringify(shown.command ?? shown));
  return { sha256, command };
}

// ---- the available catalogue ----------------------------------------------------------------------------------------

export interface AvailableGroup {
  marketplace: string;
  plugins: AvailablePlugin[];
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en');

// Per marketplace in name order, each plugin list in name order, keeping only what the filter names (case-insensitive,
// over the name, the id and the description); a marketplace with nothing left is dropped.
export function availableGroups(plugins: readonly AvailablePlugin[], filter: string): AvailableGroup[] {
  const needle = filter.trim().toLowerCase();
  const groups = new Map<string, AvailablePlugin[]>();
  for (const plugin of plugins) {
    if (needle !== '' && ![plugin.name, plugin.pluginId, plugin.description ?? ''].some((text) => text.toLowerCase().includes(needle))) continue;
    groups.set(plugin.marketplaceName, [...(groups.get(plugin.marketplaceName) ?? []), plugin]);
  }
  return [...groups]
    .sort(([a], [b]) => byName(a, b))
    .map(([marketplace, list]) => ({ marketplace, plugins: list.sort((a, b) => byName(a.name, b.name)) }));
}
