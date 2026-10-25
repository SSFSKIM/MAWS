// The catalog's engine reads (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Parts", the
// boundary): what the engine has in one cwd, asked of the engine host, never read from the engine's files by main.
// `plugins.list`, `plugins.available`, `marketplaces.list`, each listed marketplace's `plugins.marketplaceManifest`, and
// the MCP servers configured for the cwd (`customization.inventory`, a connector's installed state). A cwd of null is the
// user configuration, read in the engine's configuration directory as Customize reads it.
// - Held per cwd (the last 16) until `invalidate`: on `plugins.changed` (every plugin and marketplace mutation, and each
//   time the host connects), on Refresh, and on a change main's watch of the engine's plugin state sees (state-watch.ts;
//   a project's settings invalidate that cwd alone). Not cached on disk. `generation` moves on every invalidation, so a
//   caller can tell a view read before one from a view read after it.
// - A read that fails is null in the view and the catalog shows what the other sources hold; the view is kept until the
//   next invalidation, so a host that is down is not asked again on every read.
// - The Anthropic Directory's entries leave `plugins.available` once installed (fact 2a), and their names are the
//   engine's own: an installed one is known by the repository the engine recorded for it at install
//   (`plugins.directoryProvenance`), which outlives a restart.
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { MarketplaceManifestView } from '@shared/ipc/schema/plugins';
import type { EngineView } from './normalize';
import { DIRECTORY_MARKETPLACE } from './sources';

export type HostCall = <N extends CommandName>(name: N, input: CommandInput<N>) => Promise<CommandResult<N>>;

const KEPT_DIRECTORIES = 16;

/** Where the engine keeps the state a view was read from: what main's watch looks at. */
export interface EngineStatePlaces {
  configHome: string | null;
  pluginsDir: string | null;
  globalConfig: string | null; // the engine's global file (user and local MCP servers)
  projects: string[]; // the held cwds (the user configuration's view apart)
}

/** A held view and the read that produced it: `serial` is new for every read, so a view read anew (after an invalidation
 * or after the view was evicted) is never mistaken for the one before it. */
export interface EngineSnapshot {
  serial: number;
  view: Promise<EngineView | null>;
  servers: Promise<string | null>; // the configured MCP servers' endpoints as read beside the view, compared by recheckServers
}

export class EngineReads {
  private readonly views = new Map<string, EngineSnapshot>();
  private serials = 0;
  private configHome: string | null = null;
  private globalConfig: string | null = null;
  private pluginsDir: string | null = null;
  /** Moves on every invalidation. */
  generation = 0;

  constructor(
    private readonly call: HostCall,
    private readonly log: (line: string) => void = () => {},
  ) {}

  /** The engine's reads for `cwd`: held, else read now. Null when even the engine's configuration could not be asked. */
  view(cwd: string | null): Promise<EngineView | null> {
    return this.snapshot(cwd).view;
  }

  /** `view`, with the serial of the read behind it. */
  snapshot(cwd: string | null): EngineSnapshot {
    const key = cwd ?? '';
    let snapshot = this.views.get(key);
    if (snapshot === undefined) {
      snapshot = { serial: (this.serials += 1), view: this.read(cwd), servers: this.serversOf(cwd) };
      for (const oldest of this.views.keys()) {
        if (this.views.size < KEPT_DIRECTORIES) break;
        this.views.delete(oldest);
      }
    } else this.views.delete(key); // the most recently asked last
    this.views.set(key, snapshot);
    return snapshot;
  }

  /** Whether `cwd`'s view is held. */
  holds(cwd: string | null): boolean {
    return this.views.has(cwd ?? '');
  }

  /** Forget every held view, or only `cwd`'s (null: the user configuration's). */
  invalidate(cwd?: string | null): void {
    if (cwd === undefined) this.views.clear();
    else this.views.delete(cwd ?? '');
    this.generation += 1;
  }

  places(): EngineStatePlaces {
    return { configHome: this.configHome, pluginsDir: this.pluginsDir, globalConfig: this.globalConfig, projects: [...this.views.keys()].filter((key) => key !== '') };
  }

  /** After an MCP configuration changed: forget each held view whose configured servers (names, scopes, files,
   * transports, endpoints) are not what they were when it was read; whether any was. A view read meanwhile is left. */
  async recheckServers(): Promise<boolean> {
    const held = [...this.views];
    const moved = await Promise.all(held.map(async ([key, snapshot]) => (await snapshot.servers) !== (await this.serversOf(key === '' ? null : key))));
    let any = false;
    held.forEach(([key, snapshot], i) => {
      if (!moved[i] || this.views.get(key) !== snapshot) return;
      this.invalidate(key === '' ? null : key);
      any = true;
    });
    return any;
  }

  // The configured MCP servers for `cwd` as one comparable string, or null when they could not be read.
  private async serversOf(cwd: string | null): Promise<string | null> {
    const answer = await this.ask('customization.serverEndpoints', { cwd });
    return answer === null ? null : JSON.stringify(answer.servers);
  }

  private async ask<N extends CommandName>(name: N, input: CommandInput<N>): Promise<Extract<CommandResult<N>, { ok: true }>['value'] | null> {
    const result = await this.call(name, input).catch((error: unknown) => ({ ok: false as const, error: { message: error instanceof Error ? error.message : String(error) } }));
    if (result.ok) return result.value;
    this.log(`${name} failed: ${result.error.message}`);
    return null;
  }

  private async read(cwd: string | null): Promise<EngineView | null> {
    if (this.configHome === null) {
      const env = await this.ask('plugins.env', {});
      this.configHome = env?.configHome ?? null;
      this.globalConfig = env?.globalConfig ?? null;
    }
    const directory = cwd ?? this.configHome;
    if (directory === null) return null;
    const [installed, available, marketplaces, inventory] = await Promise.all([
      this.ask('plugins.list', { cwd: directory }),
      this.ask('plugins.available', { cwd: directory }),
      this.ask('marketplaces.list', { cwd: directory }),
      this.ask('customization.inventory', { cwd }),
    ]);
    const manifests = new Map<string, MarketplaceManifestView>();
    const directoryNames = (installed?.plugins ?? []).filter((row) => row.marketplace === DIRECTORY_MARKETPLACE).map((row) => row.name);
    const [provenance] = await Promise.all([
      this.ask('plugins.directoryProvenance', { names: [...new Set(directoryNames)].slice(0, 1000) }),
      ...(marketplaces?.marketplaces ?? []).map(async (m) => {
        const manifest = await this.ask('plugins.marketplaceManifest', { cwd: directory, name: m.name });
        if (manifest !== null) manifests.set(m.name, manifest);
      }),
    ]);
    if (provenance !== null) this.pluginsDir = provenance.pluginsDir;
    return {
      cwd: directory,
      installed: installed?.plugins ?? null,
      available: available?.plugins ?? null,
      marketplaces: marketplaces?.marketplaces ?? null,
      manifests,
      servers: inventory === null ? null : inventory.servers.map((s) => s.name),
      directoryInstalled: new Map((provenance?.entries ?? []).map((e) => [e.name, e.repositoryKey])),
    };
  }
}
