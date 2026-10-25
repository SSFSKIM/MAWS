// What Discover says about one catalog item (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "A
// card", "The trust label", "Components before install", "Adding"). Pure: the cards, the detail, the install sheet and
// the tests read these.
// - The trust label comes from the directory's review tier where it has one (Verified · Partner · Community), else from
//   the ownership class of the chosen route (Listed by Anthropic · Listed by <vendor> · Community · Added by you).
// - The components line counts what a source lists; with nothing listed it says the contents come after install.
// - The runs-code warning names hooks, local (stdio) MCP servers and a CLI; an item whose contents are unknown gets
//   Desktop's softer "may include".
// - Counts are shown where a source has them and nowhere else: installs for official plugins, a rank for connectors.
import type { CatalogItem, CatalogTab } from '@shared/ipc/schema/catalog';
import { DISCOVER as D } from './copy';
import { CONNECTORS as C } from '../connectors/copy';

export interface Trust {
  label: string;
  tooltip: string;
}

/** The marketplace the item's chosen route installs from, when it has one. */
export const marketplaceOf = (item: CatalogItem): string | null => (item.install.kind === 'plugin' ? item.install.marketplaceName : null);

export function trustOf(item: CatalogItem): Trust {
  const kind = item.kind;
  switch (item.reviewTier) {
    case 'anthropic':
      return { label: D.trust.verified, tooltip: D.trustTip.verified(kind) };
    case 'partner':
      return { label: D.trust.partner, tooltip: D.trustTip.partner };
    case 'community':
      return { label: D.trust.community, tooltip: D.trustTip.community(kind) };
  }
  const listed = D.trustTip.listed(marketplaceOf(item) ?? item.name);
  switch (item.ownership) {
    case 'anthropic':
      return { label: D.trust.listedByAnthropic, tooltip: listed };
    case 'partner':
      return { label: D.trust.listedBy(item.publisher ?? marketplaceOf(item) ?? item.name), tooltip: listed };
    case 'community':
      return { label: D.trust.community, tooltip: D.trustTip.community(kind) };
    case 'added':
      return { label: D.trust.added, tooltip: D.trustTip.added };
  }
}

/** The parts the components line and the sheet's "Comes with" list, in one order. */
export function componentParts(item: CatalogItem): string[] | null {
  const c = item.components;
  if (c === null) return null;
  const parts: string[] = [];
  if (c.skills.length > 0) parts.push(D.skills(c.skills.length));
  if (c.mcpServers.length > 0) parts.push(D.mcpServers(c.mcpServers.length));
  if (c.hooks) parts.push(D.hooks);
  if (c.commands > 0) parts.push(D.commands(c.commands));
  if (c.agents > 0) parts.push(D.agents(c.agents));
  if (c.cli) parts.push(D.cli);
  return parts;
}

export function componentsWords(item: CatalogItem): string {
  const parts = componentParts(item);
  if (parts === null) return D.contentsUnknown;
  return [...parts, ...(item.runsOnYourComputer === true ? [D.runsCode] : [])].join(' · ');
}

/** A card's contents line: on Skills, the skills by name (the Design's Skills row); a connector's URL; elsewhere the
 * components line. */
export function cardContentsWords(item: CatalogItem, tab: CatalogTab): string {
  if (item.install.kind === 'connector') return item.install.url ?? item.install.urlOptions[0]?.url ?? C.asksInstanceUrl; // P4-AGG M4: the URL it adds
  const skills = item.components?.skills ?? [];
  return tab === 'skills' && skills.length > 0 ? skills.join(', ') : componentsWords(item);
}

/** The install sheet's and the detail's warning: what runs code, the softer wording for unknown contents, or none. */
export function runsCodeWords(item: CatalogItem): string | null {
  if (item.runsOnYourComputer === 'unknown') return D.mayRunCode;
  if (item.runsOnYourComputer === false) return null;
  const c = item.components;
  const named: string[] = [];
  if (c?.hooks) named.push(D.codeHooks);
  const local = c?.mcpServers.filter((server) => server.transport === 'stdio').length ?? 0;
  if (local > 0) named.push(D.codeLocalServers(local));
  if (c?.cli) named.push(D.codeCli);
  return named.length > 0 ? D.runsCodeNamed(named) : D.runsCodeUnnamed;
}

/** An install count as Desktop formats it: the integer below 1,000, then one decimal (".0" dropped) with K or M. */
export function installCountWords(n: number): string {
  if (n < 1000) return String(n);
  const [scaled, unit] = n < 999_950 ? [n / 1000, 'K'] : [n / 1_000_000, 'M'];
  const fixed = scaled.toFixed(1);
  return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}${unit}`;
}

/** "1.3M installs" or "#4 most popular", where a source has the number; a 0 is no count. */
export function metricWords(item: CatalogItem): string | null {
  if (item.kind === 'connector') return item.rank !== null && item.rank > 0 ? D.rank(item.rank) : null;
  return item.installs !== null && item.installs > 0 ? D.installs(installCountWords(item.installs)) : null;
}

/** Whether + can add the item: a plugin route, and no failed scan. */
export const addable = (item: CatalogItem): boolean => item.install.kind !== 'manual' && item.scanBlocked === null;

/** A monogram for an item with no icon: its name's first letter or digit. */
// An icon's stand-in: the name from its first letter or digit; a letter alone, or the first two characters where the
// name starts with a digit (42crunch reads 42, not 4).
export const monogramOf = (name: string): string => {
  const from = name.match(/[\p{L}\p{N}].*/su)?.[0];
  if (!from) return '?';
  return (/^\p{N}/u.test(from) ? [...from].slice(0, 2).join('') : [...from][0]!).toUpperCase();
};
