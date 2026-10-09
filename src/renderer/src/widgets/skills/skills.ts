// The skills library's model (P2-B execution document §5.10): `get_skills_dialog`'s skills in My items' groups by where
// each comes from (Claude Desktop groups skills under the same headings, readable/app-2.16120.0/web/app/v1/
// c5e558aae-DNGm5L2q.js:1009-1027). A plugin's skill (`source: 'plugin'`, named `plugin:skill`) joins its plugin's group,
// the plugin found through the loaded list's source id, else the installed plugin of that name; the engine's own plugins
// (`@builtin`) are Anthropic's and a folder's (`--plugin-dir`, the skills directory) are yours. A project's skills are
// "In this project", the user's own "Created by you", the engine's built-in ones "From Anthropic & Partners", claude.ai's
// "Synced from claude.ai", and any other source "From marketplaces you added" credited with the engine's own word. An
// engine that answers the dialog empty (C11's recordings) leaves the catalogue's skills, in one list; so does a dialog
// whose rows name no source. Each skill is parsed on its own, so one malformed row costs only itself.
import * as z from 'zod';
import type { GetSkillsDialogResponse } from '@shared/wire/control';
import type { SessionCatalog } from '../../stores/catalog';
import { parseEach } from '../parts';
import { displayNameOf, GROUP_ORDER, SKILLS_DIR, type PluginIdentity, type SourceGroup } from '../plugins/library';
import type { ObservedPlugin } from '@shared/engine/observed-facts';

export interface SkillRow {
  name: string; // the engine's name, which `/<name>` invokes (a plugin's qualified)
  plugin: string | null; // the plugin's display name: the row's badge
  description: string;
  source: string; // the engine's source word; '' from the catalogue
}
export interface SkillGroup {
  group: SourceGroup | null; // null: one list (the catalogue's, or a sort that flattens)
  rows: SkillRow[];
}
export type SkillsSort = 'name' | 'plugin';

const DialogSkillSchema = z.looseObject({ name: z.string(), description: z.string().optional(), source: z.string().optional() });

// The sources the groups say for themselves; any other word is the row's credit. A Map, so a word an object inherits
// (`constructor`, `__proto__`) is as unknown as any other.
const GROUPED: ReadonlyMap<string, SourceGroup> = new Map([
  ['project', 'here'],
  ['project, gitignored', 'here'],
  ['user', 'yours'],
  ['built-in', 'anthropic'],
  ['claude.ai sync', 'synced'],
]);

const prefixOf = (name: string): string | null => (name.includes(':') ? name.slice(0, name.indexOf(':')) : null);

// The plugin a `plugin:skill` comes from, and the group it is drawn in.
function pluginOf(prefix: string, loaded: readonly ObservedPlugin[], identities: readonly PluginIdentity[]): { plugin: string; group: SourceGroup } {
  const source = loaded.find((p) => p.name === prefix)?.source ?? null;
  const identity = (source !== null ? identities.find((i) => i.id === source) : undefined) ?? identities.find((i) => i.name === prefix && i.group !== null) ?? identities.find((i) => i.name === prefix);
  if (identity) return { plugin: displayNameOf(identity.name, identity.manifest), group: identity.group ?? 'added' };
  const group: SourceGroup = source?.endsWith('@builtin') ? 'anthropic' : source !== null && (source.endsWith('@inline') || source.endsWith(`@${SKILLS_DIR}`)) ? 'yours' : 'added';
  return { plugin: displayNameOf(prefix, null), group };
}

// What the row shows as its name: the part after `plugin:` when the badge names the plugin.
export const labelOf = (row: SkillRow): string => {
  const prefix = row.plugin !== null ? prefixOf(row.name) : null;
  return prefix !== null ? row.name.slice(prefix.length + 1) : row.name;
};

// The row's badge: its plugin, else the engine's word for a source no group says.
export const badgeOf = (row: SkillRow): string | null => row.plugin ?? (row.source !== '' && row.source !== 'plugin' && !GROUPED.has(row.source) ? row.source : null);

const compare = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
const byLabel = (a: SkillRow, b: SkillRow) => compare(labelOf(a), labelOf(b)) || compare(a.name, b.name);

export function skillGroups(dialog: GetSkillsDialogResponse, catalog: SessionCatalog, loaded: readonly ObservedPlugin[], identities: readonly PluginIdentity[]): SkillGroup[] {
  const listed = parseEach(DialogSkillSchema, dialog.skills);
  if (listed.length === 0) {
    const described = new Map(catalog.commands.map((c) => [c.name, c.description]));
    return [{ group: null, rows: catalog.skills.map((name) => ({ name, plugin: null, description: described.get(name) ?? '', source: '' })).sort(byLabel) }];
  }
  if (!listed.some((s) => (s.source ?? '') !== '')) return [{ group: null, rows: listed.map((s) => ({ name: s.name, plugin: null, description: s.description ?? '', source: '' })).sort(byLabel) }];
  const placed = listed.map((s): { group: SourceGroup; row: SkillRow } => {
    const source = s.source ?? '';
    const description = s.description ?? '';
    const prefix = prefixOf(s.name);
    if ((source === 'plugin' || source === '') && prefix !== null) {
      const { plugin, group } = pluginOf(prefix, loaded, identities);
      return { group, row: { name: s.name, plugin, description, source } };
    }
    return { group: GROUPED.get(source) ?? 'added', row: { name: s.name, plugin: null, description, source } };
  });
  return GROUP_ORDER.map((group) => ({ group, rows: placed.filter((p) => p.group === group).map((p) => p.row).sort(byLabel) })).filter((g) => g.rows.length > 0);
}

export const hasPluginSkills = (groups: readonly SkillGroup[]): boolean => groups.some((g) => g.rows.some((r) => r.plugin !== null));

// The list as drawn: the search over the name, the badge and the description; Name (the default) keeps the groups,
// Plugin name flattens them (Desktop: a sort other than the default flattens), the plugins' skills by plugin first.
export function skillsView(groups: readonly SkillGroup[], view: { search: string; sort: SkillsSort }): readonly SkillGroup[] {
  const needle = view.search.trim().toLowerCase();
  if (needle === '' && view.sort === 'name') return groups;
  const matches = (row: SkillRow) => needle === '' || [row.name, badgeOf(row) ?? '', row.description].some((text) => text.toLowerCase().includes(needle));
  if (view.sort === 'plugin') {
    const rows = groups.flatMap((g) => g.rows).filter(matches);
    const byPlugin = (a: SkillRow, b: SkillRow) => (a.plugin === null ? 1 : 0) - (b.plugin === null ? 1 : 0) || compare(a.plugin ?? '', b.plugin ?? '') || byLabel(a, b);
    return rows.length === 0 ? [] : [{ group: null, rows: rows.sort(byPlugin) }];
  }
  return groups.map((g) => ({ group: g.group, rows: g.rows.filter(matches) })).filter((g) => g.rows.length > 0);
}
