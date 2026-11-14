// The engine's plugin CLI answers, read (E8 execution document, M1 decisions; G0's probe on 2.1.290 and SPEC 30 §25.3a):
// a mutation prints one `--json` result line `{command, outcome, message, failureCode?, …}` as the last line that parses
// as JSON with `command` and `outcome` (progress may precede it); the three listings print one pretty-printed document,
// which is parsed whole and reduced to the fields the widget shows (the raw `--available` answer is about 1.5 MB).
import { promises as fs } from 'node:fs';
import { sep } from 'node:path';
import * as z from 'zod';
import type { AvailablePlugin, InstalledPlugin, PluginSourceRef, PluginsOutcome } from '@shared/ipc/schema/plugins';
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import { holdsValueSlot, isMcpEntryAdd, MCP_MASK, mcpShownCommand, mcpValueSlotsOf, type McpAction, type McpActionInputs, type McpEntryAdd } from '@shared/plugins/cli';

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

// P4-AGG M4: `claude mcp add|remove` print a sentence, not JSON (2.1.309): on success the result on stdout's first line
// ("Added HTTP MCP server linear with URL: … to user config", then "File modified: …"), on a refusal the reason on stderr
// with exit 1 ("MCP server linear already exists in user config", "No MCP server named "x" in user scope", "Invalid
// name …"). The result carries the CLI's line as its `message`, as a plugin verb's does.
// UX wave U11g: a custom add's input is read by its own branch (`customAddOutcome`, below).
export function mcpOutcome<A extends McpAction>(action: A, input: McpActionInputs[A], run: CliRun): PluginsOutcome {
  if (action === 'mcp-add' && isMcpEntryAdd(input as McpActionInputs['mcp-add'])) return customAddOutcome(input as McpEntryAdd, run);
  const command = action === 'mcp-add' ? 'mcp add' : 'mcp remove';
  if (run.code === 0) return { ok: true, result: { command, outcome: 'ok', message: lines(run.stdout)[0] ?? `${command} ${input.name}`, name: input.name, scope: input.scope } };
  const said = lines(run.stderr).at(-1) ?? lines(run.stdout).at(-1);
  if (said === undefined) return noResult(run);
  return failed('cli_failed', said);
}

type Failed = Extract<PluginsOutcome, { ok: false }>;
const failed = (code: Failed['error']['code'], message: string, failureCode: string | null = null): Failed => ({ ok: false, error: { code, message, failureCode, shownCommand: null } });
const noResult = (run: CliRun): Failed => failed('no_result', run.code === null ? 'the CLI ended without a result' : `the CLI exited ${run.code} without a result`);

// UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §B and §C): a custom add's words, in
// one table. The enum of an outcome's code cannot grow (a wire major), so its new cases are told apart by `failureCode`.
export const CUSTOM_ADD_WORDS = {
  added: (type: string, name: string, scope: string) => `Added ${type} MCP server ${name} to ${scope} config`, // the engine's own line (Engine facts, 1)
  configured: (name: string, scope: string) => `${name} is already configured here (${scope} scope). Nothing was added.`,
  heldByApp: (name: string) => `${name} is held by MAWS’s own list (Settings › Sessions › MCP servers). Nothing was added.`,
  unread: 'Not every configuration here could be read, so the name can’t be checked. Nothing was added.',
  withheld: (code: number | null, command: string) => `Claude Code exited ${code === null ? 'on a signal' : code}. Its message repeats a header or variable value, so it is not shown. To read it, run this in a terminal with your values in place of ${MCP_MASK}: ${command}`,
  spawnWithheld: 'The command could not be started. The system’s message repeats a header or variable value, so it is not shown.',
  readback: (code: number | null) => `Claude Code exited ${code === null ? 'on a signal' : code}. It could not read its configuration file back after writing it, and its message may quote that file, so it is not shown. The connector may have been added: check the list before adding it again.`, // R10
} as const;

// R10: the fixed phrase of the engine's read-back error, read from engine 2.1.322 (`cli.pretty.js:475658`, thrown at
// `:476792`): "MCP server "<name>" may not have been saved…: <file> could not be read to confirm the change (<reason>)…".
// Its `<reason>` is free text from the failed read and can quote any fragment of the file, so a line holding the phrase
// is withheld whole whatever else it holds.
export const ENGINE_READBACK_PHRASE = 'could not be read to confirm the change';

/** Why a custom add's CLI line is withheld whole, or null when it may be forwarded: tested on the line as the CLI wrote
 * it, before any trimming (what is forwarded is the trimmed line). The read-back error first, since its sentence says
 * the connector may have been added; then a value slot's content, as written or as JSON escapes it. The one drop of the
 * `output` path and the outcome's path alike. */
export function withheldLine(raw: string, slots: readonly string[]): 'readback' | 'value' | null {
  if (raw.includes(ENGINE_READBACK_PHRASE)) return 'readback';
  return holdsValueSlot(raw, slots) ? 'value' : null;
}

/** The check before the run could not be made, or its read of the configuration was not whole: nothing was added. */
export const CONFIGURATION_UNREAD: Failed = failed('spawn_failed', CUSTOM_ADD_WORDS.unread, 'configuration_unread');
/** A spawn's failure whose system message repeats a value slot's content. */
export const SPAWN_WITHHELD: Failed = failed('spawn_failed', CUSTOM_ADD_WORDS.spawnWithheld, 'message_withheld');

/** The engine host's name check before a custom add's run (R3), from the inventory of the page's folder: the name's first
 * entry, as the sheet's `existingOf` finds it (MAWS's own list included, scope `app`), refuses with its scope; a read that
 * was not whole refuses too; a free name answers null. Built from public fields alone. */
export function nameCheckOutcome(configured: { servers: readonly { name: string; scope: string }[]; serversRead: boolean }, name: string): Failed | null {
  const found = configured.servers.find((server) => server.name === name);
  if (found) return failed('spawn_failed', found.scope === 'app' ? CUSTOM_ADD_WORDS.heldByApp(name) : CUSTOM_ADD_WORDS.configured(name, found.scope), 'name_configured');
  return configured.serversRead ? null : CONFIGURATION_UNREAD;
}

// The rule about values (§C): stdout is never read; the success is worded from the input; the CLI's last error line, as
// the CLI wrote it, is forwarded whole (trimmed) when `withheldLine` passes it, and is otherwise replaced whole by the
// fixed sentence of its trigger (R10's read-back error, or a value slot's content). Nothing is replaced inside a line.
function customAddOutcome(input: McpEntryAdd, run: CliRun): PluginsOutcome {
  if (run.code === 0) return { ok: true, result: { command: 'mcp add-json', outcome: 'ok', message: CUSTOM_ADD_WORDS.added(input.entry.type, input.name, input.scope), name: input.name, scope: input.scope } };
  const raw = run.stderr.split('\n').filter((line) => line.trim().length > 0).at(-1); // as the CLI wrote it
  if (raw === undefined) return noResult(run);
  const withheld = withheldLine(raw, mcpValueSlotsOf(input));
  if (withheld === 'readback') return failed('cli_failed', CUSTOM_ADD_WORDS.readback(run.code), 'readback_unconfirmed');
  if (withheld === 'value') return failed('cli_failed', CUSTOM_ADD_WORDS.withheld(run.code, mcpShownCommand(input)), 'message_withheld');
  return failed('cli_failed', raw.trim());
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
    readFromFolder: row.readFromFolder || null, // an empty folder is none
    folderVersion: row.folderVersion ?? null,
    installedAt: row.installedAt ?? null,
    lastUpdated: row.lastUpdated ?? null,
    projectEnabled: row.projectEnabled ?? false,
  }));
}

// Whether a realpath lies under a root: equal to it, or inside it at a segment boundary (`/repo2` is not under `/repo`;
// the rule of `src/services/files/allowlist.ts`).
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
// or the object's kind (`source`), its locators and its pins, the branch or tag (`ref`) and the commit (`sha`), both kept
// (P4-AGG M2: each catalog route keeps its own pin). Whether a pin denies the engine's fold key is source-key.ts's to read
// (2.1.292 `Sb` :832435-832446: a ref decides it unless a full commit sha pins the code beside it).
export function sourceRefOf(source: unknown): PluginSourceRef | null {
  if (typeof source === 'string') return source;
  if (!isRecord(source)) return null;
  return { kind: str(source.source) ?? 'unknown', url: str(source.url), repo: str(source.repo), path: str(source.path), ref: str(source.ref), sha: str(source.sha) };
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

// `{ name, source, repo?|url?|path?, ref?, installLocation }`, or a claude.ai entry with no locator (SPEC 30). The
// `ref`, a repository marketplace's branch or tag, is kept (P2-B): it denies the marketplace's relative entries the
// engine's fold key (2.1.292 `Sb`/`x5`, cli.pretty.js:832437-832440, :832459-832464).
const MarketplaceRowSchema = z.looseObject({ name: z.string(), source: z.string(), repo: z.string().optional(), url: z.string().optional(), path: z.string().optional(), ref: z.unknown().optional(), installLocation: z.string().optional() });

export function marketplacesOf(stdout: string): Marketplace[] {
  return documentOf(stdout, z.array(MarketplaceRowSchema), 'plugin marketplace list --json').map((m) => ({
    name: m.name,
    source: m.source,
    locator: m.repo ?? m.url ?? m.path ?? null,
    ref: str(m.ref), // P2-B
    installLocation: m.installLocation || null, // P2-B: an empty location is none
  }));
}
