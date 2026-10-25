// P4-AGG M2: `plugins.directoryProvenance` (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, the task
// review's second finding): where the engine recorded the code of an installed Anthropic Directory plugin. The engine's
// available listing omits installed plugins (fact 2a) and `plugin list --json` names no repository, so after a restart
// the catalog would read an installed directory plugin as not installed. The engine keeps two records in its plugins
// folder (2.1.309), both read here and never written:
// - `plugin-directory-bindings.json` (cli.pretty.js 60890): `{schemaVersion: 1, bindings: {"<name>@anthropic-plugin-
//   directory": {repositoryKey}}}`, written at install to tie the name to the repository it came from: answered first;
// - `plugin-directory-cache-v2.json` (779832 `Xe`, 779884 `K`): the saved directory walk, `entryNames` (listing id to
//   the engine's entry name), `entryNameClaims` (id to `{repositoryKey}`) and the listings themselves (`listings`,
//   `missedListings[].listing`, each with `source.repository {url, path?}`): the claim's key, else the listing's.
// A repository key is the engine's fold key, `host/path#subpath`, the spelling `repositoryLocation` produces. A file that
// is absent, a link, not a file, over the engine's own cap, damaged or of another version answers nothing.
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod';
import { repositoryLocation } from '@shared/plugins/source-key';

const DIRECTORY = 'anthropic-plugin-directory';
const BINDINGS = { file: 'plugin-directory-bindings.json', cap: 1_048_576 };
const CACHE = { file: 'plugin-directory-cache-v2.json', cap: 16_777_216 };

const loose = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const BindingsSchema = z.looseObject({ schemaVersion: z.literal(1), bindings: z.record(z.string(), loose(z.looseObject({ repositoryKey: z.string().min(1) }))) });
const ListingSchema = z.looseObject({ id: z.string(), source: z.looseObject({ repository: z.looseObject({ url: z.string(), path: loose(z.string()) }) }) });
const CacheSchema = z.looseObject({
  schemaVersion: z.literal(2),
  listings: loose(z.array(z.unknown())),
  missedListings: loose(z.array(z.looseObject({ listing: z.unknown() }).catch({ listing: null }))),
  entryNames: loose(z.record(z.string(), z.unknown())),
  entryNameClaims: loose(z.record(z.string(), loose(z.looseObject({ repositoryKey: loose(z.string()) })))),
});

async function readJson(path: string, cap: number): Promise<unknown> {
  try {
    const facts = await lstat(path);
    if (!facts.isFile() || facts.size > cap) return undefined; // a link answers isFile() false under lstat
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export interface DirectoryProvenance {
  name: string;
  repositoryKey: string;
}

/** The repository key the engine recorded for each of `names` (installed Anthropic Directory entry names) it has one for. */
export async function directoryProvenance(pluginsDir: string, names: readonly string[]): Promise<DirectoryProvenance[]> {
  const wanted = new Set(names);
  const found = new Map<string, string>();
  const [bindingsJson, cacheJson] = await Promise.all([readJson(join(pluginsDir, BINDINGS.file), BINDINGS.cap), readJson(join(pluginsDir, CACHE.file), CACHE.cap)]);

  const bindings = BindingsSchema.safeParse(bindingsJson);
  if (bindings.success)
    for (const [id, binding] of Object.entries(bindings.data.bindings)) {
      const name = id.endsWith(`@${DIRECTORY}`) ? id.slice(0, -DIRECTORY.length - 1) : null;
      if (name !== null && binding !== undefined && wanted.has(name)) found.set(name, binding.repositoryKey);
    }

  const cache = CacheSchema.safeParse(cacheJson);
  if (cache.success) {
    const listings = new Map<string, z.infer<typeof ListingSchema>>();
    for (const raw of [...(cache.data.listings ?? []), ...(cache.data.missedListings ?? []).map((m) => m.listing)]) {
      const listing = ListingSchema.safeParse(raw);
      if (listing.success && !listings.has(listing.data.id)) listings.set(listing.data.id, listing.data);
    }
    for (const [id, name] of Object.entries(cache.data.entryNames ?? {})) {
      if (typeof name !== 'string' || !wanted.has(name) || found.has(name)) continue;
      const repository = listings.get(id)?.source.repository;
      const key = cache.data.entryNameClaims?.[id]?.repositoryKey ?? (repository ? repositoryLocation(repository.url, repository.path ?? null) : null);
      if (key) found.set(name, key);
    }
  }
  return names.flatMap((name) => (found.has(name) ? [{ name, repositoryKey: found.get(name)! }] : []));
}
