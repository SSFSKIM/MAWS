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
import type { AppSessionId } from '@shared/graph/ids';
import type { DocumentsOpen } from '@shared/host/socket-protocol';
import type { ClientRef } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { MachineRef } from '@shared/machine/ref';
import { enrollmentOnDisk, unloadedAnswer, UNENROLLED_STATUS } from '../endpoint/presence';
import type { CheckoutSource } from '../endpoint/index';

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
  dispatch(owner: 'engine-host' | 'pty-host' | 'machine', name: string, input: unknown, client?: ClientRef): Promise<HostResponse>; // raw; wakes a parked host; pty.attach goes with credit: false, pty.ack and pty.checkpoint are refused; P5 O3-D M4: `machine` is the services front's table (the daemon's own namespace and the spine's commands, which load it)
  onEvent(listener: (owner: 'engine-host' | 'pty-host' | 'machine', message: { name: string; payload: unknown }) => void): () => void; // lane B events whenever they are available (onAttachment); P5 O3-D M4: the spine's events (owner `machine`) whenever it emits them
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
  hold(reason: string): () => void; // a private mawsd's idle exit waits while one is out; the returned function releases it
  interest: { report(viewer: string, sessions: readonly AppSessionId[]): void; drop(viewer: string): void }; // a remote viewer's subscriptions join the union (OX5)
  // P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §C): a `maws-artifact:` URL's answer as
  // artifacts.sock serves it (the status, the scheme's headers, the bytes), its handler loaded at the first use; for
  // O7 M5's RL2 kind, graded by O10 as `view` on the artifact's session
  artifacts: { fetch(request: { url: string; method: 'GET' | 'HEAD'; range?: string }): Promise<{ status: number; headers: Record<string, string>; body: ReadableStream<Uint8Array> | null }> };
  log(line: string): void;
}

export interface EndpointModule {
  start(services: DaemonServices): Promise<void>; // as soon as mawsd's sockets are up (start step 7)
  stop(): Promise<void>; // first in the exit order; mawsd waits up to 2.5 s
  status(): unknown; // daemon.status's endpoint.detail; no paths, addresses or key material
  enrollment(): { name: string; org: string } | null; // the enrollment held, null while unenrolled: machine.identity's project id (P5 O3-D D38)
  cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }>;
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

/** What the daemon injects into the module besides its services. */
export type EndpointExtras = { projects?: CheckoutSource };
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
      return module;
    })().finally(() => (this.#loading = null));
    return this.#loading.then((module) => (this.#stopped ? null : module));
  }
}
