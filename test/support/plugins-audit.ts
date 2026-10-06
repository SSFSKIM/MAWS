// The E8 live run's G4 audit (E8 execution document, M3 "The live run"; parent G4; D-12): the config home's and the
// project's `.claude/` file trees read around each CLI action, their delta, and the verdict on every changed path.
// - A mutation may write its `writesOf` manifest (the confirm sheet's "Writes" list); a listing writes no configuration.
// - Any action may refresh the engine's catalogue caches and its `.claude.json` bookkeeping (D-12): `.claude.json` is
//   read structured and judged by top-level key, so `pluginUsage` or a migration flag passes and `projects`,
//   `mcpServers` or any other configuration key fails.
// - The running session's own files are recognised by name; a path nobody recognises is `unclassified`, reported as a
//   failure to classify, never exempted.
// - A file's fingerprint is its size, mtime and content hash, so a same-content rewrite shows.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { writesOf, type PluginsAction, type PluginsScope } from '../../src/shared/plugins/cli';

// path (prefixed `config/` or `project/.claude/`) → a fingerprint; a clone or a cached plugin version (thousands of
// files) is one entry over its files' names, sizes and mtimes.
export type Files = Record<string, string>;
export interface Tree {
  files: Files;
  claudeJson: Record<string, unknown> | null; // `<config home>/.claude.json`, parsed
}

// Directories the delta treats as one entry: a marketplace's clone and one cached plugin version.
const LEAF_DIRS = [/^plugins\/marketplaces\/[^/]+$/, /^plugins\/cache\/[^/]+\/[^/]+\/[^/]+$/];

function filesOf(dir: string, prefix: string): Files {
  const out: Files = {};
  if (!existsSync(dir)) return out;
  const walk = (path: string) => {
    const rel = relative(dir, path);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (LEAF_DIRS.some((re) => re.test(rel))) {
        const hash = createHash('sha1');
        let files = 0;
        const inner = (p: string) => {
          for (const entry of readdirSync(p, { withFileTypes: true })) {
            const full = join(p, entry.name);
            if (entry.isDirectory()) inner(full);
            else {
              const s = statSync(full);
              files += 1;
              hash.update(`${relative(path, full)}\0${s.size}\0${s.mtimeMs}\n`);
            }
          }
        };
        inner(path);
        out[`${prefix}/${rel}/`] = `dir ${files} files ${hash.digest('hex').slice(0, 12)}`;
        return;
      }
      const entries = readdirSync(path);
      if (entries.length === 0 && rel !== '') out[`${prefix}/${rel}/`] = 'empty dir';
      for (const entry of entries) walk(join(path, entry));
      return;
    }
    out[`${prefix}/${rel}`] = `${stat.size} bytes · mtime ${stat.mtimeMs} · ${createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 12)}`;
  };
  walk(dir);
  return out;
}

export function readTree(config: string, project: string): Tree {
  const file = join(config, '.claude.json');
  let claudeJson: Record<string, unknown> | null = null;
  if (existsSync(file)) {
    try {
      claudeJson = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      claudeJson = null; // mid-write: the delta still shows the file
    }
  }
  return { files: { ...filesOf(config, 'config'), ...filesOf(join(project, '.claude'), 'project/.claude') }, claudeJson };
}

export interface Delta {
  added: string[];
  removed: string[];
  changed: string[];
}

// An empty directory is listed as itself; once something lands in it (or leaves it empty) only its contents are a change.
export function deltaOf(before: Files, after: Files): Delta {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const filled = (dir: string, tree: Files) => Object.keys(tree).some((k) => k !== dir && k.startsWith(dir));
  return {
    added: keys.filter((k) => !(k in before) && !(after[k] === 'empty dir' && filled(k, before))),
    removed: keys.filter((k) => !(k in after) && !(before[k] === 'empty dir' && filled(k, after))),
    changed: keys.filter((k) => k in before && k in after && before[k] !== after[k]),
  };
}

export interface Manifest {
  paths: string[];
  covers(path: string): boolean;
}

// The manifest of one action as patterns over the tree's paths: the scope's settings file and `writesOf`'s others under
// `config/plugins/`, the segments the action names filled in, any other `<…>` one segment; a trailing `/` covers the
// directory and everything under it.
export function manifestOf(action: PluginsAction, scope: PluginsScope, source: string | null, fill: Record<string, string>): Manifest {
  const writes = writesOf(action, scope, source);
  const filled = (path: string) => path.replace(/<([a-z]+)>/g, (whole, name: string) => fill[name] ?? whole);
  const paths = [scope === 'user' ? `config/${writes.settings}` : `project/${writes.settings}`, ...writes.others.map((other) => `config/plugins/${filled(other)}`)];
  const patterns = paths.map((path) => {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[a-z]+>/g, '[^/]+');
    return new RegExp(path.endsWith('/') ? `^${escaped}` : `^${escaped}$`);
  });
  return { paths, covers: (path) => patterns.some((re) => re.test(path)) };
}

export type Verdict = 'manifest' | 'records (D-12)' | 'catalogue cache (D-12)' | 'session files' | 'unannounced' | 'unclassified';

// The engine's own bookkeeping in `.claude.json` (D-12): plugin usage counters, the first-start identifiers, migration
// flags, notices seen and the cached feature flags. Every other key is configuration.
const BOOKKEEPING_KEYS = new Set(['pluginUsage', 'firstStartTime', 'firstStartVersion', 'machineID', 'userID', 'migrationVersion', 'seenNotifications', 'cachedGrowthBookFeatures']);
const BOOKKEEPING_PATTERNS = [/MigrationComplete$/, /^hasReset[A-Z]/];
const isBookkeeping = (key: string) => BOOKKEEPING_KEYS.has(key) || BOOKKEEPING_PATTERNS.some((re) => re.test(key));

export function claudeJsonChanges(before: Record<string, unknown> | null, after: Record<string, unknown> | null): { key: string; kind: 'records (D-12)' | 'unannounced' }[] {
  const b = before ?? {};
  const a = after ?? {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .sort()
    .filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]))
    .map((key) => ({ key, kind: isBookkeeping(key) ? 'records (D-12)' : 'unannounced' }));
}

// The running session's own files and the engine's caches outside `plugins/`, by name.
const SESSION_FILES = [/^config\/projects\//, /^config\/sessions\//, /^config\/history\.jsonl$/, /^config\/\.last-cleanup$/, /^config\/todos\//, /^config\/statsig\//, /^config\/debug\//, /^config\/shell-snapshots\//, /^config\/cache\//, /^config\/file-history\//, /^config\/session-env\//];
const CATALOGUE_CACHES = /^config\/plugins\/(plugin-catalog-cache\.json|plugin-directory-cache-v2\.json)$/;

// What a changed path is when no manifest covers it (`.claude.json` is judged by its keys, `claudeJsonChanges`).
export function pathKind(path: string): Exclude<Verdict, 'manifest'> {
  if (/^config\/backups\/\.claude\.json\.backup\.\d+$/.test(path)) return 'records (D-12)';
  if (CATALOGUE_CACHES.test(path)) return 'catalogue cache (D-12)';
  if (SESSION_FILES.some((re) => re.test(path))) return 'session files';
  if (path === 'config/settings.json' || path.startsWith('config/plugins/') || path.startsWith('project/')) return 'unannounced';
  return 'unclassified';
}

export interface Audit {
  lines: string[]; // one per changed path (and per changed `.claude.json` key), with its verdict
  unannounced: string[]; // configuration writes outside the manifest (any, for a listing)
  unclassified: string[]; // paths nobody recognises
}

// The verdict on one action's delta; `manifest` null for a listing, which may write no configuration.
export function auditOf(before: Tree, after: Tree, manifest: Manifest | null): Audit {
  const delta = deltaOf(before.files, after.files);
  const out: Audit = { lines: [], unannounced: [], unclassified: [] };
  for (const [kind, paths] of [['added', delta.added], ['removed', delta.removed], ['changed', delta.changed]] as const) {
    for (const path of paths) {
      const label = `${kind} ${path}`;
      if (path === 'config/.claude.json') {
        const keys = claudeJsonChanges(before.claudeJson, after.claudeJson);
        if (keys.length === 0) out.lines.push(`  ${kind.padEnd(7)} ${path}   [records (D-12): rewritten, no key changed]`);
        for (const { key, kind: verdict } of keys) {
          out.lines.push(`  ${kind.padEnd(7)} ${path} · ${key}   [${verdict}]`);
          if (verdict === 'unannounced') out.unannounced.push(`${label} · ${key}`);
        }
        continue;
      }
      const verdict: Verdict = manifest?.covers(path) ? 'manifest' : pathKind(path);
      out.lines.push(`  ${kind.padEnd(7)} ${path}   [${verdict}]`);
      if (verdict === 'unannounced') out.unannounced.push(label);
      if (verdict === 'unclassified') out.unclassified.push(label);
    }
  }
  return out;
}
