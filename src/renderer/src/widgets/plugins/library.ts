// The plugin library's model (P2-B execution document §5.4): `plugin list --json` lists one row per installation (the
// owner's doperpowers has 47), and My items draws one row per plugin identity, placed in Claude Desktop's source groups
// in Desktop's order (readable/app-2.16120.0/web/app/v1/c27f32a39-QZ0BG6_X.js:843-859; the priority rules
// c08f249ae-BvqdxSI4.js:407-439), MAWS drawing the five its data can fill. An identity is listed when it can matter in
// this session's directory (a user installation, one covering here, enabled here, loaded, a pseudo-scope one); one
// installed only for other projects and not enabled here is listed only under Show › "Other projects". Pure: the
// components and the tests read these.
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import type { InstalledPlugin, ManifestItemRef, PluginManifestView } from '@shared/ipc/schema/plugins';
import { isAnthropicDefaultMarketplace } from '@shared/plugins/source-key';
import { relativeAge } from '../../app/relative-age';
import type { ObservedPlugin } from './loaded';

export type SourceGroup = 'here' | 'yours' | 'synced' | 'anthropic' | 'added';
export const GROUP_ORDER: readonly SourceGroup[] = ['here', 'yours', 'synced', 'anthropic', 'added'];

export interface PluginIdentity {
  id: string;
  name: string;
  marketplace: string;
  installations: InstalledPlugin[];
  representative: InstalledPlugin; // its row's version, date and target; the detail's default chip
  actionable: InstalledPlugin[]; // here or user: the only installations a change from this session acts on
  group: SourceGroup | null; // null: installed only for other projects
  enabledHere: boolean; // the CLI's effective `enabled` from this directory (a local override can turn off what the project enables)
  manifest: PluginManifestView | null; // the representative installation's view, once read
}

// The engine's built-in directory: Anthropic reviews its entries (U3 Method 1); the engine lists no marketplace row for it.
export const BUILT_IN_DIRECTORY = 'anthropic-plugin-directory';
const SKILLS_DIR = 'skills-dir';
const CLI_SCOPES: ReadonlySet<string> = new Set(['user', 'project', 'local']);

// A pseudo-scope installation: a `--plugin-dir` folder (session), a claude.ai sync, a skills-directory plugin (whose
// scope reads user or project, U3 F1). The CLI's scopes do not reach it, so nothing from this session acts on it.
const isPseudo = (p: InstalledPlugin): boolean => !CLI_SCOPES.has(p.scope) || p.marketplace === SKILLS_DIR;
const isHere = (p: InstalledPlugin): boolean => p.here && (p.scope === 'project' || p.scope === 'local');
const isActionable = (p: InstalledPlugin): boolean => !isPseudo(p) && (isHere(p) || p.scope === 'user');

export function groupOfMarketplace(marketplace: string, marketplaces: readonly Marketplace[]): 'anthropic' | 'added' {
  if (marketplace === BUILT_IN_DIRECTORY) return 'anthropic';
  const row = marketplaces.find((m) => m.name === marketplace);
  return row && isAnthropicDefaultMarketplace(row) ? 'anthropic' : 'added';
}

const updatedAt = (p: InstalledPlugin): string | null => p.lastUpdated ?? p.installedAt;
const timeOf = (p: InstalledPlugin): number => {
  const at = updatedAt(p);
  const t = at === null ? NaN : Date.parse(at);
  return Number.isFinite(t) ? t : -Infinity;
};

// The narrowest installation here (local, then project), else the user's, else one covering here, else a pseudo-scope
// one, else the most recently updated of the others.
export function representativeOf(installations: readonly InstalledPlugin[]): InstalledPlugin {
  const pick =
    installations.find((p) => isHere(p) && p.scope === 'local') ??
    installations.find((p) => isHere(p) && p.scope === 'project') ??
    installations.find((p) => p.scope === 'user' && !isPseudo(p)) ??
    installations.find((p) => p.coversHere) ??
    installations.find(isPseudo);
  return pick ?? [...installations].sort((a, b) => timeOf(b) - timeOf(a))[0];
}

// Desktop's name rule: the manifest's display name, else the name's words with the first capitalised ("code-review" →
// "Code review").
export function displayNameOf(name: string, manifest: PluginManifestView | null): string {
  if (manifest?.displayName) return manifest.displayName;
  const words = name.split('-').filter((w) => w !== '');
  if (words.length === 0) return name;
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The request's key for a manifest view, and the map key the views are kept under.
export const manifestKeyOf = (ref: ManifestItemRef): string => (ref.kind === 'installation' ? JSON.stringify(['installation', ref.id, ref.scope, ref.projectPath]) : JSON.stringify(['available', ref.pluginId]));
export const installationRef = (p: InstalledPlugin): ManifestItemRef => ({ kind: 'installation', id: p.id, scope: p.scope, projectPath: p.projectPath });

function groupOf(installations: readonly InstalledPlugin[], marketplace: string, marketplaces: readonly Marketplace[], relevant: boolean): SourceGroup | null {
  if (!relevant) return null;
  if (installations.some((p) => p.coversHere || p.projectEnabled)) return 'here';
  if (installations.some((p) => p.marketplace === SKILLS_DIR || p.scope === 'session')) return 'yours';
  if (installations.some((p) => p.scope === 'synced')) return 'synced';
  return groupOfMarketplace(marketplace, marketplaces);
}

export function identitiesOf(installed: readonly InstalledPlugin[], marketplaces: readonly Marketplace[], manifests: ReadonlyMap<string, PluginManifestView>, loadedIds: ReadonlySet<string> | null): PluginIdentity[] {
  const byId = new Map<string, InstalledPlugin[]>();
  for (const p of installed) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
  return [...byId].map(([id, installations]) => {
    const representative = representativeOf(installations);
    // the CLI prints one effective `enabled` per id as this directory sees it; `projectEnabled` (the project's settings
    // file alone) makes a plugin relevant here and places it, but a local override can still turn it off
    const enabledHere = installations.some((p) => p.enabled);
    const relevant = enabledHere || installations.some((p) => p.projectEnabled || p.scope === 'user' || p.coversHere || isPseudo(p)) || (loadedIds?.has(id) ?? false);
    return {
      id,
      name: representative.name,
      marketplace: representative.marketplace,
      installations,
      representative,
      actionable: installations.filter(isActionable),
      group: groupOf(installations, representative.marketplace, marketplaces, relevant),
      enabledHere,
      manifest: manifests.get(manifestKeyOf(installationRef(representative))) ?? null,
    };
  });
}

// ---- the row's words -------------------------------------------------------------------------------------------------

const NEW_MS = 14 * 86_400_000; // Desktop's 14 days
const WEEK_MS = 7 * 86_400_000;

export const updatedOf = (identity: PluginIdentity): string | null => updatedAt(identity.representative);

// Added or updated in the last 14 days (Desktop's "New").
export function isNew(at: string | null, now: number): boolean {
  const t = at === null ? NaN : Date.parse(at);
  return Number.isFinite(t) && now - t >= 0 && now - t <= NEW_MS;
}

// "3 days ago" under a week, then "Oct 3", the year added when it is not this year; the full date and time as its title.
export function dateWords(at: string | null, now: number): { text: string; title: string } | null {
  const t = at === null ? NaN : Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const date = new Date(t);
  const title = date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  if (now - t < WEEK_MS) return { text: relativeAge(Math.max(0, now - t)), title };
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return { text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(!sameYear && { year: 'numeric' }) }), title };
}

// A version the engine reports; "unknown" or nothing is none (a 12-character commit prefix is a version as it is).
export const versionWords = (version: string | null): string | null => (version === null || version.trim() === '' || version === 'unknown' ? null : version);

// ---- the view --------------------------------------------------------------------------------------------------------

export type LibraryFilter = 'all' | 'enabled' | 'disabled' | 'loaded' | 'otherProjects';
export type LibrarySort = 'updated' | 'name';

const byName = (a: PluginIdentity, b: PluginIdentity) => displayNameOf(a.name, a.manifest).localeCompare(displayNameOf(b.name, b.manifest), 'en', { sensitivity: 'base' });
const byUpdated = (a: PluginIdentity, b: PluginIdentity) => timeOf(b.representative) - timeOf(a.representative) || byName(a, b);

const matches = (identity: PluginIdentity, needle: string): boolean =>
  needle === '' || [displayNameOf(identity.name, identity.manifest), identity.id, identity.manifest?.author ?? '', identity.manifest?.description ?? ''].some((text) => text.toLowerCase().includes(needle));

function shown(identity: PluginIdentity, filter: LibraryFilter, loadedIds: ReadonlySet<string> | null): boolean {
  switch (filter) {
    case 'all':
      return identity.group !== null;
    case 'enabled':
      return identity.group !== null && identity.enabledHere;
    case 'disabled':
      return identity.group !== null && !identity.enabledHere;
    case 'loaded':
      return loadedIds?.has(identity.id) ?? false;
    case 'otherProjects':
      return identity.group === null;
  }
}

// Whether the view narrows the list (a search or a Show other than All): only such a view can find nothing to match.
export const isNarrowed = (view: { search: string; filter: LibraryFilter }): boolean => view.search.trim() !== '' || view.filter !== 'all';

// The list as drawn: the groups in Desktop's order (an empty one dropped, except "In this project" in the default view,
// which says so), each newest first; a sort other than the default flattens them into one list (group null), kept
// empty when the view is not narrowed so it can say so too; Other projects is its own list. An empty result means
// nothing matched the view's search or Show.
export function myItems(identities: readonly PluginIdentity[], view: { search: string; filter: LibraryFilter; sort: LibrarySort; loadedIds: ReadonlySet<string> | null }): { group: SourceGroup | 'otherProjects' | null; rows: PluginIdentity[] }[] {
  const needle = view.search.trim().toLowerCase();
  const rows = identities.filter((i) => shown(i, view.filter, view.loadedIds) && matches(i, needle));
  const narrowed = isNarrowed(view);
  if (view.sort === 'name') return rows.length === 0 && narrowed ? [] : [{ group: null, rows: [...rows].sort(byName) }];
  if (view.filter === 'otherProjects') return rows.length === 0 ? [] : [{ group: 'otherProjects', rows: [...rows].sort(byUpdated) }];
  return GROUP_ORDER.map((group) => ({ group, rows: rows.filter((i) => i.group === group).sort(byUpdated) })).filter(({ group, rows }) => rows.length > 0 || (group === 'here' && !narrowed));
}

export type LoadedOnly = { name: string; source: string; kind: 'builtin' | 'folder' | 'other' };

// Loaded plugins that are no identity of the list: the engine's own (`@builtin`), a folder's (a skills directory, a
// `--plugin-dir`), or another the CLI does not list. In the engine's order; `loadedOnlyShown` applies the view.
export function loadedOnly(loaded: readonly ObservedPlugin[], identities: readonly PluginIdentity[]): LoadedOnly[] {
  const listed = new Set(identities.map((i) => i.id));
  return loaded
    .filter((p) => p.source === null || !listed.has(p.source))
    .map((p) => {
      const source = p.source ?? '';
      const kind = p.path === 'builtin' || source.endsWith('@builtin') ? 'builtin' : p.source === null || source.endsWith(`@${SKILLS_DIR}`) || source.endsWith('@inline') ? 'folder' : 'other';
      return { name: p.name, source, kind };
    });
}

// The loaded-only rows through the view's search (their name and id) and sort. They carry no date, so under either sort
// the name orders them (Last updated's tie-breaker).
export function loadedOnlyShown(extras: readonly LoadedOnly[], search: string): LoadedOnly[] {
  const needle = search.trim().toLowerCase();
  return extras.filter((p) => needle === '' || [p.name, p.source].some((text) => text.toLowerCase().includes(needle))).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

// The init's problems under the plugins shown: all of them when the view is not searched (a plugin that failed to load is
// no row), else those whose plugin is a shown row or matches the search. The engine names a problem's plugin by name.
export function problemsShown<P extends { plugin: string }>(problems: readonly P[], search: string, rows: readonly PluginIdentity[], extras: readonly LoadedOnly[]): P[] {
  const needle = search.trim().toLowerCase();
  if (needle === '') return [...problems];
  const shownNames = new Set([...rows.flatMap((i) => [i.id, i.name]), ...extras.flatMap((p) => [p.name, p.source])]);
  return problems.filter((p) => shownNames.has(p.plugin) || p.plugin.toLowerCase().includes(needle));
}
