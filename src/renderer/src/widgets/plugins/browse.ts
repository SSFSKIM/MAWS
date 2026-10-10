// Browse's model (P2-B execution document §5.8): what the engine's configured sources offer (`plugin list --json
// --available`: the built-in directory and every added marketplace, owner decision 5), one card per plugin. Two rules
// are the engine's own (U3 F5, 3e). Its terminal folds a built-in directory entry and the same plugin in Anthropic's
// marketplace into one item, by the source key `sourceKey` ports; `--available` does not, so Browse does, and only
// there: a directory entry with an entry of the default Anthropic marketplace on one exact key, the directory's card
// keeping the larger count (no key, no fold; a third party never folds). And `--available` leaves out every id installed
// anywhere, so Browse adds a card for each installed identity of a listed source, "Installed" when it is installed for
// the user or here, "Installed in other projects" when only other projects have it; the directory twin the engine hides
// for an installed plugin stays hidden. A count is the CLI's positive number or none (a 0 is none), never derived,
// summed or shown as 0. Pure: the components and the tests read these.
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import type { AvailablePlugin, InstalledPlugin } from '@shared/ipc/schema/plugins';
import { isAnthropicDefaultMarketplace, sourceKey } from '@shared/plugins/source-key';
import { BUILT_IN_DIRECTORY, displayNameOf, groupOfMarketplace, isPseudo, versionWords, type PluginIdentity } from './library';

// A card's section: Anthropic's (the built-in directory and the default Anthropic marketplace) or a marketplace's own.
// A kind, not a name, so a third-party marketplace that calls itself `anthropic` stays its own section and Source.
export type BrowseSection = { kind: 'anthropic' } | { kind: 'marketplace'; name: string };
// One string per section, never shared by two (the Source filter's radio value, React keys, `data-section`).
export const sectionKey = (section: BrowseSection): string => (section.kind === 'anthropic' ? 'anthropic' : `marketplace:${section.name}`);
const ANTHROPIC_SECTION: BrowseSection = { kind: 'anthropic' };

export interface BrowseCard {
  pluginId: string; // the id an install names: the directory's when folded, as the engine's terminal installs it
  name: string; // the plugin's name (the card draws Desktop's display name of it)
  description: string | null;
  marketplace: string;
  section: BrowseSection; // "From Anthropic & Partners", else the marketplace's own section
  alsoListedIn: string[]; // the Anthropic marketplace a folded directory card also stands for
  installCount: number | null;
  version: string | null;
  installed: { identity: PluginIdentity; where: 'here' | 'otherProjects' } | null;
  inventoryFrom: string | null; // the offered id whose files sit in its marketplace's clone (What's inside), if any
}

// An installation only another project has (a project or local one neither here nor covering here).
const elsewhere = (p: InstalledPlugin): boolean => (p.scope === 'project' || p.scope === 'local') && !p.here && !p.coversHere && !isPseudo(p);
const installedOf = (identity: PluginIdentity): BrowseCard['installed'] => ({ identity, where: identity.installations.every(elsewhere) ? 'otherProjects' : 'here' });

// A count is the CLI's positive number; a 0 (or anything not above it) is no count, so none is ever shown as 0 (§5.8).
const countOf = (n: number | null): number | null => (n !== null && n > 0 ? n : null);
const larger = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

export function browseCards(available: readonly AvailablePlugin[], identities: readonly PluginIdentity[], marketplaces: readonly Marketplace[]): BrowseCard[] {
  const markets = new Map(marketplaces.map((m) => [m.name, m]));
  const sectionOf = (marketplace: string): BrowseSection => (groupOfMarketplace(marketplace, marketplaces) === 'anthropic' ? ANTHROPIC_SECTION : { kind: 'marketplace', name: marketplace });
  // an offer's files sit in its marketplace's clone when its source is a path inside it (§5.5)
  const onDisk = (offer: AvailablePlugin): boolean => typeof offer.source === 'string' && markets.has(offer.marketplaceName);
  const installedById = new Map(identities.map((i) => [i.id, i]));

  // the default Anthropic marketplace's entries by key, each folding with one directory entry at most
  const official = new Map<string, AvailablePlugin>();
  for (const offer of available) {
    const market = markets.get(offer.marketplaceName);
    if (!market || !isAnthropicDefaultMarketplace(market)) continue;
    const key = sourceKey(offer.source, market);
    if (key !== null && !official.has(key)) official.set(key, offer);
  }
  const folded = new Map<string, AvailablePlugin>(); // directory id → the official entry it stands for
  const consumed = new Set<string>();
  for (const offer of available) {
    if (offer.marketplaceName !== BUILT_IN_DIRECTORY) continue;
    const key = sourceKey(offer.source, null);
    const twin = key === null ? undefined : official.get(key);
    // an official twin already installed (a catalogue answer read before its install, retained or not yet reread): the
    // engine hides the directory entry of an installed plugin, so the official entry is the one card, installed
    if (twin && installedById.has(twin.pluginId) && !installedById.has(offer.pluginId)) {
      consumed.add(offer.pluginId);
      continue;
    }
    if (twin && !consumed.has(twin.pluginId)) {
      folded.set(offer.pluginId, twin);
      consumed.add(twin.pluginId);
    }
  }

  const cards: BrowseCard[] = [];
  const carded = new Set<string>();
  for (const offer of available) {
    if (consumed.has(offer.pluginId) || carded.has(offer.pluginId)) continue;
    const twin = folded.get(offer.pluginId) ?? null;
    const identity = installedById.get(offer.pluginId);
    carded.add(offer.pluginId);
    cards.push({
      pluginId: offer.pluginId,
      name: offer.name,
      description: offer.description ?? twin?.description ?? null,
      marketplace: offer.marketplaceName,
      section: sectionOf(offer.marketplaceName),
      alsoListedIn: twin ? [twin.marketplaceName] : [],
      installCount: larger(countOf(offer.installCount), countOf(twin?.installCount ?? null)),
      version: versionWords(offer.version ?? twin?.version ?? null),
      installed: identity ? installedOf(identity) : null,
      inventoryFrom: onDisk(offer) ? offer.pluginId : twin && onDisk(twin) ? twin.pluginId : null,
    });
  }
  // the installed identities of a listed source, which the engine's listing leaves out
  for (const identity of identities) {
    if (carded.has(identity.id) || (identity.marketplace !== BUILT_IN_DIRECTORY && !markets.has(identity.marketplace))) continue;
    carded.add(identity.id);
    cards.push({
      pluginId: identity.id,
      name: identity.name,
      description: identity.manifest?.description ?? null,
      marketplace: identity.marketplace,
      section: sectionOf(identity.marketplace),
      alsoListedIn: [],
      installCount: null,
      version: versionWords(identity.representative.version),
      installed: installedOf(identity),
      inventoryFrom: null,
    });
  }
  return cards;
}

// Desktop's install count (readable/app-2.16120.0/web/app/v1/c2b3583e6-Or70mVDF.js): the integer below 1,000, then one
// decimal with ".0" dropped and an uppercase K or M (999,950 rounds up to 1M). Not `Intl`'s compact notation, which
// rounds differently.
export function installCountWords(n: number): string {
  if (n < 1000) return String(n);
  const [scaled, unit] = n < 999_950 ? [n / 1000, 'K'] : [n / 1_000_000, 'M'];
  const fixed = scaled.toFixed(1);
  return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}${unit}`;
}

// ---- the view --------------------------------------------------------------------------------------------------------

export type BrowseSort = 'popular' | 'name';
export interface BrowseChoices {
  search: string;
  sort: BrowseSort | null; // null: Most popular when a card has a count, else Name
  status: { installed: boolean; notInstalled: boolean }; // Desktop's Status: at least one stays checked
  source: BrowseSection | null; // a section; null: All sources
}

export const titleOf = (card: BrowseCard): string => displayNameOf(card.name, card.installed?.identity.manifest ?? null);
export const isInstalledHere = (card: BrowseCard): boolean => card.installed?.where === 'here';

const byTitle = (a: BrowseCard, b: BrowseCard) => titleOf(a).localeCompare(titleOf(b), 'en', { sensitivity: 'base' }) || a.pluginId.localeCompare(b.pluginId);
// Desktop's Most popular: counted cards first, by count; then the rest by name
const byCount = (a: BrowseCard, b: BrowseCard) => (b.installCount ?? -1) - (a.installCount ?? -1) || byTitle(a, b);

const matches = (card: BrowseCard, needle: string) => needle === '' || [titleOf(card), card.pluginId, card.description ?? ''].some((text) => text.toLowerCase().includes(needle));

// The sections as drawn: "From Anthropic & Partners" first, then each other marketplace by name, each in the view's
// order; Most popular is offered only when some card has a count (Desktop's rule), and falls back to Name otherwise.
export interface BrowseViewResult {
  sections: { section: BrowseSection; cards: BrowseCard[] }[];
  sources: BrowseSection[]; // every section, in order: what the Source filter offers
  sort: BrowseSort; // the order applied
  hasCounts: boolean; // whether Most popular is offered
}

export function browseView(cards: readonly BrowseCard[], view: BrowseChoices): BrowseViewResult {
  const hasCounts = cards.some((c) => c.installCount !== null);
  const sort: BrowseSort = view.sort === 'name' || !hasCounts ? 'name' : 'popular';
  const sources = [...new Map(cards.map((c) => [sectionKey(c.section), c.section])).values()].sort((a, b) =>
    a.kind === 'anthropic' ? -1 : b.kind === 'anthropic' ? 1 : a.name.localeCompare(b.name, 'en'),
  );
  const needle = view.search.trim().toLowerCase();
  const source = view.source === null ? null : sectionKey(view.source);
  const shown = cards.filter((c) => (isInstalledHere(c) ? view.status.installed : view.status.notInstalled) && (source === null || sectionKey(c.section) === source) && matches(c, needle));
  const order = sort === 'popular' ? byCount : byTitle;
  const sections = sources.map((section) => ({ section, cards: shown.filter((c) => sectionKey(c.section) === sectionKey(section)).sort(order) })).filter((s) => s.cards.length > 0);
  return { sections, sources, sort, hasCounts };
}
