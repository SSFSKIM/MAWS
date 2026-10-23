// WR 76/78: owner-gesture delivery has its own source authority, not a synthetic engine observation. Cold discovery
// reads only user-scope literal HTTP entries and MAWS's validated app MCP settings. No precedence inference, project
// scanning, variable expansion, executable launch or engine credential access. Page grants still use provenance.ts.
// Entries are reread for every use; only keyed digests and public identities survive a lookup. The attachment's clear
// and any lookup seeing a changed/removed entry revoke earlier write proofs, as the observed-source cache does.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ConnectorToolRefSchema } from '@shared/artifacts/connectors';
import { migrateSettings } from '@shared/settings/defaults';
import type { ConnectorSourceAnswer, ConnectorWriteEntryAnswer, VerifiedConnectorSource } from './provenance';
import { canonicalJson, CONFIG_FILE_MAX_BYTES, configFileOf, legacyConfigFileOf, materializeEntry, nodeSourceFiles, type ConnectorLaunchEntry, type SourceFiles } from './source-entry';

type Scope = 'app' | 'user';
type Candidate = { cwd: string; server: string; listed: boolean; http: boolean };
type Known = { source: VerifiedConnectorSource; digest: string };
type Entry = { source: VerifiedConnectorSource; entry: ConnectorLaunchEntry };
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const httpUrl = (url: string) => { try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname && !u.username && !u.password; } catch { return false; } };

export class ConfiguredDeliverySources {
  private readonly files: SourceFiles;
  private readonly directories: Record<Scope, string>;
  private readonly settingsFile: string;
  private readonly userFile: string | null;
  private readonly legacyFile: string | null;
  private readonly known: Record<Scope, Map<string, Known>> = { app: new Map(), user: new Map() };
  private readonly sequence: Record<Scope, number> = { app: 0, user: 0 };
  private key = randomBytes(32);
  private generation = 0;
  private epoch = 0;

  constructor(options: { userData: string; environment: Readonly<Record<string, string | undefined>>; files?: SourceFiles }) {
    this.files = options.files ?? nodeSourceFiles;
    this.settingsFile = join(options.userData, 'settings.json');
    // Private selectors, never session working directories or filesystem permissions.
    this.directories = { app: join(options.userData, 'connectors', 'configured-app'), user: join(options.userData, 'connectors', 'configured-user') };
    const environment = Object.fromEntries(Object.entries(options.environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    this.userFile = configFileOf(environment);
    this.legacyFile = legacyConfigFileOf(environment);
  }

  owns(directory: string): boolean { return Object.values(this.directories).includes(directory); }

  async candidates(urlHosts?: readonly string[]): Promise<Candidate[]> {
    const scopes = await Promise.all([this.load('app'), this.load('user')]);
    return scopes.flatMap((entries) => [...entries.values()]
      .filter(({ source }) => urlHosts === undefined || urlHosts.includes(new URL(source.url!).hostname))
      .map(({ source }) => ({ cwd: source.cwd, server: source.server, listed: false, http: true })));
  }

  async resolveSource(directory: string, server: string): Promise<ConnectorSourceAnswer> {
    const entry = await this.entry(directory, server);
    return entry ? { ok: true, source: entry.source } : { ok: false, why: 'changed' };
  }

  async readEntryForWrite(source: VerifiedConnectorSource): Promise<ConnectorWriteEntryAnswer> {
    const epoch = this.epoch;
    const entry = await this.entry(source.cwd, source.server);
    if (!entry || epoch !== this.epoch || entry.source.sourceId !== source.sourceId || entry.source.generation !== source.generation) return { ok: false, why: 'changed' };
    const scope = entry.source.scope as Scope;
    return { ok: true, ...entry, stillValid: () => this.epoch === epoch && this.known[scope].get(source.server)?.source.sourceId === source.sourceId };
  }

  clear(): void {
    this.epoch += 1;
    this.sequence.app += 1;
    this.sequence.user += 1;
    this.known.app.clear();
    this.known.user.clear();
    this.key = randomBytes(32);
  }

  private async entry(directory: string, server: string): Promise<Entry | undefined> {
    const scope = directory === this.directories.app ? 'app' : directory === this.directories.user ? 'user' : null;
    return scope === null ? undefined : (await this.load(scope)).get(server);
  }

  private async load(scope: Scope): Promise<Map<string, Entry>> {
    const seq = ++this.sequence[scope];
    const epoch = this.epoch;
    const entries = new Map<string, Entry>();
    const next = new Map<string, Known>();
    const path = scope === 'app' ? this.settingsFile : this.userFile;
    try {
      if (!path || (scope === 'user' && (!this.legacyFile || await this.files.exists(this.legacyFile)))) throw new Error('unidentified');
      const text = await this.files.read(path, CONFIG_FILE_MAX_BYTES);
      if (text === null) throw new Error('absent');
      const json: unknown = JSON.parse(text);
      const configured = scope === 'app'
        ? migrateSettings(json).engine.mcpServers.map(({ name, type, url }) => [name, { type, url }] as const)
        : Object.entries(record(record(json)?.mcpServers) ?? {});
      if (configured.length > 256) throw new Error('capacity');
      for (const [server, raw] of configured) {
        if (!ConnectorToolRefSchema.shape.server.safeParse(server).success) continue;
        const config = record(raw);
        if (!config || !['http', 'streamable-http'].includes(config.type as string)) continue;
        const made = await materializeEntry(config, {}, this.directories[scope], this.files);
        if (typeof made === 'string' || made.launch.transport !== 'http' || !httpUrl(made.launch.url)) continue;
        const digest = createHmac('sha256', this.key).update(canonicalJson(made.launch)).digest('hex');
        const old = this.known[scope].get(server);
        const source = old?.digest === digest ? old.source : {
          sourceId: randomUUID(), generation: ++this.generation, cwd: this.directories[scope], server, scope,
          transport: 'http' as const, url: made.launch.url, path,
          // App settings is a unique-name array: use a name selector, not a reorder-sensitive index, for OAuth custody.
          entryPath: scope === 'app' ? ['engine', 'mcpServers', `name=${server}`] : ['mcpServers', server],
          observedAt: new Date().toISOString(), entryDigest: digest,
        };
        next.set(server, { source, digest });
        entries.set(server, { source, entry: made.launch });
      }
    } catch {
      entries.clear();
      next.clear(); // unreadable or invalid is not permission to keep an old entry
    }
    if (epoch !== this.epoch || seq !== this.sequence[scope]) return new Map();
    this.known[scope] = next;
    return entries;
  }
}
