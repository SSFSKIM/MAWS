// The plugin detail's model (P2-B execution document §5.7): the scope chips (one per installation that can matter here,
// the rest as one "other projects" chip) and the default one, the "loaded in this session" fact beside the CLI's
// "enabled for this project" (two facts that never merge), Update's offer against the marketplace's version, and What's
// inside as Claude Desktop draws it: a summary in Desktop's order with up to three names and "and N more"
// (readable/app-2.16120.0/web/app/v1/c24c8737b-BY-86Rbf.js:1975-2028) and a tab per non-empty kind in Desktop's tab
// order (:4002-4076). Pure: the components and the tests read these.
import type { InstalledPlugin, PluginManifestView } from '@shared/ipc/schema/plugins';
import { LIBRARY as L } from '../copy';
import { basename, isActionable, isHere, isPseudo, SKILLS_DIR, versionWords, type PluginIdentity } from './library';
import type { Freshness, LoadedPlugins } from './loaded';
import { installedKey } from './PluginRow';

// ---- the scope chips ----------------------------------------------------------------------------------------------

export type ChipKind = 'local' | 'project' | 'user' | 'covering' | 'yours' | 'synced' | 'pseudo';
export interface ScopeChip {
  key: string; // the installation's key (E8's `installedKey`): the operation key of a change at this chip
  kind: ChipKind;
  installation: InstalledPlugin;
  actionable: boolean; // here or the user's: a change from this session acts on it
}
export const OTHER_PROJECTS = 'other-projects';

const CHIP_ORDER: readonly ChipKind[] = ['local', 'project', 'user', 'covering', 'yours', 'synced', 'pseudo'];

function kindOf(p: InstalledPlugin): ChipKind | null {
  if (isPseudo(p)) return p.marketplace === SKILLS_DIR || p.scope === 'session' ? 'yours' : p.scope === 'synced' ? 'synced' : 'pseudo';
  if (isHere(p)) return p.scope === 'local' ? 'local' : 'project';
  if (p.scope === 'user') return 'user';
  if (p.coversHere) return 'covering';
  return null; // another project's
}

export function chipLabel(chip: ScopeChip): string {
  switch (chip.kind) {
    case 'covering':
      return basename(chip.installation.projectPath ?? '');
    case 'pseudo':
      return chip.installation.scope;
    default:
      return L.chip[chip.kind];
  }
}

// The chips in the order narrowest here, the user's, one covering here, the pseudo-scope ones; the installations of
// other projects apart (one chip for them all); the default chip the representative installation's.
export function chipsOf(identity: PluginIdentity): { chips: ScopeChip[]; others: InstalledPlugin[]; defaultKey: string } {
  const chips: ScopeChip[] = [];
  const others: InstalledPlugin[] = [];
  for (const installation of identity.installations) {
    const kind = kindOf(installation);
    if (kind === null) others.push(installation);
    else chips.push({ key: installedKey(installation), kind, installation, actionable: isActionable(installation) });
  }
  chips.sort((a, b) => CHIP_ORDER.indexOf(a.kind) - CHIP_ORDER.indexOf(b.kind));
  const representative = installedKey(identity.representative);
  return { chips, others, defaultKey: chips.some((c) => c.key === representative) ? representative : (chips[0]?.key ?? OTHER_PROJECTS) };
}

// How many other projects hold the plugin: folders, not installation records (a project and a local installation in one
// folder are one project).
export const projectCount = (installations: readonly InstalledPlugin[]): number => new Set(installations.map((p) => (p.projectPath ?? '').replace(/\/+$/, ''))).size;

// What a project is named by, never its absolute path: its folder's name, or its parent's and its own when another
// project shares the folder's name (worktrees often do), e.g. `MAWS/agent-x`.
export function projectLabels(paths: readonly string[]): Map<string, string> {
  const trimmed = (path: string) => path.replace(/\/+$/, '');
  const folders = new Map<string, Set<string>>(); // folder name → the distinct projects so named
  for (const path of paths) folders.set(basename(path), (folders.get(basename(path)) ?? new Set()).add(trimmed(path)));
  return new Map(
    paths.map((path) => {
      const name = basename(path);
      if ((folders.get(name)?.size ?? 0) < 2) return [path, name];
      const parent = trimmed(path).slice(0, trimmed(path).lastIndexOf('/'));
      return [path, `${basename(parent)}/${name}`];
    }),
  );
}

// Why a chip offers no change: E8's words for another project's installation; the pseudo-scopes' own.
export function chipManagedWords(chip: ScopeChip): string | null {
  if (chip.actionable) return null;
  if (chip.kind === 'synced') return L.syncedThere;
  if (chip.kind === 'covering') return L.managedIn(chipLabel(chip));
  return L.yoursThere;
}

// ---- the two facts --------------------------------------------------------------------------------------------------

export type LoadedFact = { kind: 'loaded'; freshness: Freshness } | { kind: 'absent' } | { kind: 'unknown' };

// The plugin whose `source` is this id in the session's loaded list: there (with the list's freshness), absent from a
// list that is known, or not observed (no list).
export function loadedFactOf(id: string, loaded: LoadedPlugins, loadedIds: ReadonlySet<string> | null): LoadedFact {
  if (loadedIds === null) return { kind: 'unknown' };
  return loaded.plugins.some((p) => p.source === id) ? { kind: 'loaded', freshness: loaded.freshness } : { kind: 'absent' };
}

// ---- Update ---------------------------------------------------------------------------------------------------------

// "Update to <version>" when the marketplace names a version other than the installed one; disabled as "On latest
// version" only when both are present and equal (the engine leaves installed plugins out of `--available`, so the
// marketplace entry is the only version to compare).
export function updateOffer(installed: string | null, marketplace: string | null): { available: boolean; latest: boolean; title: string } {
  const have = versionWords(installed);
  const offered = versionWords(marketplace);
  if (offered === null) return { available: false, latest: false, title: L.update };
  return have === offered ? { available: false, latest: true, title: L.onLatest } : { available: true, latest: false, title: L.updateTo(offered) };
}

// ---- What's inside --------------------------------------------------------------------------------------------------

export type InsideKind = keyof typeof L.kind;
type Components = PluginManifestView['components'];

const SUMMARY_ORDER: readonly InsideKind[] = ['mcpServers', 'agents', 'hooks', 'monitors', 'lspServers', 'commands', 'skills'];
const TAB_ORDER: readonly InsideKind[] = ['skills', 'commands', 'mcpServers', 'hooks', 'monitors', 'lspServers', 'agents'];
const SHOWN_NAMES = 3; // Desktop's

const unique = (names: readonly string[]) => [...new Set(names.filter((n) => n !== ''))];

function countOf(c: Components, kind: InsideKind): number {
  if (kind === 'mcpServers') return c.mcpServers.length + c.mcpBundles;
  if (kind === 'hooks') return c.hooks.length + c.hookModules;
  return c[kind].length;
}

// A kind's names for the summary; hooks by event, each once (a hook per matcher repeats its event).
function namesOf(c: Components, kind: InsideKind): string[] {
  if (kind === 'hooks') return unique(c.hooks.map((h) => h.event));
  return unique(c[kind].map((i) => i.name));
}

export interface InsideRow {
  kind: InsideKind;
  count: number;
  names: string[];
  more: number;
}

export function insideSummary(c: Components): InsideRow[] {
  return SUMMARY_ORDER.flatMap((kind) => {
    const count = countOf(c, kind);
    if (count === 0) return [];
    const all = namesOf(c, kind);
    const names = all.slice(0, SHOWN_NAMES);
    // Desktop: hooks' "more" counts the distinct names left; the rest count the items left
    const more = names.length === 0 ? 0 : Math.max(0, (kind === 'hooks' ? all.length : count) - names.length);
    return [{ kind, count, names, more }];
  });
}

export function insideTabs(c: Components): { kind: InsideKind; count: number }[] {
  return TAB_ORDER.flatMap((kind) => {
    const count = countOf(c, kind);
    return count === 0 ? [] : [{ kind, count }];
  });
}

// A tab's items, names and descriptions only: never a command line, an environment or header value or a URL (the host's
// answer carries none, §5.5).
export function insideItems(c: Components, kind: InsideKind): { name: string; description: string | null }[] {
  switch (kind) {
    case 'skills':
    case 'commands':
      return c[kind].map((i) => ({ name: `/${i.name}`, description: i.description }));
    case 'agents':
    case 'monitors':
      return c[kind].map((i) => ({ name: i.name, description: i.description }));
    case 'mcpServers':
      return [...c.mcpServers.map((s) => ({ name: s.name, description: s.transport === 'unknown' ? null : s.transport })), ...(c.mcpBundles > 0 ? [{ name: L.bundles(c.mcpBundles), description: null }] : [])];
    case 'hooks':
      return [...c.hooks.map((h) => ({ name: h.matcher ? `${h.event} · ${h.matcher}` : h.event, description: null })), ...(c.hookModules > 0 ? [{ name: L.hookModules(c.hookModules), description: null }] : [])];
    case 'lspServers':
      return c.lspServers.map((s) => ({ name: s.name, description: null }));
  }
}
