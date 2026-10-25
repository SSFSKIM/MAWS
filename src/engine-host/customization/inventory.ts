// UX2-K: configured inventory, never a connection or an effective engine configuration. No CLI, engine session,
// executable resolution, variable expansion or writes. MCP path selection and regular-file bounds reuse route D's
// cold readers. Metadata parsing reuses the plugin inventory's front-matter reader.
// Engine evidence (2.1.302 cli.pretty.js): project skill directories stop at home/the repository (686598-686630),
// SKILL.md lives one folder below each skills directory (765453-765544), project .mcp.json files are read up the entire
// ancestor chain (737077-737101), and installed_plugins.json v2 holds arrays of scoped installation records (775499,
// 775585). Local keys use the already-probed conservative derivation in connectors/local-key.ts.
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { HostOn } from '@shared/host/runtime';
import type { CustomizationEndpoint, CustomizationInventory, CustomizationServer, CustomizationSkill } from '@shared/ipc/schema';
import { CUSTOMIZATION_INVENTORY_COVERAGE } from '@shared/ipc/schema/customization';
import { migrateSettings } from '@shared/settings/defaults';
import { captureLocalKey } from '../connectors/local-key';
import { configFileOf, legacyConfigFileOf, nodeSourceFiles } from '../connectors/source-entry';
import { under } from '../plugins/cli-result';
import { frontMatter } from '../plugins/front-matter';

export const INVENTORY_BOUNDS = {
  jsonBytes: 4 * 1024 * 1024, frontMatterBytes: 8 * 1024, totalBytes: 16 * 1024 * 1024,
  entries: 2048, rows: 1024, ancestors: 128, timeoutMs: 7000,
} as const;
interface InventoryDeps { userData: string; captureEnv: () => Promise<Record<string, string>>; timeoutMs?: number }
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const absent = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');
const LIMIT = 'Customization inventory reached its read limit; some configured items are not inventoried.';
class Stop extends Error {}

class Reading {
  readonly skills: CustomizationSkill[] = [];
  readonly servers: CustomizationServer[] = [];
  readonly endpoints: CustomizationEndpoint[] = []; // P4-AGG M4: `servers`, row for row, with each one's URL (main only)
  readonly warnings = new Set<string>();
  stopped = false;
  serversRead = false; // P4-AGG M4: every MCP configuration that applies was read without a warning
  private mcpMark = -1;
  private entries = 0;
  private bytes = 0;

  check(): void { if (this.stopped) throw new Stop(); }
  tick(): void { this.check(); if (++this.entries > INVENTORY_BOUNDS.entries) throw new Stop(); }
  warn(message: string): void { this.check(); if (this.warnings.size < 64) this.warnings.add(message); }
  snapshot(): CustomizationInventory { return { skills: [...this.skills], servers: [...this.servers], warnings: [...this.warnings], serversRead: this.serversRead }; }
  // An MCP read section: no warning added inside it (and the warning cap not reached), or the servers are not the whole set.
  mcpStart(): void { this.mcpMark = this.warnings.size; }
  mcpEnd(): boolean { return this.mcpMark >= 0 && this.warnings.size === this.mcpMark && this.warnings.size < 64; }
  addSkill(row: CustomizationSkill): void {
    this.check(); if (this.skills.length >= INVENTORY_BOUNDS.rows) throw new Stop(); this.skills.push(row);
  }
  addServer(row: CustomizationServer, url: string | null): void {
    this.check(); if (this.servers.length >= INVENTORY_BOUNDS.rows) throw new Stop(); this.servers.push(row);
    this.endpoints.push({ name: row.name, scope: row.scope, path: row.path, transport: row.transport, url: url === null ? null : url.slice(0, 4096) });
  }

  async exists(path: string): Promise<boolean> {
    this.tick();
    try { const found = await nodeSourceFiles.exists(path); this.check(); return found; }
    catch (error) { if (error instanceof Stop) throw error; this.warn(`${path}: could not be read`); return false; }
  }
  async confined(path: string, anchor?: string): Promise<string | null> {
    this.tick();
    try {
      const found = await realpath(path); this.check();
      if (anchor && !under(anchor, found)) { this.warn(`${path}: outside the plugin`); return null; }
      return found;
    } catch (error) {
      if (error instanceof Stop) throw error;
      if (!absent(error)) this.warn(`${path}: could not be read`);
      return null;
    }
  }

  // Markdown is prefix-only even when the body is enormous. Plugin files are confined and opened without following
  // links; rechecking their spelling and inode after open prevents a replaced link from borrowing the anchor.
  private async boundedFile(path: string, maxBytes: number, prefix: boolean, anchor?: string): Promise<string | null> {
    const found = anchor ? await this.confined(path, anchor) : path;
    if (found === null) return null;
    this.tick();
    const handle = await open(found, constants.O_RDONLY | constants.O_NONBLOCK | (anchor ? constants.O_NOFOLLOW : 0));
    try {
      this.check();
      const info = await handle.stat(); this.check();
      if (!info.isFile() || (!prefix && info.size > maxBytes)) throw new Error('unreadable');
      if (anchor) {
        const again = await realpath(path); this.check();
        const current = await lstat(found); this.check();
        if (again !== found || current.dev !== info.dev || current.ino !== info.ino) throw new Error('changed');
      }
      const chunks: Buffer[] = [];
      let total = 0;
      while (total < maxBytes + (prefix ? 0 : 1)) {
        this.check();
        const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + (prefix ? 0 : 1) - total));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null); this.check();
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxBytes) throw new Error('too large');
        chunks.push(chunk.subarray(0, bytesRead));
      }
      return Buffer.concat(chunks, total).toString('utf8');
    } finally { await handle.close(); }
  }

  async text(path: string, prefix = false, anchor?: string): Promise<string | null> {
    this.tick();
    const max = Math.min(prefix ? INVENTORY_BOUNDS.frontMatterBytes : INVENTORY_BOUNDS.jsonBytes, INVENTORY_BOUNDS.totalBytes - this.bytes);
    if (max <= 0) throw new Stop();
    try {
      const text = prefix || anchor ? await this.boundedFile(path, max, prefix, anchor) : await nodeSourceFiles.read(path, max);
      this.check();
      if (text !== null) this.bytes += Buffer.byteLength(text);
      return text;
    } catch (error) {
      if (error instanceof Stop) throw error;
      if (!absent(error)) this.warn(`${path}: could not be read`);
      return null;
    }
  }
  async json(path: string, anchor?: string): Promise<unknown> {
    const text = await this.text(path, false, anchor);
    if (text === null) return undefined;
    try { return JSON.parse(text) as unknown; }
    catch { this.warn(`${path}: not valid JSON`); return undefined; }
  }

  async directories(path: string, anchor?: string): Promise<string[]> {
    const found = anchor ? await this.confined(path, anchor) : path;
    if (found === null) return [];
    this.tick();
    let directory;
    try { directory = await opendir(found); }
    catch (error) { if (!absent(error)) this.warn(`${path}: could not be read`); return []; }
    try {
      this.check();
      const names: string[] = [];
      for (;;) {
        const entry = await directory.read(); this.check();
        if (entry === null) break;
        this.tick();
        // The engine's sync-owned subtree is not a directory of ordinary user skills.
        if (entry.name !== 'synced' && (entry.isDirectory() || entry.isSymbolicLink())) names.push(entry.name);
      }
      return names.sort().map((name) => join(path, name));
    } finally { await directory.close(); }
  }

  async skillDirectory(path: string, source: CustomizationSkill['source'], plugin: string | null, anchor?: string): Promise<boolean> {
    const file = join(path, 'SKILL.md');
    const text = await this.text(file, true, anchor);
    if (text === null) return false;
    const words = frontMatter(text);
    this.addSkill({ name: (words.name ?? basename(path)).slice(0, 256), description: (words.description ?? '').slice(0, 4096), source, path: file, plugin });
    return true;
  }
  async skillsIn(path: string, source: CustomizationSkill['source'], plugin: string | null = null, anchor?: string): Promise<void> {
    for (const child of await this.directories(path, anchor)) await this.skillDirectory(child, source, plugin, anchor);
  }

  serversOf(value: unknown, scope: CustomizationServer['scope'], path: string): void {
    if (value === undefined) return;
    const map = record(value);
    if (!map) { this.warn(`${path}: unknown MCP configuration shape`); return; }
    for (const name of Object.keys(map).sort()) {
      this.tick();
      const entry = record(map[name]);
      if (!entry) { this.warn(`${path}: unknown MCP configuration shape`); continue; }
      const type = entry.type === 'streamable-http' ? 'http' : entry.type === undefined && typeof entry.command === 'string' ? 'stdio' : entry.type;
      const transport = (['stdio', 'http', 'sse', 'ws'].includes(type as string) ? type : 'unknown') as CustomizationServer['transport'];
      this.addServer({ name: name.slice(0, 256), scope, path, transport }, typeof entry.url === 'string' ? entry.url : null);
    }
  }
}

async function installedSkills(r: Reading, configHome: string, cwd: string | null): Promise<void> {
  const path = join(configHome, 'plugins', 'installed_plugins.json');
  const raw = await r.json(path);
  if (raw === undefined) return;
  const inventory = record(raw);
  const plugins = record(inventory?.plugins);
  if (inventory?.version !== 2 || !plugins) { r.warn(`${path}: unsupported installed plugin inventory`); return; }
  for (const plugin of Object.keys(plugins).sort()) {
    const rows = plugins[plugin];
    if (!Array.isArray(rows)) { r.warn(`${path}: unknown installation shape`); continue; }
    for (const rawRow of rows) {
      r.tick();
      const row = record(rawRow);
      if (!row || !['user', 'project', 'local'].includes(row.scope as string) || typeof row.installPath !== 'string' || !isAbsolute(row.installPath)) {
        r.warn(`${path}: unknown installation shape`); continue;
      }
      if (row.scope !== 'user' && (cwd === null || typeof row.projectPath !== 'string' || !isAbsolute(row.projectPath) || !under(resolve(row.projectPath), cwd))) continue;
      const anchor = await r.confined(row.installPath);
      if (anchor === null) { r.warn(`${path}: an installed plugin directory could not be read`); continue; }
      const id = plugin.slice(0, 256);
      const seen = new Set<string>();
      const addDirectory = async (directory: string): Promise<boolean> => {
        const real = await r.confined(directory, anchor);
        if (real === null) return false;
        if (seen.has(real)) return true;
        seen.add(real);
        return r.skillDirectory(directory, 'plugin', id, anchor);
      };
      for (const directory of await r.directories(join(row.installPath, 'skills'), anchor)) await addDirectory(directory);
      const manifestPath = join(row.installPath, '.claude-plugin', 'plugin.json');
      const manifest = record(await r.json(manifestPath, anchor));
      for (const declaration of [manifest?.skills, record(manifest?.experimental)?.skills]) {
        if (declaration === undefined) continue;
        const paths = typeof declaration === 'string' ? [declaration] : Array.isArray(declaration) ? declaration : [];
        if (paths.length === 0) r.warn(`${manifestPath}: unknown skills shape`);
        for (const spec of paths) {
          r.tick();
          if (typeof spec !== 'string' || isAbsolute(spec)) { r.warn(`${manifestPath}: unknown skills shape`); continue; }
          const directory = resolve(row.installPath, spec);
          if (!under(resolve(row.installPath), directory)) { r.warn(`${manifestPath}: outside the plugin`); continue; }
          if (!(await addDirectory(directory))) for (const child of await r.directories(directory, anchor)) await addDirectory(child);
        }
      }
      r.warn(CUSTOMIZATION_INVENTORY_COVERAGE);
    }
  }
}

async function collect(r: Reading, cwd: string | null, deps: InventoryDeps): Promise<void> {
  const appFile = join(deps.userData, 'settings.json');
  r.mcpStart();
  const app = await r.json(appFile);
  if (app !== undefined) {
    try {
      for (const { name, type, url } of migrateSettings(app).engine.mcpServers) r.addServer({ name, scope: 'app', path: appFile, transport: type }, url);
    } catch (error) { if (error instanceof Stop) throw error; r.warn(`${appFile}: invalid app settings`); }
  }
  const appRead = r.mcpEnd();
  let env: Record<string, string>;
  try { env = await deps.captureEnv(); r.check(); }
  catch (error) { if (error instanceof Stop) throw error; r.warn('User configuration environment could not be read.'); return; }
  const home = env.HOME || homedir();
  env = { ...env, HOME: home };
  const configHome = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const local = cwd === null ? null : await captureLocalKey(cwd);
  r.check();
  if (isAbsolute(configHome)) await r.skillsIn(join(configHome, 'skills'), 'user');
  else r.warn('User skills and plugin inventory require an absolute config directory.');
  if (cwd !== null) {
    for (let at = cwd, count = 0; at !== home; at = dirname(at)) {
      if (++count > INVENTORY_BOUNDS.ancestors) throw new Stop();
      await r.skillsIn(join(at, '.claude', 'skills'), 'project');
      if (await r.exists(join(at, '.git')) || dirname(at) === at) break;
    }
  }
  const global = configFileOf(env);
  const legacy = legacyConfigFileOf(env);
  r.mcpStart();
  if (!global || !legacy || await r.exists(legacy)) r.warn('User and local MCP configuration is not inventoried: its config file could not be identified.');
  else {
    const raw = await r.json(global);
    const settings = record(raw);
    if (raw !== undefined && !settings) r.warn(`${global}: unknown MCP configuration shape`);
    r.serversOf(settings?.mcpServers, 'user', global);
    if (cwd !== null && local !== null) {
      if (local.kind === 'unidentified') r.warn('Local MCP configuration is not inventoried: the project key could not be identified.');
      else r.serversOf(record(record(settings?.projects)?.[local.key])?.mcpServers, 'local', global);
    }
  }
  if (cwd !== null) {
    const ancestors: string[] = [];
    for (let at = cwd; dirname(at) !== at; at = dirname(at)) {
      if (ancestors.length >= INVENTORY_BOUNDS.ancestors) throw new Stop();
      ancestors.push(at);
    }
    for (const ancestor of ancestors.reverse()) {
      const path = join(ancestor, '.mcp.json');
      const raw = await r.json(path);
      if (raw !== undefined && !record(raw)) r.warn(`${path}: unknown MCP configuration shape`);
      r.serversOf(record(raw)?.mcpServers, 'project', path);
    }
  }
  r.serversRead = appRead && r.mcpEnd();
  if (isAbsolute(configHome)) await installedSkills(r, configHome, cwd);
}

export async function readCustomizationInventory(cwd: string | null, deps: InventoryDeps): Promise<CustomizationInventory> {
  return (await readInventory(cwd, deps)).snapshot();
}

/** P4-AGG M4: the configured servers with their URLs, for main's catalog alone (`customization.serverEndpoints`). */
export async function readServerEndpoints(cwd: string | null, deps: InventoryDeps): Promise<{ servers: CustomizationEndpoint[] }> {
  return { servers: [...(await readInventory(cwd, deps)).endpoints] };
}

async function readInventory(cwd: string | null, deps: InventoryDeps): Promise<Reading> {
  const r = new Reading();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((settle) => { timer = setTimeout(() => { r.stopped = true; r.warnings.add(LIMIT); settle(); }, deps.timeoutMs ?? INVENTORY_BOUNDS.timeoutMs); });
  const reading = collect(r, cwd === null ? null : resolve(cwd), deps).catch((error: unknown) => {
    if (error instanceof Stop) r.warnings.add(LIMIT);
    else r.warnings.add('Customization inventory could not be fully read.');
  });
  try { await Promise.race([reading, deadline]); return r; }
  finally { clearTimeout(timer); r.stopped = true; }
}

export function registerCustomizationInventory(on: HostOn, deps: InventoryDeps): void {
  on('customization.inventory', ({ cwd }) => readCustomizationInventory(cwd, deps));
  on('customization.serverEndpoints', ({ cwd }) => readServerEndpoints(cwd, deps)); // P4-AGG M4
}
