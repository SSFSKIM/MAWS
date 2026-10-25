// The catalog's engine reads (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Parts", the
// boundary): what the engine has in one cwd, asked of the engine host, never read from the engine's files by main.
// `plugins.list`, `plugins.available`, `marketplaces.list`, each listed marketplace's `plugins.marketplaceManifest`, and
// the MCP servers configured for the cwd (`customization.inventory`, a connector's installed state). A cwd of null is the
// user configuration, read in the engine's configuration directory as Customize reads it.
// - Held per cwd (the last 16) until `invalidate`: on `plugins.changed` (every plugin and marketplace mutation, and each
//   time the host connects) and on Refresh. Not cached on disk.
// - A read that fails is null in the view and the catalog shows what the other sources hold; the view is kept until the
//   next invalidation, so a host that is down is not asked again on every read.
// - The Anthropic Directory's entries leave `plugins.available` once installed (fact 2a), and their names are the
//   engine's own: the source each was last listed with is remembered for this run, so an installed one still joins its
//   directory record.
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { MarketplaceManifestView, PluginSourceRef } from '@shared/ipc/schema/plugins';
import type { EngineView } from './normalize';
import { DIRECTORY_MARKETPLACE } from './sources';

export type HostCall = <N extends CommandName>(name: N, input: CommandInput<N>) => Promise<CommandResult<N>>;

const KEPT_DIRECTORIES = 16;

export class EngineReads {
  private readonly views = new Map<string, Promise<EngineView | null>>();
  private readonly directorySources = new Map<string, PluginSourceRef>();
  /** Moves on every invalidation. */
  generation = 0;

  constructor(
    private readonly call: HostCall,
    private readonly log: (line: string) => void = () => {},
  ) {}

  /** The engine's reads for `cwd`: held, else read now. Null when even the engine's configuration could not be asked. */
  view(cwd: string | null): Promise<EngineView | null> {
    const key = cwd ?? '';
    let view = this.views.get(key);
    if (view === undefined) {
      view = this.read(cwd);
      for (const oldest of this.views.keys()) {
        if (this.views.size < KEPT_DIRECTORIES) break;
        this.views.delete(oldest);
      }
    } else this.views.delete(key); // the most recently asked last
    this.views.set(key, view);
    return view;
  }

  invalidate(): void {
    this.views.clear();
    this.generation += 1;
  }

  private async ask<N extends CommandName>(name: N, input: CommandInput<N>): Promise<Extract<CommandResult<N>, { ok: true }>['value'] | null> {
    const result = await this.call(name, input).catch((error: unknown) => ({ ok: false as const, error: { message: error instanceof Error ? error.message : String(error) } }));
    if (result.ok) return result.value;
    this.log(`${name} failed: ${result.error.message}`);
    return null;
  }

  private async read(cwd: string | null): Promise<EngineView | null> {
    const directory = cwd ?? (await this.ask('plugins.env', {}))?.configHome ?? null;
    if (directory === null) return null;
    const [installed, available, marketplaces, inventory] = await Promise.all([
      this.ask('plugins.list', { cwd: directory }),
      this.ask('plugins.available', { cwd: directory }),
      this.ask('marketplaces.list', { cwd: directory }),
      this.ask('customization.inventory', { cwd }),
    ]);
    const manifests = new Map<string, MarketplaceManifestView>();
    await Promise.all(
      (marketplaces?.marketplaces ?? []).map(async (m) => {
        const manifest = await this.ask('plugins.marketplaceManifest', { cwd: directory, name: m.name });
        if (manifest !== null) manifests.set(m.name, manifest);
      }),
    );
    for (const p of available?.plugins ?? []) if (p.marketplaceName === DIRECTORY_MARKETPLACE && p.source !== null) this.directorySources.set(p.name, p.source);
    return {
      cwd: directory,
      installed: installed?.plugins ?? null,
      available: available?.plugins ?? null,
      marketplaces: marketplaces?.marketplaces ?? null,
      manifests,
      servers: inventory === null ? null : inventory.servers.map((s) => s.name),
      directorySources: new Map(this.directorySources),
    };
  }
}
