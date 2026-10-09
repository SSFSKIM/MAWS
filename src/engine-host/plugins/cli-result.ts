// The engine's plugin CLI answers, read (E8 execution document, M1 decisions; G0's probe on 2.1.290 and SPEC 30 §25.3a):
// a mutation prints one `--json` result line `{command, outcome, message, failureCode?, …}` as the last line that parses
// as JSON with `command` and `outcome` (progress may precede it); the three listings print one pretty-printed document,
// which is parsed whole and reduced to the fields the widget shows (the raw `--available` answer is about 1.5 MB).
import { promises as fs } from 'node:fs';
import { sep } from 'node:path';
import * as z from 'zod';
import type { AvailablePlugin, InstalledPlugin, PluginSourceRef, PluginsOutcome } from '@shared/ipc/schema/plugins';
import type { Marketplace } from '@shared/ipc/schema/marketplaces';

export interface CliRun {
  stdout: string;
  stderr: string;
  code: number | null; // null when a signal ended it
}

// The failure codes whose result carries the marketplace-declared command for a person to see (SPEC 30 §25.3a, `lHe`).
const SHOWN_COMMAND_CODES = new Set(['command_source_refused', 'command_source_declined', 'entry_helper_unconfirmed', 'entry_helper_declined']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const lines = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

// One stdout line as the mutation's result, or null when it is not one.
export function resultOf(line: string): Record<string, unknown> | null {
  if (!line.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) && typeof value.command === 'string' && typeof value.outcome === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function mutationOutcome(run: CliRun): PluginsOutcome {
  const result = lines(run.stdout).map(resultOf).filter((r) => r !== null).at(-1);
  if (result === undefined) {
    const said = lines(run.stderr).at(-1);
    const message = said ?? (run.code === null ? 'the CLI ended without a result' : `the CLI exited ${run.code} without a result`);
    return { ok: false, error: { code: 'no_result', message, failureCode: null, shownCommand: null } };
  }
  if (result.outcome === 'ok') return { ok: true, result };
  const failureCode = str(result.failureCode);
  const shownCommand = failureCode !== null && SHOWN_COMMAND_CODES.has(failureCode) && isRecord(result.shownCommand) ? result.shownCommand : null;
  return { ok: false, error: { code: 'cli_failed', message: str(result.message) ?? `${String(result.command)} failed`, failureCode, shownCommand } };
}

// -- the reads -----------------------------------------------------------------------------------------------------------

// A listing's document, read by `parse`; a CLI that exited non-zero answers its own last words.
export function listing<T>(run: CliRun, parse: (stdout: string) => T): T {
  if (run.code !== 0) throw new Error(lines(run.stderr).at(-1) ?? (run.code === null ? 'the CLI ended without a listing' : `the CLI exited ${run.code} without a listing`));
  return parse(run.stdout);
}

function documentOf<S extends z.ZodType>(stdout: string, schema: S, what: string): z.infer<S> {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error(`${what} printed no JSON`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${what} answered an unexpected shape (${parsed.error.issues.map((i) => i.path.join('.') || '<root>').join(', ')})`);
  return parsed.data;
}

// SPEC 30's PluginListRow, as far as the widget and the manifest reader read it (P2-B §5.3 adds the times,
// `projectEnabled` and the folder a directory marketplace's plugin loads from). The row's `mcpServers` carries header and
// environment values verbatim (U3 F1) and is never read.
const ListRowSchema = z.looseObject({
  id: z.string(),
  version: z.string().optional(),
  scope: z.string(),
  enabled: z.boolean(),
  installPath: z.string().optional(),
  projectPath: z.string().optional(),
  errors: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
  // P2-B start (2026-10-09)
  readFromFolder: z.string().optional().catch(undefined),
  folderVersion: z.string().optional().catch(undefined),
  installedAt: z.string().optional().catch(undefined),
  lastUpdated: z.string().optional().catch(undefined),
  projectEnabled: z.boolean().optional().catch(undefined),
  // P2-B end
});

// One `plugin list --json` row as the host keeps it: the fields above, nothing else of the row.
export interface PluginListRow {
  id: string;
  version: string | null;
  scope: string;
  enabled: boolean;
  installPath: string;
  projectPath: string | null;
  errors: string[];
  notes: string[];
  readFromFolder: string | null; // the folder the engine loads a directory marketplace's plugin from, in place
  folderVersion: string | null;
  installedAt: string | null;
  lastUpdated: string | null;
  projectEnabled: boolean;
}

export function pluginRowsOf(stdout: string): PluginListRow[] {
  return documentOf(stdout, z.array(ListRowSchema), 'plugin list --json').map((row) => ({
    id: row.id,
    version: row.version ?? null,
    scope: row.scope,
    enabled: row.enabled,
    installPath: row.installPath ?? '',
    projectPath: row.projectPath ?? null,
    errors: row.errors ?? [],
    notes: row.notes ?? [],
    readFromFolder: row.readFromFolder ?? null,
    folderVersion: row.folderVersion ?? null,
    installedAt: row.installedAt ?? null,
    lastUpdated: row.lastUpdated ?? null,
    projectEnabled: row.projectEnabled ?? false,
  }));
}

// Whether a realpath lies under a root: equal to it, or inside it at a segment boundary (`/repo2` is not under `/repo`;
// the rule of `src/main/files/allowlist.ts`).
export function under(root: string, real: string): boolean {
  return real === root || real.startsWith(root.endsWith(sep) ? root : root + sep);
}

type Realpath = (path: string) => Promise<string>;

// The rows reduced to the widget's fields, each placed against the session directory (P2-B §5.1): `here` when its
// project is that directory, `coversHere` when it is that directory or an ancestor of it, both through realpaths (the
// CLI prints the project's realpath, while the session's directory may be spelled through a link: `/tmp` is
// `/private/tmp`). A project, or a cwd, that does not resolve places nothing. A folder-loaded plugin's version is its
// folder's (2.1.292 `cli.pretty.js:207456`), the copy that loads.
export async function installedOf(rows: readonly PluginListRow[], cwd: string, realpath: Realpath = (path) => fs.realpath(path)): Promise<InstalledPlugin[]> {
  const resolve = (path: string) => realpath(path).catch(() => null);
  const projects = [...new Set(rows.flatMap((row) => (row.projectPath === null ? [] : [row.projectPath])))];
  const [here, ...reals] = await Promise.all([resolve(cwd), ...projects.map(resolve)]);
  const realOf = new Map(projects.map((project, i) => [project, reals[i]]));
  return rows.map((row) => {
    const at = row.id.lastIndexOf('@');
    const project = row.projectPath === null ? null : (realOf.get(row.projectPath) ?? null);
    const placed = here !== null && project !== null;
    return {
      id: row.id,
      name: at > 0 ? row.id.slice(0, at) : row.id,
      marketplace: at > 0 ? row.id.slice(at + 1) : '',
      version: row.readFromFolder !== null && row.folderVersion !== null ? row.folderVersion : row.version,
      scope: row.scope,
      enabled: row.enabled,
      projectPath: row.projectPath,
      installPath: row.installPath,
      errors: row.errors,
      notes: row.notes,
      installedAt: row.installedAt,
      lastUpdated: row.lastUpdated,
      projectEnabled: row.projectEnabled,
      here: placed && here === project,
      coversHere: placed && under(project, here),
    };
  });
}

// An entry's source as the marketplace declares it, reduced (P2-B §5.3): the relative path an in-repository entry has,
// or the object's kind (`source`) and locators; anything else is none.
function sourceRefOf(source: unknown): PluginSourceRef | null {
  if (typeof source === 'string') return source;
  if (!isRecord(source)) return null;
  return { kind: str(source.source) ?? 'unknown', url: str(source.url), repo: str(source.repo), path: str(source.path) };
}

const AvailableSchema = z.looseObject({
  available: z.array(z.looseObject({ pluginId: z.string(), name: z.string(), marketplaceName: z.string(), description: z.string().nullish(), version: z.string().nullish(), source: z.unknown().optional(), installCount: z.unknown().optional() })),
});

export function availableOf(stdout: string): AvailablePlugin[] {
  return documentOf(stdout, AvailableSchema, 'plugin list --json --available').available.map((p) => ({
    pluginId: p.pluginId,
    name: p.name,
    marketplaceName: p.marketplaceName,
    description: p.description ?? null,
    version: p.version ?? null,
    source: sourceRefOf(p.source),
    installCount: Number.isSafeInteger(p.installCount) && (p.installCount as number) >= 0 ? (p.installCount as number) : null, // only the CLI's own number
  }));
}

// `{ name, source, repo?|url?|path?, ref?, installLocation }`, or a claude.ai entry with no locator (SPEC 30).
const MarketplaceRowSchema = z.looseObject({ name: z.string(), source: z.string(), repo: z.string().optional(), url: z.string().optional(), path: z.string().optional(), installLocation: z.string().optional() });

export function marketplacesOf(stdout: string): Marketplace[] {
  return documentOf(stdout, z.array(MarketplaceRowSchema), 'plugin marketplace list --json').map((m) => ({
    name: m.name,
    source: m.source,
    locator: m.repo ?? m.url ?? m.path ?? null,
    installLocation: m.installLocation ?? null,
  }));
}
