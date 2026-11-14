// The endpoint seam (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, Interfaces "The endpoint seam"; its shape
// settled with O10, which owns the module behind it, src/endpoint/). `mawsd` holds `endpoint: EndpointModule | null`:
// O10's module since O10 M10 (`loadEndpointModule`), null only where a test brings none. `DaemonServices` is O10's
// `EndpointServices` field for field (P5 Decision Log 45; endpoint-seam.test.ts holds the two types equal).
//
// When it runs: as soon as `mawsd`'s own sockets are up (start step 7), so the machine is reachable from outside even
// while both hosts are parked; a remote request that needs a host wakes it through `dispatch`. It stops first in the
// exit order, awaited at most ENDPOINT_STOP_MS. No hub configuration and no tailnet address pass through it: both are the
// endpoint's own state, under `machine.stateDir`.
//
// Loaded when it is needed (O10 M10, the architect's lever (a) on acceptance 14): the module, `ws` and org-protocol are
// a chunk of their own, which an unenrolled daemon never loads. At start step 7 it is loaded and started when an
// enrollment is on disk (src/endpoint/presence.ts, a few `lstat`s); otherwise at the first `daemon.endpoint` command
// that needs it, `enroll` included, and started then with the same services before the command runs. A read-only one
// (`status`, `keys`, `policy`) over a state directory that holds nothing needs none: presence.ts answers it as the
// module would, so a check costs an unenrolled daemon nothing until its restart. Until then `status()` is the
// unenrolled module's, and the stop order is unchanged (a load in flight is awaited, and what it loaded stopped).
import type { BrowserFeed } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { DocumentsOpen } from '@shared/host/socket-protocol';
import type { ClientRef, Reader } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { NewHostEntry } from '@shared/ipc/schema/channel';
import type { MachineRef } from '@shared/machine/ref';
import { enrollmentOnDisk, unloadedAnswer, UNENROLLED_STATUS } from '../endpoint/presence';
import type { CheckoutSource } from '../endpoint/index';
import type { ProjectsSource, RegistryRead, RegistrySeam } from '@shared/machine/registry';
import type { PortTarget, RemotePortHandle } from './client-port';
import { lazyRegistry } from './projects-seam';
import type { LazySpine } from './spine-seam';

export const ENDPOINT_STOP_MS = 2_500;
// `daemon.endpoint`'s answer while there is no module (a daemon a test starts with none), `{code: 2, out:
// NO_ENDPOINT_MODULE}`, for every command; the command line (cli.ts) reads it to answer `keys` with the machine ref alone
// (P5 O2 M6).
export const NO_ENDPOINT_MODULE = 'this daemon has no endpoint module yet (P5 O10)';
// The document channels of the one upstream link are split between its two users until O3: the app's below 2^31, the
// endpoint's at 2^31 and above. A value convention inside the existing `Channel` range, enforced here and never as a
// narrowed schema bound (P5 Decision Log 42: the `documents.*` lines are frozen for major 3).
export const ENDPOINT_CHANNEL_BASE = 2 ** 31;

export interface DaemonServices {
  machine: { ref: MachineRef; profileDir: string; stateDir: string; kind: 'unit' | 'private' }; // stateDir: <profile>/mawsd/endpoint, 0700; only `unit` binds the tailnet listener by default
  // P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): `reader`, for `machine` alone, is
  // whose reader state and draft the request reads and writes ('owner', or the caller's member id), which the services
  // front writes into the handler's context (HandlerContext.reader); none is the owners'
  dispatch(owner: 'engine-host' | 'pty-host' | 'machine', name: string, input: unknown, client?: ClientRef, reader?: Reader): Promise<HostResponse>; // raw; wakes a parked host; pty.attach goes with credit: false, pty.ack and pty.checkpoint are refused; P5 O3-D M4: `machine` is the services front's table (the daemon's own namespace and the spine's commands, which load it)
  onEvent(listener: (owner: 'engine-host' | 'pty-host' | 'machine', message: { name: string; payload: unknown }) => void): () => void; // lane B events whenever they are available (onAttachment); P5 O3-D M4: the spine's events (owner `machine`) whenever it emits them; P5 O7 M3: the pty host's state (`pty.hostState`) at each transition
  // whether lane B events are available (P5 O3-D M3): with the permanent client, true from its link's streaming on, app or
  // none; with O2's recycle per attachment, an app attached to, or left, engine-host.sock (a recycle: the endpoint's
  // document channels ended)
  onAttachment(listener: (attached: boolean) => void): () => void;
  onFrame(listener: (frame: { owner: 'pty-host'; ptyId: string; offset: number; data: Uint8Array } | { owner: 'engine-host'; channel: number; bytes: Uint8Array }) => void): () => void; // pty.data frames, and document frames on the endpoint's channels only
  documents: {
    // channels >= 2^31 only
    open(message: DocumentsOpen): boolean; // false while no engine-host link is up
    close(channel: number): void;
    frame(channel: number, bytes: Uint8Array): boolean; // false while no link is up, or the channel is closed
    onClosed(listener: (channel: number, reason: 'host' | 'reset' | 'upstream') => void): () => void; // the host's documents.closed, or the link's end
  };
  onUpstream(listener: (link: { connected: boolean; generation: number }) => void): () => void; // the engine-host link; every channel's 'upstream' close comes before connected: false
  // a private mawsd's idle exit waits while one is out; the returned function releases it. P5 Decision Log 273: `standing`,
  // a connection's (an open remote channel's), which is no operation in flight to the idle collection
  hold(reason: string, standing?: boolean): () => void;
  activity?(): void; // P5 Decision Log 273: work the endpoint carries that no other hook names (a tcp forward's chunk)
  interest: { report(viewer: string, sessions: readonly AppSessionId[]): void; drop(viewer: string): void }; // a remote viewer's subscriptions join the union (OX5)
  // P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §C): a `maws-artifact:` URL's answer as
  // artifacts.sock serves it (the status, the scheme's headers, the bytes), its handler loaded at the first use; for
  // O7 M5's RL2 kind, graded by O10 as `view` on the artifact's session
  artifacts: { fetch(request: { url: string; method: 'GET' | 'HEAD'; range?: string }): Promise<{ status: number; headers: Record<string, string>; body: ReadableStream<Uint8Array> | null }> };
  // P5 O17 M6 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §G): the agent's tabs on this machine, for
  // a viewer: the inventory and its changes from the route's cache (loading nothing), and a subscription to a tab's frames
  // and, under control, its input (its chunk loaded at the first open). The remote stage hands the same object to the
  // endpoint as EndpointServices.browser (O17 M9a, R1), the two types equal again.
  browser: BrowserFeed;
  // P5 O7 M5c (O7's §T): the client port's remote targets: the endpoint registers one per channel's ref at admission, which
  // the services front's `route` consults after its own connections; the handle answers and closes it (client-port.ts)
  clientPort: { serve(ref: ClientRef, target: PortTarget): RemotePortHandle };
  engineHostLists(capability: string): boolean; // P5 O7 M8: the engine host's welcome on the link lists it now; false while no link is up
  // P5 O8 M7b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §O): the spine's project channel
  // journal, which the endpoint hands lane A's to-human entries to (sminos's sub-less RL10 host messages): `spineChannel`
  channel: { record(entry: NewHostEntry): void };
  log(line: string): void;
}

/**
 * P5 O8 M7b: `DaemonServices.channel` over the spine seam. An entry goes to the loaded spine's journal (`SpineRoot.channel`)
 * at once; while the spine is cold it is loaded for it, as the endpoint's trigger (`ensure('endpoint')`), and the entry
 * kept once it is. One that can't be kept (the spine refused or yielded, the daemon exiting, a run whose spine holds no
 * journal) is logged: sminos's resend of the last 50 brings it again at its next connection.
 */
export function spineChannel(spine: Pick<LazySpine, 'root' | 'ensure'>, log: (line: string) => void): DaemonServices['channel'] {
  const keep = (root: { channel?: { record(entry: NewHostEntry): void } }, entry: NewHostEntry) => {
    if (root.channel === undefined) return log(`[channel] a lane A entry of ${entry.project.slice(0, 64)} was not kept: the spine holds no journal`);
    root.channel.record(entry);
  };
  return {
    record(entry) {
      const root = spine.root();
      if (root !== null) return keep(root, entry);
      spine.ensure('endpoint').then(
        (loaded) => keep(loaded, entry),
        (error: unknown) => log(`[channel] a lane A entry of ${entry.project.slice(0, 64)} was not kept: ${error instanceof Error ? error.message : String(error)}`),
      );
    },
  };
}

export interface EndpointModule {
  start(services: DaemonServices): Promise<void>; // as soon as mawsd's sockets are up (start step 7)
  stop(): Promise<void>; // first in the exit order; mawsd waits up to 2.5 s
  status(): unknown; // daemon.status's endpoint.detail; no paths, addresses or key material
  enrollment(): { name: string; org: string } | null; // the enrollment held, null while unenrolled: machine.identity's project id (P5 O3-D D38)
  cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }>;
  // P5 O8 M6b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §Q): the local door, this machine's own
  // app's way to its own sessions' record acts (`act`: the three record.* actions alone, each's step-up verified every time,
  // its member from its device's one head entry, then authorized as a channel's act) and their policy read (`call`:
  // record.policy alone, as the machine's owners'), served on machine.sock as `endpoint.local.act` and `endpoint.local.call`.
  // P5 O8 M4b: `act` takes `endpoint.grant` too, on the grant's own signature, and `call` `endpoint.grants`, which
  // machine.sock serves as `endpoint.local.grants`.
  // `act` answers the outcome as RL4's `done` carries it, or `{state: 'refused', reason}`; `call` as RL3's `result` does.
  // Absent from a module that has none (a test's); the daemon then answers `unavailable`
  local?: {
    act(action: unknown): Promise<{ state: string } & Record<string, unknown>>;
    call(name: string, input: unknown): Promise<{ ok: true; output: unknown } | { ok: false; code: string }>;
  };
  // The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §H): what the machine's services
  // ask of the endpoint, handed to the spine's index at each load. Absent from a module that has none (a test's): the index
  // then holds `NO_REGISTRY`
  registry?: RegistrySeam;
  // The project registry's M12 (Interfaces §H's RegistryRead, §K): the org's projects as the endpoint holds them, for
  // machine.sock's `projects.registry`. Absent from a module that has none: the daemon answers an unenrolled machine
  registryRead?: RegistryRead;
  // The UX wave (docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M2): whether the machine's ceiling, as
  // its policy stands when asked, refuses a session started from another machine in `mode`, which the daemon hands the
  // session service. Absent from a module that has none: every mode is refused
  aboveCeiling?(mode: string): boolean;
}

// O10's endpoint module (P5 O10 M10), one for each daemon, loaded when it is needed; `build` is the daemon's build id,
// which RL1's hello and RL2's h2 name. Its chunk is emitted beside mawsd.js by the same build (the bundle guard admits
// that load and no other). `projects` is MAWS's own projects as checkouts the module knows (P5 O3-D M4, Interfaces §E):
// the source authorization reads beside RL10's presences. P5 O2 (the bundle swap): `refused`, asked at each load, names
// why the chunk on disk is no longer this daemon's build, and the load fails with it.
export function loadEndpointModule(build: string, extras: EndpointExtras = {}, refused: () => string | null = () => null): EndpointModule {
  return new LazyEndpoint(build, () => {
    const why = refused();
    return why === null ? import('../endpoint/index') : Promise.reject(new Error(why));
  }, extras);
}

/**
 * What the daemon injects into the module besides its services: MAWS's own projects as checkouts, and (the project
 * registry) what the endpoint reads of the index.
 */
export type EndpointExtras = { projects?: CheckoutSource; projectsSource?: ProjectsSource };
export type { CheckoutSource };

type Loaded = { createEndpoint(options: { build?: string } & EndpointExtras): EndpointModule };

/** The seam's module until O10's is needed, then O10's; `load` brings the module's chunk (a test's stand-in). */
export class LazyEndpoint implements EndpointModule {
  readonly #build: string;
  readonly #load: () => Promise<Loaded>;
  readonly #extras: EndpointExtras;
  #services: DaemonServices | null = null;
  #module: EndpointModule | null = null;
  #loading: Promise<EndpointModule | null> | null = null;
  #stopped = false;
  /**
   * The project registry's seam (Interfaces §H), the module's once it is loaded (projects-seam.ts): unloaded, nothing is
   * enrolled here, so no stored statement is possible.
   */
  readonly registry = lazyRegistry();

  /** The project registry's M12: the loaded module's read of the org's projects; none while nothing is loaded. */
  get registryRead(): RegistryRead | undefined {
    return this.#module?.registryRead;
  }

  /**
   * The UX wave (U9, M2): the loaded module's ceiling, read at each ask. Unloaded, or from a module that has none, every
   * mode is above it: no act from another machine reaches the services while no endpoint is loaded.
   */
  aboveCeiling(mode: string): boolean {
    return this.#module?.aboveCeiling?.(mode) ?? true;
  }

  constructor(build: string, load: () => Promise<Loaded>, extras: EndpointExtras = {}) {
    this.#build = build;
    this.#load = load;
    this.#extras = extras;
  }

  async start(services: DaemonServices): Promise<void> {
    this.#services = services;
    if (enrollmentOnDisk(services.machine.stateDir)) await this.#ensure(true);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    const module = this.#module ?? (await this.#loading?.catch(() => null)) ?? null;
    await module?.stop();
  }

  status(): unknown {
    return this.#module === null ? UNENROLLED_STATUS : this.#module.status();
  }

  // Unloaded, there is none: an enrollment on disk loads the module at the daemon's start (an enrollment begun later
  // loads it at its command), and its start reads the state that `enrollment()` then reports.
  enrollment(): { name: string; org: string } | null {
    return this.#module === null ? null : this.#module.enrollment();
  }

  /**
   * P5 O8 M6b: the module's local door once it is loaded (a load in flight awaited). Unloaded, nothing is enrolled here
   * (an enrollment on disk loads the module at the daemon's start), so there is no head to authorize an act against:
   * `unavailable`, as from a module with no door.
   */
  readonly local: NonNullable<EndpointModule['local']> = {
    act: async (action) => {
      const module = await this.#loaded();
      return module?.local === undefined ? { state: 'refused', reason: 'unavailable' } : module.local.act(action);
    },
    call: async (name, input) => {
      const module = await this.#loaded();
      return module?.local === undefined ? { ok: false, code: 'unavailable' } : module.local.call(name, input);
    },
  };

  /** The module as loaded now, or by the load in flight; null when none is or will be (a failed load included). */
  async #loaded(): Promise<EndpointModule | null> {
    if (this.#stopped) return null;
    return this.#module ?? (await this.#loading?.catch(() => null)) ?? null;
  }

  async cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }> {
    if (this.#services === null) return { code: 3, out: 'the endpoint has not started' };
    if (this.#stopped) return { code: 3, out: 'the endpoint has stopped' };
    // Unloaded and not loading, a read-only command may be answered without the module; once a load is under way, the
    // module answers.
    if (this.#module === null && this.#loading === null) {
      const answer = unloadedAnswer(this.#services.machine, command, args);
      if (answer !== null) return answer;
    }
    let module: EndpointModule | null;
    try {
      module = await this.#ensure(false);
    } catch (error) {
      return { code: 1, out: `the endpoint module could not be loaded (${error instanceof Error ? error.message : String(error)}); \`mawsd restart\` loads this build's` };
    }
    if (module === null) return { code: 3, out: 'the endpoint has stopped' };
    return module.cli(command, args, secret);
  }

  /**
   * The module, loaded and started once (one load at a time; a failed load is tried again by the next caller). A start
   * that throws is logged and leaves the module loaded, as the daemon's start step 7 does. Null when the daemon stopped
   * before the module started: it is then never started, so `stop` has nothing to stop.
   */
  #ensure(atStart: boolean): Promise<EndpointModule | null> {
    if (this.#module !== null) return Promise.resolve(this.#module);
    const services = this.#services!;
    this.#loading ??= (async () => {
      let loaded: Loaded;
      try {
        loaded = await this.#load();
      } catch (error) {
        services.log(`the endpoint module could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      if (this.#stopped) return null;
      const module = loaded.createEndpoint({ build: this.#build, ...this.#extras });
      services.log(atStart ? 'loading the endpoint: an enrollment is on disk' : 'loading the endpoint for its first command');
      try {
        await module.start(services);
      } catch (error) {
        services.log(`the endpoint module failed to start: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.#module = module;
      this.registry.loaded(module.registry);
      return module;
    })().finally(() => (this.#loading = null));
    return this.#loading.then((module) => (this.#stopped ? null : module));
  }
}
