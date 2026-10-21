// vitest's module cache (--fsModuleCache) keys a module's transform by the module's own path and content and by its
// project's config, never by what its imports resolved to, though the transform names each import by its resolved path
// (`./x` becomes `/src/x.ts`). Within one run the tree holds still, so that is exact; a cache carried to another commit
// (gate.yml's unit job restores the one master wrote, .github/actions/module-cache) goes stale wherever a file appeared or
// vanished: an importer left as it was, of a module renamed x.ts to x.tsx, reads the old path and fails ("Cannot find
// module '/src/x.ts'"), and a file that now wins the resolution (x.mjs beside x.ts) is never loaded. moduleCacheKey adds
// to each module's key the names that decide each relative or aliased path it names: in that path's directory, the names
// sharing its stem; in a directory it names, the index files and package.json. A file added or removed there
// re-transforms the importer, and every other entry still reads. A module whose transform vite expands into a glob is
// never cached: import.meta.glob in any form, and a template literal holding `${…}` in a dynamic import or in new
// URL(…, import.meta.url) (happy-dom projects). vitest bails out on the exact text `import.meta.glob(` alone, so
// `import.meta.glob<string>(` would keep the files its glob matched where the cache was written, and a file added under
// the globbed directory since would never be seen. Bare package imports need nothing here: vitest drops the whole cache
// when the lockfile changes, and the delivered cache's key holds every package.json.
import { readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { Plugin } from 'vitest/config';

type Alias = { find: string | RegExp; replacement: string };
// A directory's sorted names, or null where there is none; read once a run, while the tree holds still.
type Listings = Map<string, readonly string[] | null>;

const listed = (listings: Listings, dir: string) => {
  let names = listings.get(dir);
  if (names === undefined) {
    try {
      names = readdirSync(dir).sort();
    } catch {
      names = null;
    }
    listings.set(dir, names);
  }
  return names;
};
const shown = (names: readonly string[] | null | undefined) => (names ? names.join('/') : '-');

// What decides where `path` (absolute, without its query) resolves.
const deciders = (listings: Listings, path: string) => {
  const base = basename(path);
  const stem = base.split('.')[0] || base;
  const siblings = listed(listings, dirname(path))?.filter((name) => name === base || name === stem || name.startsWith(`${stem}.`));
  const inside = listed(listings, path)?.filter((name) => name.startsWith('index.') || name === 'package.json');
  return `${path}:${shown(siblings)}:${shown(inside)}`;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = new WeakMap<readonly Alias[], RegExp>();
// Whole quoted paths that start `./`, `../` or a string alias's name; a `$` is part of one unless it opens a template's
// `${`, which names no single file.
const pathsIn = (aliases: readonly Alias[]) => {
  let pattern = patterns.get(aliases);
  if (!pattern) {
    const heads = ['\\.{1,2}', ...aliases.flatMap(({ find }) => (typeof find === 'string' ? [escape(find)] : []))];
    pattern = new RegExp(`(['"\`])((?:${heads.join('|')})(?:/(?:[^'"\`$\\n]|\\$(?!\\{))*)?)\\1`, 'g');
    patterns.set(aliases, pattern);
  }
  return pattern;
};

// Where vite's transform expands a glob: import.meta.glob( or import.meta.glob<…>(, and a template literal holding `${`
// in import( or new URL(.
const globbed = /import\.meta\.glob\s*[(<]|\b(?:import|new\s+URL)\s*\(\s*`[^`]*\$\{/;

// The key's addition for one module (`id`, its `source`): the deciders of every path the source names, in a stable
// order, or false (do not cache it) where its transform expands a glob.
export function resolutionKey(id: string, source: string, aliases: readonly Alias[], listings: Listings = new Map()): string | false {
  if (globbed.test(source)) return false;
  const from = dirname(id.replace(/[?#].*$/, ''));
  const keys = new Set<string>();
  for (const [, , named] of source.matchAll(pathsIn(aliases))) {
    const path = named.replace(/[?#].*$/, '');
    const alias = aliases.find(({ find }) => typeof find === 'string' && (path === find || path.startsWith(`${find}/`)));
    keys.add(deciders(listings, alias ? resolve(`${alias.replacement}${path.slice((alias.find as string).length)}`) : resolve(from, path)));
  }
  return [...keys].sort().join('\n');
}

const registered = new WeakSet<object>();
// One generator a run: vitest applies it to every module of every project, so each project carries the plugin (a run
// narrowed to some projects still has it) and the first to be configured registers it.
export function moduleCacheKey(): Plugin {
  return {
    name: 'maws:module-cache-key',
    configureVitest({ vitest, defineCacheKeyGenerator }) {
      if (registered.has(vitest)) return;
      registered.add(vitest);
      const listings: Listings = new Map();
      defineCacheKeyGenerator(({ environment, id, sourceCode }) =>
        isAbsolute(id) && !id.includes('/node_modules/') ? resolutionKey(id, sourceCode, environment.config.resolve.alias as Alias[], listings) : undefined,
      );
    },
  };
}
