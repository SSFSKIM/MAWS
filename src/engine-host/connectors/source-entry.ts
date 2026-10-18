// P3-HD M1: route D's one file entry (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, "Source truth and
// lifetime"; P3 co-work Decision Log 98 (1) and (2)). The engine reports a server's scope as a label, never a path, and
// omits a stdio server's env (spikes/p3-connectors/fixtures/engine-mcp-call.jsonl seq 5); the launch environment MAWS
// handed that engine names the one file a user-scope entry lives in, and the scope names one JSON location in it. That
// is lookup, not precedence: the engine chose the scope, nothing here re-resolves one.
//
// - The file is the engine's own rule (2.1.300 readable bundle, cli.pretty.js:729680-729695 and 38620):
//   `$CLAUDE_CONFIG_DIR || $HOME` joined with `.claude<suffix>.json`, the suffix empty unless
//   CLAUDE_CODE_CUSTOM_OAUTH_URL is set (unidentified here); a non-empty legacy `<config dir>/.config.json` wins over it
//   there, so its presence makes the file unidentified here too.
// - User scope is the top-level `mcpServers[name]`. Local scope is `projects[<key>].mcpServers[name]` (cli.pretty.js:
//   579146-579155) whose key the engine derives itself and the host captured at launch (./local-key.ts).
//   `locateEntry` reads exactly the key it is given and never scans other keys.
// - Literal entries only (P3-HD's settings ruling, branch B, from probe run 39007800364: file settings env overrides a
//   variable the launch held and supplies one it lacked, a default included). The engine expands `${VAR}` against an
//   environment settings MAWS never handed it have already changed (cli.pretty.js:279555-279595, 578182-578200), so any
//   `${…}` anywhere in an entry is `unattested` and the entry engine-only. Effective-environment attestation, which
//   would lift this, is P3-F's.
// - The whole entry becomes what MAWS's own instance runs: the SDK's minimal environment from the attested launch
//   environment (the launch plan's, the flag settings MAWS passed over it; a file setting of PATH or another of those
//   keys is not attested, a gap P3-F owns) plus exactly the configured env, the launch cwd, and the command found on that environment's PATH.
//   Helpers, manual OAuth clients, unknown options and other transports are engine-only, never run speculatively.
//   Nothing here persists, logs or caches a value it reads.
import { constants } from 'node:fs';
import { access, lstat, open, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

// Why a server is not a verified source (route D unavailable; the engine may still serve it).
export type ConnectorSourceRefusal =
  | 'unobserved' // no live report of this directory names it (a cold app, or an engine never started there)
  | 'ambiguous' // reports or entries disagree; engine-only until the attachment resets
  | 'engineOnly' // a scope, transport or option route D does not reproduce
  | 'unidentified' // the launch does not attest one file and one location in it
  | 'changed' // the entry left the file or no longer matches what the engine reported
  | 'unattested' // a `${…}` reference: its value depends on settings env MAWS did not hand the engine
  | 'unresolved' // the command cannot be found from the launch environment
  | 'unavailable'; // the file could not be read, a bound was reached, or the cache changed or cleared meanwhile

// The SDK's default stdio environment on macOS and Linux (`getDefaultEnvironment`, @modelcontextprotocol/sdk 1.32.1).
export const SDK_ENVIRONMENT_KEYS = ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'] as const;
export const CONFIG_FILE_MAX_BYTES = 64 * 1024 * 1024;

export type ConnectorTransport = 'stdio' | 'http';
// The visible fields of an entry, as mcp_status reports them (cli.pretty.js:476150-476160): stdio's type, command and
// args; http's type, url, headers and oauth (verbatim after expansion).
export type VisibleConfig =
  | { transport: 'stdio'; command: string; args: string[] }
  | { transport: 'http'; url: string; headers?: Record<string, string>; oauth?: Record<string, unknown> };

// What MAWS's own instance of the entry runs, read transiently at spawn or connect and then dropped.
export type ConnectorLaunchEntry =
  | { transport: 'stdio'; command: string; executable: string; args: string[]; cwd: string; env: Record<string, string> }
  | { transport: 'http'; url: string; headers: Record<string, string> };

export interface SourceFiles {
  read(path: string, maxBytes: number): Promise<string | null>; // null: absent; throws when unreadable, not a regular file, or past maxBytes
  exists(path: string): Promise<boolean>; // false only for ENOENT/ENOTDIR; throws on any other failure
  executable(path: string): Promise<boolean>; // a file with an execute bit for this process
}

const READ_CHUNK = 64 * 1024;

export const nodeSourceFiles: SourceFiles = {
  // Opened non-blocking, so a FIFO never holds the open; anything but a regular file refuses (a character device or
  // FIFO reports size 0 and could stream without end); and the cap holds on the bytes actually read, so a file growing
  // after its stat cannot pass it.
  async read(path, maxBytes) {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      if (!(await handle.stat()).isFile()) throw new Error(`${path} is not a regular file`);
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const chunk = Buffer.alloc(Math.min(READ_CHUNK, maxBytes + 1 - total));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxBytes) throw new Error(`${path} is larger than ${maxBytes} bytes`);
        chunks.push(chunk.subarray(0, bytesRead));
      }
      return Buffer.concat(chunks, total).toString('utf8');
    } finally {
      await handle.close();
    }
  },
  // Only an absence is false; a denied or failed check throws (the caller's unavailable), never reads as absent.
  async exists(path) {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return false;
      throw error;
    }
  },
  async executable(path) {
    try {
      if (!(await stat(path)).isFile()) return false;
      await access(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
};

type Environment = Readonly<Record<string, string>>;
const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const stringRecord = (value: unknown): value is Record<string, string> => record(value) !== null && Object.values(value as object).every((item) => typeof item === 'string');

// ── the file ──

export function configFileOf(environment: Environment): string | null {
  if (environment.CLAUDE_CODE_CUSTOM_OAUTH_URL) return null; // the engine reads `.claude-custom-oauth.json` then
  const home = environment.CLAUDE_CONFIG_DIR || environment.HOME;
  return home && isAbsolute(home) ? join(home, '.claude.json') : null;
}

export function legacyConfigFileOf(environment: Environment): string | null {
  const configDir = environment.CLAUDE_CONFIG_DIR ?? (environment.HOME ? join(environment.HOME, '.claude') : undefined);
  return configDir && isAbsolute(configDir) ? join(configDir, '.config.json') : null;
}

// ── references ──

const referencing = (value: string) => value.includes('${');

// ── the entry ──

export interface EntryLocation {
  entry: Record<string, unknown>;
  entryPath: string[];
}

// `key`: for local scope, the `projects` key the launch attests (never scanned for).
export function locateEntry(file: unknown, scope: 'user' | 'local', key: string, server: string): EntryLocation | 'changed' {
  const root = record(file);
  if (!root) return 'changed';
  const entry = scope === 'user' ? record(record(root.mcpServers)?.[server]) : record(record(record(record(root.projects)?.[key])?.mcpServers)?.[server]);
  if (!entry) return 'changed';
  return { entry, entryPath: scope === 'user' ? ['mcpServers', server] : ['projects', key, 'mcpServers', server] };
}

// The reported config's visible fields, or null for a transport or shape route D does not reproduce.
export function reportedVisible(config: unknown): VisibleConfig | null {
  const fields = record(config);
  if (!fields) return null;
  if (fields.type === 'stdio') {
    if (typeof fields.command !== 'string' || (fields.args !== undefined && !strings(fields.args))) return null;
    return { transport: 'stdio', command: fields.command, args: fields.args ?? [] };
  }
  if (fields.type === 'http') {
    if (typeof fields.url !== 'string' || (fields.headers !== undefined && !stringRecord(fields.headers)) || (fields.oauth !== undefined && !record(fields.oauth))) return null;
    return { transport: 'http', url: fields.url, ...(fields.headers !== undefined && { headers: fields.headers }), ...(fields.oauth !== undefined && { oauth: fields.oauth as Record<string, unknown> }) };
  }
  return null;
}

// The file entry's visible fields as the engine would report them; null for an unsupported transport or shape,
// `unattested` when one holds a reference.
export function visibleOfEntry(entry: Record<string, unknown>): VisibleConfig | 'unattested' | null {
  const type = entry.type === undefined ? 'stdio' : entry.type === 'streamable-http' ? 'http' : entry.type;
  if (type === 'stdio') {
    if (typeof entry.command !== 'string' || (entry.args !== undefined && !strings(entry.args))) return null;
    const args = entry.args ?? [];
    if (referencing(entry.command) || args.some(referencing)) return 'unattested';
    return { transport: 'stdio', command: entry.command, args };
  }
  if (type === 'http') {
    if (typeof entry.url !== 'string' || (entry.headers !== undefined && !stringRecord(entry.headers)) || (entry.oauth !== undefined && !record(entry.oauth))) return null;
    if (referencing(entry.url) || Object.values(entry.headers ?? {}).some(referencing)) return 'unattested';
    return { transport: 'http', url: entry.url, ...(entry.headers !== undefined && { headers: entry.headers }), ...(entry.oauth !== undefined && { oauth: entry.oauth as Record<string, unknown> }) };
  }
  return null;
}

// A canonical spelling of the visible fields: key order never matters, an absent field is absent.
export function visibleKey(visible: VisibleConfig): string {
  return canonicalJson(visible);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const fields = record(value);
  if (fields)
    return `{${Object.keys(fields)
      .filter((key) => fields[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(fields[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

const STDIO_FIELDS = new Set(['type', 'command', 'args', 'env']);
const HTTP_FIELDS = new Set(['type', 'url', 'headers']);

// The whole entry for MAWS's own instance, with its visible fields for the caller's comparison with the report.
export async function materializeEntry(entry: Record<string, unknown>, environment: Environment, cwd: string, files: SourceFiles): Promise<{ visible: VisibleConfig; launch: ConnectorLaunchEntry } | ConnectorSourceRefusal> {
  if (![undefined, 'stdio', 'http', 'streamable-http'].includes(entry.type as string | undefined)) return 'engineOnly'; // sse, ws, …
  const visible = visibleOfEntry(entry);
  if (visible === null) return 'changed'; // a shape the engine would not have reported as this server
  if (visible === 'unattested') return 'unattested';
  const allowed = visible.transport === 'stdio' ? STDIO_FIELDS : HTTP_FIELDS;
  if (Object.keys(entry).some((key) => !allowed.has(key))) return 'engineOnly'; // headersHelper, oauth, cwd, …
  if (visible.transport === 'http') return { visible, launch: { transport: 'http', url: visible.url, headers: { ...visible.headers } } };

  if (entry.env !== undefined && !stringRecord(entry.env)) return 'changed';
  const configured = (entry.env ?? {}) as Record<string, string>;
  if (Object.values(configured).some(referencing)) return 'unattested';
  const env: Record<string, string> = {};
  for (const key of SDK_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (typeof value === 'string' && !value.startsWith('()')) env[key] = value; // the SDK skips exported functions
  }
  Object.assign(env, configured);
  const executable = await resolveExecutable(visible.command, env.PATH, cwd, files);
  if (executable === null) return 'unresolved';
  return { visible, launch: { transport: 'stdio', command: visible.command, executable, args: visible.args, cwd, env } };
}

// As the spawn finds it: a path with a slash against the cwd, a bare name along the final environment's PATH. P3-HD
// panel correction: a relative or empty PATH component (searched from the engine's cwd) before the first absolute match
// refuses resolution rather than being skipped, so MAWS never runs a later directory's executable the engine would not.
async function resolveExecutable(command: string, path: string | undefined, cwd: string, files: SourceFiles): Promise<string | null> {
  if (command.length === 0) return null;
  if (command.includes('/')) {
    const candidate = isAbsolute(command) ? command : resolve(cwd, command);
    return (await files.executable(candidate)) ? candidate : null;
  }
  for (const directory of (path ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) return null;
    const candidate = join(directory, command);
    if (await files.executable(candidate)) return candidate;
  }
  return null;
}
