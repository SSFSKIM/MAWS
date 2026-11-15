// Discover's reads over one cwd's catalog (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Discover, per tab" and Interfaces): the home's Featured card and shelves, and the query's filtered, sorted pages.
// - Tabs: Plugins lists every plugin; Skills the plugins whose skills are known; Connectors the directory's servers.
// - Featured is derived, never editorial: on Plugins and Skills the most-installed item listed by Anthropic that is not
//   installed here; on Connectors the best-ranked one not configured here.
// - Categories: every value of the chosen axis in the tab with its count, the Category filter's choices.
// - Shelves: "Your sources" (marketplaces the person added), one per seed with more than one item in seed order, then the
//   four largest categories. Community items are on no shelf (the owner's ruling), only in search and All.
// - Order: installs (rank for connectors) descending, then updated descending, then name, ties by id; or updated, or
//   name. `reverse` turns the whole order round, ties included, so both directions are total.
// - Search covers both names and the description; a match on a name ranks above a match on the description only.
// - All (UX wave U11c M4, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §F): both kinds. Its home is the
//   Plugins home's Featured and a shelf per kind, Plugins, Skills, Connectors, each of that kind's first items in its own
//   shelf order with no community item (the ruling above, carried forward), Skills leaving out Plugins' cards, each total
//   the kind's whole count, and no categories. Its query has one order whatever sort is sent (installs and rank do not
//   mix): a name match first, then by name, ties by id; the category is ignored.
// - A cursor carries the catalog revision, the order and the last item's sort key: under another revision the query
//   restarts from the first page and says so.
import type { CatalogChip, CatalogHome, CatalogItem, CatalogKindTab, CatalogPage, CatalogQueryInput, CatalogShelf, CatalogSort, CatalogTab } from '@shared/ipc/schema/catalog';
import { CATALOG_PAGE_SIZE } from '@shared/ipc/schema/catalog';
import { ownershipOfRoute } from './join';
import { COMMUNITY, ownershipOf, SEEDS } from './sources';

const SHELF_ITEMS = 12; // a shelf's row: as many cards as fit, the renderer decides; See all has the rest
const CATEGORY_SHELVES = 4;

export function inTab(item: CatalogItem, tab: CatalogTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'connectors') return item.kind === 'connector';
  return item.kind === 'plugin' && (tab === 'plugins' || (item.components?.skills.length ?? 0) > 0);
}

/** The trust label's class: the directory's review tier, else the ownership. */
export const chipOf = (item: CatalogItem): CatalogChip => item.reviewTier ?? item.ownership;
const isCommunity = (item: CatalogItem) => chipOf(item) === 'community';
const marketplacesOf = (item: CatalogItem): string[] => (item.install.kind === 'plugin' ? [item.install.marketplaceName, ...item.alsoListedBy] : []);
// A route's ownership as the build verified it (a seed's name from another repository is `added`); by name otherwise.
const ownershipIn = (item: CatalogItem, name: string) => ownershipOfRoute(item, name) ?? ownershipOf(name);

/** Whether an item belongs to a source filter: a seed's source key, or `added` (a marketplace the person added). */
export function inSource(item: CatalogItem, source: string): boolean {
  if (source === 'added') return marketplacesOf(item).some((name) => ownershipIn(item, name) === 'added');
  const seed = SEEDS.find((s) => s.key === source);
  return seed !== undefined && marketplacesOf(item).some((name) => name === seed.marketplaceName && ownershipIn(item, name) !== 'added');
}

// -- order ---------------------------------------------------------------------------------------------------------

type Key = (number | string)[];
const LAST = Number.MAX_VALUE; // a missing count or date sorts after every present one
const timeOf = (iso: string | null) => {
  const t = iso === null ? NaN : Date.parse(iso);
  return Number.isNaN(t) ? LAST : -t;
};

function sortKey(item: CatalogItem, sort: CatalogSort, group: number): Key {
  const name = item.name.toLowerCase();
  if (sort === 'name') return [group, name, item.id];
  if (sort === 'updated') return [group, timeOf(item.updatedAt), name, item.id];
  const popularity = item.kind === 'connector' ? (item.rank ?? LAST) : item.installs === null ? LAST : -item.installs;
  return [group, popularity, timeOf(item.updatedAt), name, item.id];
}

function compareKeys(a: Key, b: Key): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// -- search --------------------------------------------------------------------------------------------------------

// 0: a name matches; 1: only the description; null: neither.
function matchGroup(item: CatalogItem, needle: string): number | null {
  if (needle === '') return 0;
  if ([item.name, item.installName ?? ''].some((name) => name.toLowerCase().includes(needle))) return 0;
  return (item.description ?? '').toLowerCase().includes(needle) ? 1 : null;
}

// -- the home ------------------------------------------------------------------------------------------------------

const shelfOrder = (items: readonly CatalogItem[]) => [...items].sort((a, b) => compareKeys(sortKey(a, 'installs', 0), sortKey(b, 'installs', 0)));
const shelf = (key: string, kind: CatalogShelf['kind'], title: string, items: readonly CatalogItem[]): CatalogShelf => ({ key, kind, title, items: shelfOrder(items).slice(0, SHELF_ITEMS), total: items.length });
// A taxonomy value as a shelf's title: `files-documents` is "Files & documents", `ai-models-agents` "AI models agents"
const ACRONYMS: Record<string, string> = { ai: 'AI', apis: 'APIs', api: 'API', crm: 'CRM', seo: 'SEO' };
export function categoryTitle(value: string): string {
  const words = value.split('-').map((word) => ACRONYMS[word] ?? word);
  const text = words.length === 2 ? `${words[0]} & ${words[1]}` : words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function featuredOf(items: readonly CatalogItem[], tab: CatalogTab): CatalogItem | null {
  const candidates = items.filter((item) => item.installed !== 'here' && item.scanBlocked === null);
  if (tab === 'connectors') return shelfOrder(candidates.filter((item) => item.rank !== null))[0] ?? null;
  return shelfOrder(candidates.filter((item) => item.installs !== null && item.install.kind === 'plugin' && marketplacesOf(item).some((name) => ownershipIn(item, name) === 'anthropic')))[0] ?? null;
}

const KIND_SHELVES: readonly [CatalogKindTab, string][] = [
  ['plugins', 'Plugins'],
  ['skills', 'Skills'],
  ['connectors', 'Connectors'],
];

// All's home: a shelf per kind; the Skills shelf leaves out the Plugins shelf's cards (a plugin with skills is in both kinds)
function allHomeOf(catalog: readonly CatalogItem[]): CatalogHome {
  const shown = new Set<string>();
  const shelves = KIND_SHELVES.map(([tab, title]): CatalogShelf => {
    const items = catalog.filter((item) => inTab(item, tab));
    const first = shelfOrder(items.filter((item) => !isCommunity(item) && !shown.has(item.id))).slice(0, SHELF_ITEMS);
    for (const item of first) shown.add(item.id);
    return { key: `kind:${tab}`, kind: 'kind', title, items: first, total: items.length };
  });
  return { featured: featuredOf(catalog.filter((item) => inTab(item, 'plugins')), 'plugins'), shelves, categories: [], total: catalog.length };
}

export function homeOf(catalog: readonly CatalogItem[], tab: CatalogTab): CatalogHome {
  if (tab === 'all') return allHomeOf(catalog);
  const items = catalog.filter((item) => inTab(item, tab));
  const shelved = items.filter((item) => !isCommunity(item));
  const shelves: CatalogShelf[] = [];
  const added = shelved.filter((item) => inSource(item, 'added'));
  if (added.length > 0) shelves.push(shelf('added', 'added', 'Your sources', added));
  for (const seed of SEEDS) {
    if (seed.marketplaceName === COMMUNITY) continue;
    const listed = shelved.filter((item) => inSource(item, seed.key));
    if (listed.length > 1) shelves.push(shelf(seed.key, 'source', seed.label, listed));
  }
  const counts = new Map<string, number>();
  for (const item of shelved) for (const category of new Set(item.categories)) counts.set(category, (counts.get(category) ?? 0) + 1);
  const categories = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, CATEGORY_SHELVES);
  for (const [category] of categories) shelves.push(shelf(`category:${category}`, 'category', categoryTitle(category), shelved.filter((item) => item.categories.includes(category))));
  // the Category filter's choices: every value in the tab, community items included (the filter applies to All and search)
  const all = new Map<string, number>();
  for (const item of items) for (const category of new Set(item.categories)) all.set(category, (all.get(category) ?? 0) + 1);
  const choices = [...all].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([value, total]) => ({ value, title: categoryTitle(value), total }));
  return { featured: featuredOf(items, tab), shelves, categories: choices, total: items.length };
}

// -- the query -----------------------------------------------------------------------------------------------------

interface Cursor {
  revision: string;
  sort: CatalogSort;
  reverse: boolean;
  key: Key;
}
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
function decode(text: string): Cursor | null {
  try {
    const value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof value.revision !== 'string' || typeof value.sort !== 'string' || typeof value.reverse !== 'boolean' || !Array.isArray(value.key)) return null;
    return value as Cursor;
  } catch {
    return null;
  }
}

export function queryOf(catalog: readonly CatalogItem[], input: CatalogQueryInput, revision: string): CatalogPage {
  const needle = (input.text ?? '').trim().toLowerCase();
  const chips = new Set(input.chips ?? []);
  const sort = input.tab === 'all' ? 'name' : (input.sort ?? 'installs'); // All: one order, whatever is sent
  const reverse = input.reverse ?? false;
  const keyed: { item: CatalogItem; key: Key }[] = [];
  for (const item of catalog) {
    if (!inTab(item, input.tab)) continue;
    if (chips.size > 0 && !chips.has(chipOf(item))) continue;
    if (input.category && input.tab !== 'all' && !item.categories.includes(input.category)) continue;
    if (input.source && !inSource(item, input.source)) continue;
    if (input.notInstalled && item.installed === 'here') continue;
    const group = matchGroup(item, needle);
    if (group === null) continue;
    keyed.push({ item, key: sortKey(item, sort, group) });
  }
  const direction = reverse ? -1 : 1;
  keyed.sort((a, b) => direction * compareKeys(a.key, b.key));

  const cursor = input.cursor ? decode(input.cursor) : null;
  const restarted = Boolean(input.cursor) && (cursor === null || cursor.revision !== revision || cursor.sort !== sort || cursor.reverse !== reverse);
  const from = cursor !== null && !restarted ? keyed.findIndex((k) => direction * compareKeys(k.key, cursor.key) > 0) : 0;
  const start = from === -1 ? keyed.length : from;
  const limit = input.limit ?? CATALOG_PAGE_SIZE;
  const page = keyed.slice(start, start + limit);
  const last = page.at(-1);
  const nextCursor = last !== undefined && start + limit < keyed.length ? encode({ revision, sort, reverse, key: last.key }) : null;
  return { items: page.map((k) => k.item), nextCursor, total: keyed.length, restarted };
}
