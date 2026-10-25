// Every source's records as listings of one thing each (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md,
// Design "Normalising" and "One item per thing"); join.ts makes items of them. A listing carries the identity it joins
// on, the route it offers (a marketplace and an entry the engine can install), and what its source says about the plugin.
//
// Identity is the plugin's code: the repository (as the engine's fold key spells it, source-key.ts) and the path inside
// it, refs ignored. A relative entry of a local marketplace has no repository: its identity is the marketplace's path and
// the entry's. Where any one marketplace lists several entries at the same place (`strict: false` entries naming
// different skills: anthropics/skills, life-sciences), the place is ambiguous in every source: each entry there, in any
// marketplace, is its own plugin, (repository, path, entry name), and a directory record there joins the entry of its
// engine name (join.ts).
import type { CatalogComponents, ConnectorRoute, Ownership } from '@shared/ipc/schema/catalog';
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import type { AvailablePlugin, InstalledPlugin, MarketplaceManifestView, PluginManifestView, PluginSourceRef } from '@shared/ipc/schema/plugins';
import { repositoryLocation } from '@shared/plugins/source-key';
import type { DirectoryComponent, DirectoryServer, ManifestEntry, NetworkData } from './records';
import { DIRECTORY_MARKETPLACE, routeRank, seedOf, SEEDS, type Seed, type TestSource } from './sources';

export type Runs = boolean | 'unknown';
export interface Known {
  components: CatalogComponents;
  runs: Runs;
}

/** The engine's reads for one cwd (engine-reads.ts); a read that failed is null. */
export interface EngineView {
  cwd: string;
  installed: InstalledPlugin[] | null;
  available: AvailablePlugin[] | null;
  marketplaces: Marketplace[] | null;
  manifests: ReadonlyMap<string, MarketplaceManifestView>; // by marketplace name
  servers: readonly string[] | null; // the MCP server names configured in a scope that applies here
  // the place of each installed Anthropic Directory plugin's code as the engine recorded it at install (its fold key,
  // `plugins.directoryProvenance`), by entry name: the available listing omits installed plugins (fact 2a)
  directoryInstalled: ReadonlyMap<string, string>;
}

/** A test-source descriptor with its marketplace read from disk (Sources, 3a). */
export interface TestSourceData {
  source: TestSource;
  manifest: MarketplaceManifestView;
}

export interface RouteOffer {
  marketplaceName: string;
  marketplaceSource: string;
  pluginName: string;
  ref: string | null;
  present: boolean;
  rank: number;
  ownership: Ownership; // the marketplace's class, a seed's only when it is the seed's own repository (scalpel-1#2)
}

export interface EntryListing {
  kind: 'entry';
  identity: string;
  place: string | null; // where its code lives (repository#path), when anything names it
  source: string; // the source key that listed it
  route: RouteOffer;
  entryName: string;
  description: string | null;
  author: string | null;
  owner: string | null; // the marketplace's, where it published the entry: the code lives in its own repository
  known: Known | null; // what it contains, where this source can say
  knownBy: 'host' | 'entry' | null; // the host's read of the clone (or a test source's of its folder), or the entry's own declaration
  installCount: number | null; // the engine's own number
  homepage: string | null;
}

// -- components ----------------------------------------------------------------------------------------------------

const runsOf = (c: CatalogComponents, more = false): Runs => (more || c.hooks || c.cli || c.mcpServers.some((s) => s.transport === 'stdio') ? true : c.mcpServers.some((s) => s.transport === 'unknown') ? 'unknown' : false);

// The directory's components, by type, with each one's access: what runs on the computer is what Desktop warns about
// (fact 5): an access of `runs_on_your_computer`, a hook, a CLI. An empty list says nothing (145 records today).
export function knownFromDirectory(components: readonly DirectoryComponent[]): Known | null {
  if (components.length === 0) return null;
  const of = (type: string) => components.filter((c) => c.type === type);
  const known: CatalogComponents = {
    skills: of('skill').flatMap((c) => (c.name ? [c.name] : [])),
    mcpServers: of('mcp_server').map((c) => ({ name: c.name ?? 'server', transport: c.access === 'runs_on_your_computer' ? 'stdio' : 'unknown' })),
    hooks: of('hook').length > 0,
    commands: of('command').length,
    agents: of('agent').length,
    cli: of('cli').length > 0,
  };
  const runs = components.some((c) => c.access === 'runs_on_your_computer' || c.type === 'hook' || c.type === 'cli') ? true : of('mcp_server').some((c) => c.access === 'unknown') ? 'unknown' : false;
  return { components: known, runs };
}

// plugin-details' components of an official plugin: names only, so a server's transport is unknown.
export function knownFromDetail(detail: { skills: string[]; mcpServers: string[]; hooks: boolean; commands: number; agents: number }): Known {
  const components: CatalogComponents = { skills: detail.skills, mcpServers: detail.mcpServers.map((name) => ({ name, transport: 'unknown' })), hooks: detail.hooks, commands: detail.commands, agents: detail.agents, cli: false };
  return { components, runs: runsOf(components) };
}

// What the host's manifest reader found in a plugin's folder. Monitors, language servers and bundled MCP servers run on
// the computer too, though the card's components have no word for them. A partial read (a file too large, unreadable,
// or past the deadline) may have missed what runs: it says yes when what it read runs code, and otherwise unknown.
export function knownFromView(view: PluginManifestView['components'], partial = false): Known {
  const components: CatalogComponents = {
    skills: view.skills.map((s) => s.name),
    mcpServers: view.mcpServers.map((s) => ({ name: s.name, transport: s.transport === 'ws' ? 'unknown' : s.transport })),
    hooks: view.hooks.length > 0 || view.hookModules > 0,
    commands: view.commands.length,
    agents: view.agents.length,
    cli: false,
  };
  const runs = runsOf(components, view.monitors.length > 0 || view.lspServers.length > 0 || view.mcpBundles > 0);
  return { components, runs: partial && runs !== true ? 'unknown' : runs };
}

const list = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const lastSegment = (path: string) => path.split(/[\\/]/).filter((s) => s !== '' && s !== '.').at(-1) ?? null;
function transportOf(server: unknown): CatalogComponents['mcpServers'][number]['transport'] {
  if (typeof server !== 'object' || server === null) return 'unknown';
  const { type, command, url } = server as { type?: unknown; command?: unknown; url?: unknown };
  if (type === 'stdio' || (type === undefined && typeof command === 'string')) return 'stdio';
  if (type === 'http' || type === 'sse') return type;
  return type === undefined && typeof url === 'string' ? 'http' : 'unknown';
}

// A marketplace entry's own declarations, believed only for an entry that is its plugin's whole manifest
// (`strict: false`); a strict entry's plugin.json may declare more, so it says nothing.
// `mcpServers` is a map of servers, a configuration file's path, or an array of either (the engine reads each element:
// an inline map's servers counted, a path left unread, so its contents are unknown).
export function knownFromEntry(entry: ManifestEntry): Known | null {
  if (entry.strict) return null;
  const { skills, mcpServers, hooks, commands, agents } = entry.declared;
  const declarations = list(mcpServers);
  const isMap = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  const servers = declarations.flatMap((d) => (isMap(d) ? Object.entries(d) : []));
  const unread = declarations.some((d) => !isMap(d));
  const components: CatalogComponents = {
    skills: list(skills).flatMap((s) => (typeof s === 'string' && lastSegment(s) !== null ? [lastSegment(s)!] : [])),
    mcpServers: servers.map(([name, server]) => ({ name, transport: transportOf(server) })),
    hooks: hooks !== undefined && hooks !== null,
    commands: list(commands).length,
    agents: list(agents).length,
    cli: false,
  };
  const runs = runsOf(components);
  return { components, runs: unread && runs !== true ? 'unknown' : runs };
}

// -- identity ------------------------------------------------------------------------------------------------------

interface MarketplacePlace {
  name: string;
  kind: string; // the engine's source kind: github, git, url, directory, file…; a seed is github
  locator: string | null;
}

const subpath = (path: string | null) => (path ?? '').split('/').filter((s) => s !== '' && s !== '.').join('/');

// The place an entry's code lives, or null when nothing names one.
export function placeOf(source: PluginSourceRef | null, marketplace: MarketplacePlace): string | null {
  if (source === null) return null;
  if (typeof source === 'string') {
    if (marketplace.locator === null) return null;
    if (marketplace.kind === 'github' || marketplace.kind === 'git') return repositoryLocation(marketplace.locator, source);
    if (marketplace.kind === 'directory' || marketplace.kind === 'file') return `local:${marketplace.locator}#${subpath(source)}`;
    return null;
  }
  if (source.kind === 'github') return source.repo === null ? null : repositoryLocation(source.repo, source.path);
  if (source.kind === 'url' || source.kind === 'git-subdir' || source.kind === 'git') return source.url === null ? null : repositoryLocation(source.url, source.path);
  return null;
}

// The engine's entry name for a directory record's name (2.1.309 `W`, cli.pretty.js 780208: lower-cased, runs of other
// characters one hyphen, `-`, `.` and `_` trimmed at both ends); a clash's suffix is the engine's alone (fact 2).
export const directoryEntryName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '');

/** An identity: the place, told apart by entry name where the place is ambiguous; an entry no place names stands alone. */
export function identityOf(place: string | null, entryName: string, marketplaceName: string, ambiguous: ReadonlySet<string>): string {
  if (place === null) return `entry:${marketplaceName}/${entryName}`;
  return ambiguous.has(place) ? `${place}?entry=${entryName}` : place;
}

// The places some one source lists more than once.
function ambiguousPlaces(listings: readonly EntryListing[]): Set<string> {
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  for (const l of listings) {
    if (l.place === null) continue;
    const key = `${l.source}\n${l.place}`;
    if (seen.has(key)) ambiguous.add(l.place);
    seen.add(key);
  }
  return ambiguous;
}

const pinOf = (source: PluginSourceRef | null): string | null => (source === null || typeof source === 'string' ? null : (source.sha ?? source.ref ?? null));

// -- the plugin listings -------------------------------------------------------------------------------------------

interface ListedEntry {
  name: string;
  source: PluginSourceRef | null;
  place?: string; // named directly (the engine's record of an installed directory plugin), where no source is known
  description: string | null;
  author: string | null;
  known: Known | null;
  knownBy: EntryListing['knownBy'];
  homepage: string | null;
}

// Whether a marketplace's owner published an entry: its code lives in the marketplace's own repository (a relative
// source, or the same repository named), and not in the folder of other publishers' plugins the official marketplace
// keeps (`external_plugins/`, third-party by fact 1b). The publisher chain falls back to the owner only then, so a
// community plugin never reads "by Anthropic" because Anthropic runs the community marketplace.
// Both are judged on the normalised place (repository#path, `.` and `..` applied), never on how the source is written
// (scalpel-1#4): an object source naming the marketplace's own repository at `external_plugins/…` is someone else's.
function ownerPublished(source: PluginSourceRef | null, at: MarketplacePlace): boolean {
  if (source === null) return false;
  const inside = (sub: string | null) => sub !== null && sub.split('/')[0] !== 'external_plugins';
  const place = placeOf(source, at);
  if (typeof source === 'string' && (place === null || place.startsWith('local:'))) return inside(normalisedSubpath(source));
  const own = at.locator === null || (at.kind !== 'github' && at.kind !== 'git') ? null : repositoryLocation(at.locator, null);
  return own !== null && place !== null && place.startsWith(own) && inside(place.slice(own.length));
}

// A relative path inside a repository, `.` dropped and `..` applied; null when it climbs out.
function normalisedSubpath(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') segments.push(segment);
    else if (segments.pop() === undefined) return null;
  }
  return segments.join('/');
}

function listingsOf(entries: readonly ListedEntry[], at: MarketplacePlace & { sourceKey: string; marketplaceSource: string; owner: string | null; present: boolean; seed: Seed | null; counts?: ReadonlyMap<string, number | null> }): EntryListing[] {
  const directory = at.name === DIRECTORY_MARKETPLACE;
  const ownership: Ownership = directory ? 'anthropic' : (at.seed?.ownership ?? 'added');
  const rank = routeRank(at.name, at.present, directory || at.seed !== null);
  return entries.map((e) => ({
    kind: 'entry',
    identity: '', // assigned once every source's places are known (pluginListings)
    place: e.place ?? placeOf(e.source, at),
    source: at.sourceKey,
    route: { marketplaceName: at.name, marketplaceSource: at.marketplaceSource, pluginName: e.name, ref: pinOf(e.source), present: at.present, rank, ownership },
    entryName: e.name,
    description: e.description,
    author: e.author,
    owner: ownerPublished(e.source, at) ? at.owner : null,
    known: e.known,
    knownBy: e.knownBy,
    installCount: at.counts?.get(e.name) ?? null,
    homepage: e.homepage,
  }));
}

const fromManifestRead = (manifest: MarketplaceManifestView, description: (name: string) => string | null): ListedEntry[] =>
  manifest.plugins.map((p) => ({ name: p.name, source: p.source, description: description(p.name) ?? p.description, author: p.author, known: p.components === null ? null : knownFromView(p.components, p.partial || p.problems.length > 0), knownBy: p.components === null ? null : 'host', homepage: null }));

// The seed a marketplace the engine has is, when it is the seed's own repository: a marketplace named like a seed from
// another repository is one the person added (scalpel-1#2), with no seed's ownership, rank, shelf or publisher. A seed's
// organisation publishes its own code wherever the seed is read from (Decision Log 7), never the manifest's `owner`.
function verifiedSeed(name: string, locator: string | null): Seed | null {
  const seed = seedOf(name);
  if (seed === null || locator === null) return null;
  const own = repositoryLocation(seed.repository, null);
  return own !== null && repositoryLocation(locator, null) === own ? seed : null;
}

/** Every plugin listing the engine, the test sources and the seeds offer for one cwd (the directory's records apart), with
 * the places some source lists more than once. */
export function pluginListings(network: NetworkData, engine: EngineView | null, tests: readonly TestSourceData[]): { listings: EntryListing[]; ambiguous: ReadonlySet<string> } {
  const listings: EntryListing[] = [];
  const has = new Set((engine?.marketplaces ?? []).map((m) => m.name));
  const available = engine?.available ?? [];
  const availableIn = (name: string) => available.filter((p) => p.marketplaceName === name);

  // the marketplaces the engine has: their clones read by the host, else the engine's listing of them
  for (const m of engine?.marketplaces ?? []) {
    const listed = availableIn(m.name);
    const counts = new Map(listed.map((p) => [p.name, p.installCount]));
    const description = (name: string) => listed.find((p) => p.name === name)?.description ?? null;
    const manifest = engine?.manifests.get(m.name);
    const entries: ListedEntry[] =
      manifest?.state === 'read'
        ? fromManifestRead(manifest, description)
        : [
            ...listed.map((p) => ({ name: p.name, source: p.source, description: p.description, author: null, known: null, knownBy: null, homepage: null })),
            // installed plugins leave the available listing (fact 2a); without the clone's read their source is unknown
            ...(engine?.installed ?? []).filter((row) => row.marketplace === m.name && !listed.some((p) => p.name === row.name)).map((row) => ({ name: row.name, source: null, description: null, author: null, known: null, knownBy: null, homepage: null })),
          ].filter((e, i, all) => all.findIndex((o) => o.name === e.name) === i);
    const seed = verifiedSeed(m.name, m.locator);
    listings.push(...listingsOf(entries, { name: m.name, kind: m.source, locator: m.locator, sourceKey: `engine:${m.name}`, marketplaceSource: m.locator ?? m.name, owner: seed?.publisher ?? manifest?.owner ?? null, present: true, seed, counts }));
  }

  // the engine's Anthropic Directory: its entry names are the engine's own (not computable from a record, fact 2), and an
  // installed one leaves the listing; it is known by the repository the engine recorded for it at install, and otherwise
  // left to My items (no card of its own: it would stand beside its directory record's; never joined by name)
  const directoryEntries = new Map<string, ListedEntry>();
  for (const p of availableIn(DIRECTORY_MARKETPLACE)) directoryEntries.set(p.name, { name: p.name, source: p.source, description: p.description, author: null, known: null, knownBy: null, homepage: null });
  for (const row of engine?.installed ?? []) {
    const place = engine?.directoryInstalled.get(row.name);
    if (row.marketplace === DIRECTORY_MARKETPLACE && !directoryEntries.has(row.name) && place !== undefined) directoryEntries.set(row.name, { name: row.name, source: null, place, description: null, author: null, known: null, knownBy: null, homepage: null });
  }
  const directoryCounts = new Map(availableIn(DIRECTORY_MARKETPLACE).map((p) => [p.name, p.installCount]));
  listings.push(...listingsOf([...directoryEntries.values()], { name: DIRECTORY_MARKETPLACE, kind: 'directory-marketplace', locator: null, sourceKey: `engine:${DIRECTORY_MARKETPLACE}`, marketplaceSource: DIRECTORY_MARKETPLACE, owner: null, present: true, seed: null, counts: directoryCounts }));

  // the test sources (fixture-only): read from disk, discoverable before the engine has them
  for (const { source, manifest } of tests) {
    if (has.has(source.marketplaceName) || manifest.state !== 'read') continue;
    listings.push(...listingsOf(fromManifestRead(manifest, () => null), { name: source.marketplaceName, kind: 'directory', locator: source.marketplaceSource, sourceKey: source.key, marketplaceSource: source.marketplaceSource, owner: manifest.owner, present: false, seed: null }));
  }

  // the seeds the engine does not have, from their fetched manifests (and one it has but could not list: the clone is
  // still what installs, so the route stays present)
  for (const seed of SEEDS) {
    const manifest = network.seeds.get(seed.key);
    const held = (engine?.marketplaces ?? []).some((m) => m.name === seed.marketplaceName && verifiedSeed(m.name, m.locator) !== null);
    if (!manifest || (held && listings.some((l) => l.source === `engine:${seed.marketplaceName}`))) continue;
    const entries = manifest.entries.records.map((e): ListedEntry => {
      const known = knownFromEntry(e);
      return { name: e.name, source: e.source, description: e.description, author: e.author, known, knownBy: known === null ? null : 'entry', homepage: e.homepage };
    });
    listings.push(...listingsOf(entries, { name: seed.marketplaceName, kind: 'github', locator: seed.repository, sourceKey: seed.key, marketplaceSource: seed.repository, owner: seed.publisher, present: held, seed }));
  }
  const ambiguous = ambiguousPlaces(listings);
  for (const l of listings) l.identity = identityOf(l.place, l.entryName, l.route.marketplaceName, ambiguous);
  return { listings, ambiguous };
}

// -- connectors ----------------------------------------------------------------------------------------------------

const ENGINE_NAME = /^[A-Za-z0-9_-]+$/; // `claude mcp add`'s name rule (fact 2)
const VALUED_OPTIONS = new Set(['--transport', '-t', '--scope', '-s', '--header', '-H', '--env', '-e', '--client-id', '--callback-port']);

// The name the sheet proposes: the directory's own command's, else its slug, else the display name lower-cased with runs
// of other characters made one hyphen (never the tool-prefix normaliser, which would say `Google_Drive`).
export function connectorName(server: Pick<DirectoryServer, 'copyText' | 'slug' | 'name'>): string {
  const words = server.copyText?.trim().split(/\s+/) ?? [];
  let fromCopy: string | null = null;
  if (words[0] === 'claude' && words[1] === 'mcp' && words[2] === 'add')
    for (let i = 3; i < words.length; i += 1) {
      if (words[i]!.startsWith('-')) {
        if (VALUED_OPTIONS.has(words[i]!)) i += 1;
        continue;
      }
      fromCopy = words[i]!;
      break;
    }
  for (const candidate of [fromCopy, server.slug]) if (candidate && ENGINE_NAME.test(candidate)) return candidate;
  return (
    server.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'server'
  );
}

/** A directory server as Connectors' route, or null when it is not a remote server Claude Code can add (Design, Discover
 * per tab): one with a URL, a URL pattern the person's instance URL must match, or a fixed choice of URLs (`url_options`,
 * regional endpoints: Desktop's "one of", the second live walk's 31 servers). */
export function connectorRoute(server: DirectoryServer): ConnectorRoute | null {
  const remote = server.remote;
  if (server.type !== 'remote' || !server.worksWithClaudeCode || remote === null) return null;
  const transport = remote.transport === 'streamable-http' ? 'http' : remote.transport === 'sse' ? 'sse' : null;
  if (transport === null || (remote.url === null && remote.urlPattern === null && remote.urlOptions.length === 0)) return null;
  return { kind: 'connector', name: connectorName(server), url: remote.url, urlPattern: remote.urlPattern, urlOptions: remote.urlOptions, transport, authPosture: remote.authPosture };
}
