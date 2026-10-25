// The Discover catalog's sources (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Sources"):
// the general seed marketplaces (the owner's own marketplaces are not seeds: they reach Discover as marketplaces the
// person added, fact 1a), the engine's built-in Anthropic Directory, the order routes are chosen in, and the fixture-only
// test-source seam (Sources, 3a).
import { readFileSync } from 'node:fs';
import * as z from 'zod';
import type { Ownership } from '@shared/ipc/schema/catalog';

// M1 fixed this seam's name: when this environment variable names a JSON file, each descriptor in it,
// `{key, label, ownership: 'added', marketplaceName, marketplaceSource, manifestPath}`, is one more source (the e2e launch
// writes it for the local test marketplace). It adds sources only; every engine read and mutation stays real.
export const CATALOG_TEST_SOURCES_ENV = 'MAWS_CATALOG_TEST_SOURCES';

export interface Seed {
  key: `seed:${string}`; // the network source key, `seed:<marketplace name>`
  repository: string; // owner/repo on GitHub: what `plugin marketplace add` takes
  marketplaceName: string;
  label: string;
  publisher: string; // the organisation that publishes it: the publisher chain's fallback for the seed's own code (Decision Log 7)
  ownership: Exclude<Ownership, 'added'>;
}

const seed = (repository: string, marketplaceName: string, label: string, ownership: Seed['ownership'], publisher = 'Anthropic'): Seed => ({ key: `seed:${marketplaceName}`, repository, marketplaceName, label, publisher, ownership });

// The spec's twelve general repositories, in its table's order (fact 1).
export const SEEDS: readonly Seed[] = [
  seed('anthropics/claude-plugins-official', 'claude-plugins-official', 'Anthropic official plugins', 'anthropic'),
  seed('anthropics/claude-plugins-community', 'claude-community', 'Community plugins', 'community'),
  seed('anthropics/skills', 'anthropic-agent-skills', 'Anthropic skills', 'anthropic'),
  seed('anthropics/financial-services', 'claude-for-financial-services', 'Claude for Financial Services', 'anthropic'),
  seed('anthropics/knowledge-work-plugins', 'knowledge-work-plugins', 'Knowledge work plugins', 'anthropic'),
  seed('anthropics/claude-for-legal', 'claude-for-legal', 'Claude for Legal', 'anthropic'),
  seed('anthropics/life-sciences', 'life-sciences', 'Life sciences', 'anthropic'),
  seed('anthropics/k12-teacher-skills', 'k12-teacher-skills', 'K-12 teacher skills', 'anthropic'),
  seed('anthropics/claude-for-financial-advisors', 'claude-for-financial-advisors', 'Claude for Financial Advisors', 'anthropic'),
  seed('makenotion/claude-code-notion-plugin', 'notion-plugin-marketplace', 'Notion', 'partner', 'Notion'),
  seed('canva-sdks/canva-skills', 'canva-skills', 'Canva', 'partner', 'Canva'),
  seed('carta/plugins', 'carta-plugins', 'Carta', 'partner', 'Carta'),
];

export const OFFICIAL = 'claude-plugins-official';
export const COMMUNITY = 'claude-community';
// The engine's built-in marketplace over Anthropic's directory (fact 2): always the engine's, never a listed row.
export const DIRECTORY_MARKETPLACE = 'anthropic-plugin-directory';

const seedByName = new Map(SEEDS.map((s, order) => [s.marketplaceName, { seed: s, order }]));
export const seedOf = (marketplaceName: string): Seed | null => seedByName.get(marketplaceName)?.seed ?? null;

// A route's ownership class: a seed's own, the engine's directory Anthropic's, anything else the person added.
export function ownershipOf(marketplaceName: string): Ownership {
  if (marketplaceName === DIRECTORY_MARKETPLACE) return 'anthropic';
  return seedOf(marketplaceName)?.ownership ?? 'added';
}

// Route precedence (Design, "One item per thing"): routes whose marketplace the engine already has first, so + never
// adds a marketplace it does not need; within each group claude-plugins-official, the other seeds in table order, the
// engine's Anthropic Directory, claude-community, then a marketplace the person added. Lower ranks first. `known` false:
// the name is a seed's but the repository is not (normalize.ts verifies it).
export function routeRank(marketplaceName: string, present: boolean, known = true): number {
  const group = present ? 0 : 1_000;
  if (!known) return group + 300; // a marketplace named like a seed or the directory but not it: one the person added
  if (marketplaceName === OFFICIAL) return group;
  if (marketplaceName === DIRECTORY_MARKETPLACE) return group + 100;
  if (marketplaceName === COMMUNITY) return group + 200;
  const order = seedByName.get(marketplaceName)?.order;
  return order === undefined ? group + 300 : group + 1 + order;
}

// -- the test-source seam (fixture-only) ----------------------------------------------------------------------------

const TestSourceSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  ownership: z.literal('added'),
  marketplaceName: z.string().min(1),
  marketplaceSource: z.string().startsWith('/'), // the scratch absolute path `plugin marketplace add` takes
  manifestPath: z.string().startsWith('/'), // its `.claude-plugin/marketplace.json`, read from disk
});
export type TestSource = z.infer<typeof TestSourceSchema>;

// The descriptors the environment names, or none. A descriptor file that does not parse stops the catalog loudly: the
// seam exists for tests, and a test whose sources silently vanished would prove nothing.
export function testSources(env: Record<string, string | undefined>, read: (path: string) => string = (path) => readFileSync(path, 'utf8')): TestSource[] {
  const path = env[CATALOG_TEST_SOURCES_ENV];
  if (!path) return [];
  return z.array(TestSourceSchema).parse(JSON.parse(read(path)));
}
