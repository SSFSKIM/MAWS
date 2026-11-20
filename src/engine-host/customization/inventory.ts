// UX2-K: configured inventory, never a connection or an effective engine configuration. No CLI, engine session,
// executable resolution, variable expansion or writes. MCP path selection and regular-file bounds reuse route D's
// cold readers. Metadata parsing reuses the plugin inventory's front-matter reader.
// Engine evidence (2.1.302 cli.pretty.js): project skill directories stop at home/the repository (686598-686630),
// SKILL.md lives one folder below each skills directory (765453-765544), project .mcp.json files are read up the entire
// ancestor chain (737077-737101), and installed_plugins.json v2 holds arrays of scoped installation records (775499,
// 775585). Local keys use the already-probed conservative derivation in connectors/local-key.ts.
import { createHmac, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { HostOn } from '@shared/host/runtime';
import type { CustomizationEndpoint, CustomizationInventory, CustomizationPluginEndpoint, CustomizationPluginServer, CustomizationServer, CustomizationSkill } from '@shared/ipc/schema';
import { CUSTOMIZATION_INVENTORY_COVERAGE } from '@shared/ipc/schema/customization';
import { usedEntry } from '@shared/plugins/connector-precedence';
import { addressFormOf } from '@shared/plugins/plugin-connector';
import { isUnifiedSettings, migrateMachineSettings, migrateSettings } from '@shared/settings/defaults';
import { captureLocalKey } from '../connectors/local-key';
import { configFileOf, legacyConfigFileOf, nodeSourceFiles } from '../connectors/source-entry';
import { under } from '../plugins/cli-result';
import { frontMatter } from '../plugins/front-matter';

export const INVENTORY_BOUNDS = {
  jsonBytes: 4 * 1024 * 1024, frontMatterBytes: 8 * 1024, totalBytes: 16 * 1024 * 1024,
  entries: 2048, rows: 1024, ancestors: 128, timeoutMs: 7000,
} as const;
interface InventoryDeps { userData: string; captureEnv: () => Promise<Record<string, string>>; timeoutMs?: number }

type Revision = (configuration: Pick<CustomizationEndpoint, 'name' | 'transport' | 'url'>) => string | null;
/** UX wave U11a M8 (docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md, §A): a configuration's
 * revision, an HMAC of its name, transport and address under `key`, in hex cut to 32 characters (the form of main's
 * `configurationFingerprint`). It tells two configurations of one name apart for a press from Customize, which never holds
 * an address; keyed, so a known address cannot be confirmed from it. Null for one without an address. */
export function configurationRevision(key: Buffer): Revision {
  return ({ name, transport, url }) => (url === null ? null : createHmac('sha256', key).update(`${name}\u0000${transport}\u0000${url}`).digest('hex').slice(0, 32));
}
/** The installation a plugin's connector is declared by, and what the engine names it by. */
export interface PluginConfiguration {
  plugin: string; // the key, `<name>@<marketplace>`
  installScope: CustomizationPluginServer['installScope'];
  installPath: string; // the installation's folder
  projectPath: string | null; // the folder it is installed for; null at user scope
  version: string | null;
  name: string | null; // the engine's name
  transport: CustomizationPluginServer['transport'];
  url: string | null;
}
type PluginRevision = (configuration: PluginConfiguration) => string | null;
/** UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §A, rule (d)): a plugin connector's
 * revision, `configurationRevision`'s form over the plugin's key, its installation (scope, folder, version), the engine
 * name, the transport and the address, so a removal, a replacement or an update between a row's display and its press
 * shows. Null without an engine name or an address. */
export function pluginConfigurationRevision(key: Buffer): PluginRevision {
  return ({ plugin, installScope, installPath, projectPath, version, name, transport, url }) => (name === null || url === null ? null
    : createHmac('sha256', key).update(JSON.stringify(['plugin', plugin, installScope, installPath, projectPath, version, name, transport, url])).digest('hex').slice(0, 32));
}
// The host's key: made at its start, kept in memory, never written or sent; a revision lives for one run of the host.
const hostKey = randomBytes(32);
const revisionOf = configurationRevision(hostKey);
const pluginRevisionOf = pluginConfigurationRevision(hostKey);
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const absent = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');
const LIMIT = 'Customization inventory reached its read limit; some configured items are not inventoried.';
class Stop extends Error {}
const FILE_RANK: Record<CustomizationServer['scope'], number> = { app: 0, project: 1, user: 2, local: 3 };
const URL_BOUND = 4096; // an endpoint's `url`
type FileEntry = CustomizationServer & { url: string | null };
const transportOf = (entry: Record<string, unknown>): CustomizationServer['transport'] => {
  const type = entry.type === 'streamable-http' ? 'http' : entry.type === undefined && typeof entry.command === 'string' ? 'stdio' : entry.type;
  return (['stdio', 'http', 'sse', 'ws'].includes(type as string) ? type : 'unknown') as CustomizationServer['transport'];
};
interface FileRead { realPath?: string; fileId?: string }

class Reading {
  readonly skills: CustomizationSkill[] = [];
  readonly servers: CustomizationServer[] = [];
  readonly endpoints: CustomizationEndpoint[] = []; // P4-AGG M4: `servers`, row for row, with each one's URL (main only)
  // UX wave U11h (§A): the plugins' connectors, the plugins kept for the folder, and the connectors row for row with
  // their addresses and revisions (main only)
  readonly pluginServers: CustomizationPluginServer[] = [];
  readonly plugins: NonNullable<CustomizationInventory['plugins']> = [];
  readonly pluginEndpoints: CustomizationPluginEndpoint[] = [];
  // the file-configured servers (`user`, `project`, `local`) with their addresses whole, for `sameAddressAs`
  private readonly fileEntries: FileEntry[] = [];
  private usedFileEntries: FileEntry[] | null = null; // of them, the one the engine uses for each name; made at the first plugin server
  readonly warnings = new Set<string>();
  stopped = false;
  serversRead = false; // P4-AGG M4: every MCP configuration that applies was read without a warning
  // UX wave U11's skill actions (docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md, decision 12): every skill
  // folder that applies was read with no warning outside an MCP section but the coverage note, and the read ran to its end
  skillsRead = true;
  private mcpMark = -1;
  private inMcp = false;
  private entries = 0;
  private bytes = 0;

  check(): void { if (this.stopped) throw new Stop(); }
  tick(): void { this.check(); if (++this.entries > INVENTORY_BOUNDS.entries) throw new Stop(); }
  warn(message: string): void {
    this.check();
    if (!this.inMcp && message !== CUSTOMIZATION_INVENTORY_COVERAGE) this.skillsRead = false;
    if (this.warnings.size < 64) this.warnings.add(message);
  }
  snapshot(): CustomizationInventory { return { skills: [...this.skills], servers: [...this.servers], warnings: [...this.warnings], serversRead: this.serversRead, pluginServers: [...this.pluginServers], plugins: [...this.plugins], skillsRead: this.skillsRead }; }
  // An MCP read section: no warning added inside it (and the warning cap not reached), or the servers are not the whole set.
  mcpStart(): void { this.mcpMark = this.warnings.size; this.inMcp = true; }
  mcpEnd(): boolean { this.inMcp = false; return this.mcpMark >= 0 && this.warnings.size === this.mcpMark && this.warnings.size < 64; }
  addSkill(row: CustomizationSkill): void {
    this.check(); if (this.skills.length >= INVENTORY_BOUNDS.rows) throw new Stop(); this.skills.push(row);
  }
  addServer(row: CustomizationServer, url: string | null): void {
    this.check(); if (this.servers.length >= INVENTORY_BOUNDS.rows) throw new Stop(); this.servers.push(row);
    if (row.scope !== 'app') this.fileEntries.push({ ...row, url });
    const address = url === null ? null : url.slice(0, URL_BOUND);
    this.endpoints.push({ name: row.name, scope: row.scope, path: row.path, transport: row.transport, url: address, revision: revisionOf({ name: row.name, transport: row.transport, url: address }) });
  }
  addPlugin(row: NonNullable<CustomizationInventory['plugins']>[number]): void {
    this.check(); if (this.plugins.length >= INVENTORY_BOUNDS.rows) throw new Stop(); this.plugins.push(row);
  }
  addPluginServer(configuration: PluginConfiguration, row: Pick<CustomizationPluginServer, 'pluginName' | 'server' | 'path'>): void {
    this.check(); if (this.pluginServers.length >= INVENTORY_BOUNDS.rows) throw new Stop();
    const { plugin, installScope, version, name, transport, url } = configuration;
    this.pluginServers.push({ plugin, pluginName: row.pluginName, server: row.server, name, installScope, version, path: row.path, transport, address: url === null ? null : addressFormOf(url), sameAddressAs: this.sameAddressAs(transport, url) });
    // the address is classified, compared and revised whole; `pluginServers` lists none past the endpoint's bound
    this.pluginEndpoints.push({ plugin, pluginName: row.pluginName, server: row.server, name, version, path: row.path, transport, url, revision: pluginRevisionOf(configuration) });
  }
  // The engine drops a plugin's server whose address a file-configured server names
  // (spikes/protocol-probe/findings-uxwave-u11-plugin-server-dedup.txt), after it has merged the files' servers by name
  // (2.1.322 cli.pretty.js about 477063, then 476051): so only the `user`, `project` or `local` entry the engine uses for
  // its name (`usedEntry`) is compared, by its address as written, and of several such the highest (local, then user,
  // then the nearest project file). Only a remote address with no template is compared; MAWS's own list is not (the
  // engine does not compare servers given at launch). Read after every configured server, which `collect` reads first.
  private sameAddressAs(transport: CustomizationPluginServer['transport'], url: string | null): string | null {
    if (url === null || url.includes('${') || !['http', 'sse', 'ws'].includes(transport)) return null;
    this.usedFileEntries ??= this.fileEntries.filter((entry) => usedEntry(entry.name, this.fileEntries) === entry);
    let found: FileEntry | null = null;
    for (const entry of this.usedFileEntries) {
      if (entry.url !== url) continue;
      if (found === null || FILE_RANK[entry.scope] >= FILE_RANK[found.scope]) found = entry;
    }
    return found?.name ?? null;
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
  // UX wave U11's skill actions (decision 12): `read`, when given, is told the real path and the identity (device and inode)
  // of the file the text came from, so main can later open that file and no other.
  private async boundedFile(path: string, maxBytes: number, prefix: boolean, anchor?: string, read?: FileRead): Promise<string | null> {
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
      if (read) {
        const id = await handle.stat({ bigint: true }); this.check();
        read.realPath = anchor ? found : await realpath(path); this.check();
        read.fileId = `${id.dev}:${id.ino}`;
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

  async text(path: string, prefix = false, anchor?: string, read?: FileRead): Promise<string | null> {
    this.tick();
    const max = Math.min(prefix ? INVENTORY_BOUNDS.frontMatterBytes : INVENTORY_BOUNDS.jsonBytes, INVENTORY_BOUNDS.totalBytes - this.bytes);
    if (max <= 0) throw new Stop();
    try {
      const text = prefix || anchor ? await this.boundedFile(path, max, prefix, anchor, read) : await nodeSourceFiles.read(path, max);
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

  // `pluginName`: a plugin skill's plugin as the engine names it (UX wave U11a); the other skills carry none
  async skillDirectory(path: string, source: CustomizationSkill['source'], plugin: string | null, anchor?: string, pluginName: string | null = null): Promise<boolean> {
    const file = join(path, 'SKILL.md');
    const read: FileRead = {};
    const text = await this.text(file, true, anchor, read);
    if (text === null || read.realPath === undefined || read.fileId === undefined) return false;
    const words = frontMatter(text);
    this.addSkill({ name: (words.name ?? basename(path)).slice(0, 256), description: (words.description ?? '').slice(0, 4096), source, path: file, plugin, ...(source === 'plugin' && { pluginName }), realPath: read.realPath, fileId: read.fileId });
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
      this.addServer({ name: name.slice(0, 256), scope, path, transport: transportOf(entry) }, typeof entry.url === 'string' ? entry.url : null);
    }
  }
}

// UX wave U11a (§D "Skills"; P3, spikes/protocol-probe/findings-uxwave-u11-skill-names.txt): the engine names a plugin by
// its manifest's `name`, not by the installed key up to its `@`, and runs a plugin's skill as `/<that name>:<skill>`. A
// name the engine's rule refuses (2.1.322 cli.pretty.js:953562: empty, a space, a control or formatting character) loads
// no plugin under any name, and a longer one than the row holds would be cut wrong: both answer null.
const pluginNameOf = (name: unknown): string | null => (typeof name === 'string' && name.length > 0 && name.length <= 256 && !/[\s\p{Cc}\p{Cf}]/u.test(name) ? name : null);

// A URL where a path belongs (the manifest reader's test): never fetched.
const isUrl = (value: string) => /^[a-z][a-z\d+.-]*:/i.test(value);

// UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, M1): the servers one installation's
// files declare, by the rule its "What's inside" follows (`Inventory.mcpServers` in ../plugins/manifest.ts): its .mcp.json
// (`{mcpServers}` or the map itself), then each path and inline map its manifest names under `mcpServers` and
// `experimental.mcpServers`, the first declaration of a name winning. A bundle (.mcpb, .dxt) is never read and a URL where
// a path belongs never fetched; neither is listed nor warned of, since a warning reads as configuration that could not be
// read. Every file is confined to the plugin's folder, as its skills' are. A name is listed as written; one its field
// cannot hold is not listed, since a cut name is another name, and so for an address past the endpoints' bound.
async function pluginServers(r: Reading, installation: Omit<PluginConfiguration, 'name' | 'transport' | 'url'>, pluginName: string | null, anchor: string, manifest: Record<string, unknown> | null, manifestPath: string): Promise<void> {
  const { plugin, installPath } = installation;
  const seen = new Set<string>();
  const declared = (value: unknown, path: string): void => {
    const map = record(value);
    if (!map) { r.warn(`${path}: unknown MCP configuration shape`); return; }
    for (const [server, config] of Object.entries(map)) {
      r.tick();
      const entry = record(config);
      if (!entry) { r.warn(`${path}: unknown MCP configuration shape`); continue; }
      if (seen.has(server)) continue;
      seen.add(server);
      if (server.length === 0 || server.length > 256) continue;
      // the engine's name (spikes/protocol-probe/findings-uxwave-u11-plugin-connectors.txt, 1): the manifest's name, never the
      // key's; a built-in plugin's carries an alias the inventory cannot know (2.1.322 cli.pretty.js:954009-954011)
      const name = pluginName === null || plugin.endsWith('@builtin') ? null : `plugin:${pluginName}:${server}`;
      const url = typeof entry.url === 'string' ? entry.url : null;
      // an address past the endpoints' bound is not listed, as a name past its field's is: a cut address is another one,
      // which a session's live address at that prefix would match (the architect's ruling of 2026-11-15)
      if (url !== null && url.length > URL_BOUND) continue;
      r.addPluginServer({ ...installation, name, transport: transportOf(entry), url }, { pluginName, server, path });
    }
  };
  const file = async (path: string): Promise<void> => {
    const raw = await r.json(path, anchor);
    if (raw === undefined) return;
    declared(record(record(raw)?.mcpServers) ? record(raw)!.mcpServers : raw, path);
  };
  await file(join(installPath, '.mcp.json'));
  for (const declaration of [manifest?.mcpServers, record(manifest?.experimental)?.mcpServers]) {
    if (declaration === undefined) continue;
    for (const spec of Array.isArray(declaration) ? declaration : [declaration]) {
      r.tick();
      if (typeof spec === 'string') {
        if (/\.(mcpb|dxt)$/i.test(spec) || isUrl(spec)) continue;
        const path = resolve(installPath, spec);
        if (spec.includes('\0') || !under(resolve(installPath), path)) { r.warn(`${manifestPath}: outside the plugin`); continue; }
        await file(path);
      } else if (record(spec)) declared(spec, manifestPath);
      else r.warn(`${manifestPath}: unknown MCP configuration shape`);
    }
  }
}

// The installations that apply to the folder (user scope, or a project path the folder is under): each one's skills, and
// (UX wave U11h) for the first installation of each key, its entry in `plugins` and the servers its files declare.
async function installedPlugins(r: Reading, configHome: string, cwd: string | null): Promise<void> {
  const path = join(configHome, 'plugins', 'installed_plugins.json');
  const raw = await r.json(path);
  if (raw === undefined) return;
  const inventory = record(raw);
  const plugins = record(inventory?.plugins);
  if (inventory?.version !== 2 || !plugins) { r.warn(`${path}: unsupported installed plugin inventory`); return; }
  const kept = new Set<string>();
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
      // the manifest first: its name is every skill's of the plugin (U11a), its declarations add folders below
      const manifestPath = join(row.installPath, '.claude-plugin', 'plugin.json');
      const manifest = record(await r.json(manifestPath, anchor));
      const pluginName = pluginNameOf(manifest?.name);
      const seen = new Set<string>();
      const addDirectory = async (directory: string): Promise<boolean> => {
        const real = await r.confined(directory, anchor);
        if (real === null) return false;
        if (seen.has(real)) return true;
        seen.add(real);
        return r.skillDirectory(directory, 'plugin', id, anchor, pluginName);
      };
      for (const directory of await r.directories(join(row.installPath, 'skills'), anchor)) await addDirectory(directory);
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
      // one entry per key, its first installation for the folder in the file's order; a key its field cannot hold whole is
      // not listed (a cut key would name another plugin)
      if (!kept.has(plugin) && plugin.length > 0 && plugin.length <= 256) {
        kept.add(plugin);
        const installScope = row.scope as CustomizationPluginServer['installScope'];
        r.addPlugin({ plugin, pluginName, installScope });
        const version = typeof row.version === 'string' && row.version.length <= 256 ? row.version : null;
        const projectPath = row.scope === 'user' ? null : resolve(row.projectPath as string);
        await pluginServers(r, { plugin, installScope, installPath: row.installPath, projectPath, version }, pluginName, anchor, manifest, manifestPath);
      }
      r.warn(CUSTOMIZATION_INVENTORY_COVERAGE);
    }
  }
}

async function collect(r: Reading, cwd: string | null, deps: InventoryDeps): Promise<void> {
  // P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3): MAWS's own servers are the machine's, in
  // machine-settings.json; while that file is absent (a profile no split build has started) they are read from the
  // unified settings.json, as before. A client settings.json (version 21 on) holds none. A row names the file it was read from.
  const machineFile = join(deps.userData, 'machine-settings.json');
  const unifiedFile = join(deps.userData, 'settings.json');
  r.mcpStart();
  const fromMachine = await r.exists(machineFile);
  const appFile = fromMachine ? machineFile : unifiedFile;
  const app = await r.json(appFile);
  if (app !== undefined && (fromMachine || isUnifiedSettings(app))) {
    try {
      const servers = fromMachine ? migrateMachineSettings(app).engine.mcpServers : migrateSettings(app).engine.mcpServers;
      for (const { name, type, url } of servers) r.addServer({ name, scope: 'app', path: appFile, transport: type }, url);
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
  // the section ends whatever the app's settings said, so a later skill warning is not taken for an MCP one (U11 decision 13)
  const restRead = r.mcpEnd();
  r.serversRead = appRead && restRead;
  if (isAbsolute(configHome)) await installedPlugins(r, configHome, cwd);
}

export async function readCustomizationInventory(cwd: string | null, deps: InventoryDeps): Promise<CustomizationInventory> {
  return (await readInventory(cwd, deps)).snapshot();
}

/** P4-AGG M4: the configured servers with their URLs, for main's catalog alone (`customization.serverEndpoints`); UX wave
 * U11h: and the plugins' connectors with theirs. */
export async function readServerEndpoints(cwd: string | null, deps: InventoryDeps): Promise<{ servers: CustomizationEndpoint[]; pluginServers: CustomizationPluginEndpoint[] }> {
  const read = await readInventory(cwd, deps);
  return { servers: [...read.endpoints], pluginServers: [...read.pluginEndpoints] };
}

async function readInventory(cwd: string | null, deps: InventoryDeps): Promise<Reading> {
  const r = new Reading();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((settle) => { timer = setTimeout(() => { r.stopped = true; r.skillsRead = false; r.warnings.add(LIMIT); settle(); }, deps.timeoutMs ?? INVENTORY_BOUNDS.timeoutMs); });
  const reading = collect(r, cwd === null ? null : resolve(cwd), deps).catch((error: unknown) => {
    r.skillsRead = false;
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
