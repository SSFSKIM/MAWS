// The endpoint's seam with `mawsd` (docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md, Interfaces §F; O2's Interfaces,
// "The endpoint seam"). `EndpointServices` is O2's `DaemonServices` field for field, so the module builds and is tested
// before `mawsd` exists (test/endpoint/fake-services.ts); M10 binds it to O2's seam and proves the two types equal.
import type { BrowserFeed } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { DocumentsOpen } from '@shared/host/socket-protocol';
import type { ClientRef, Reader } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { NewHostEntry } from '@shared/ipc/schema/channel';
import type { MachineRef } from '@shared/machine/ref';
import type { RegistryRead, RegistrySeam } from '@shared/machine/registry';
import type { PortTarget, RemotePortHandle } from '../mawsd/client-port';

export interface EndpointServices {
  /** stateDir: <profile>/mawsd/endpoint, 0700; only `unit` binds the tailnet listener by default. */
  machine: { ref: MachineRef; profileDir: string; stateDir: string; kind: 'unit' | 'private' };
  /**
   * Raw; wakes a parked host; pty.attach goes with credit: false, pty.ack and pty.checkpoint are refused. P5 O3-D M4:
   * `machine` is `mawsd`'s services front (the daemon's own namespace and the spine's commands, which load the spine).
   * P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): `reader`, for `machine` alone,
   * whose reading (pinned, last seen, unread) and draft the request reads and writes (readers.ts), which the services
   * front writes into the handler's context; none is the owners'.
   */
  dispatch(owner: 'engine-host' | 'pty-host' | 'machine', name: string, input: unknown, client?: ClientRef, reader?: Reader): Promise<HostResponse>;
  /**
   * Lane B events whenever they are available (`onAttachment`); P5 O3-D M4: the spine's events (owner `machine`) whenever
   * it emits them; P5 O7 M3: the pty host's state (`pty.hostState`, owner `pty-host`, a HostState) at each transition.
   */
  onEvent(listener: (owner: 'engine-host' | 'pty-host' | 'machine', message: { name: string; payload: unknown }) => void): () => void;
  /**
   * Whether lane B events are available (P5 O3-D M3): with `mawsd`'s permanent client, true from its link's streaming on,
   * app or none; with O2's recycle per attachment, an app attached to, or left, engine-host.sock (a recycle: the
   * endpoint's document channels ended).
   */
  onAttachment(listener: (attached: boolean) => void): () => void;
  /** pty.data frames, and document frames on the endpoint's channels only. */
  onFrame(
    listener: (frame: { owner: 'pty-host'; ptyId: string; offset: number; data: Uint8Array } | { owner: 'engine-host'; channel: number; bytes: Uint8Array }) => void,
  ): () => void;
  /** Channels >= 2^31 only. */
  documents: {
    /** false while no engine-host link is up. */
    open(message: DocumentsOpen): boolean;
    close(channel: number): void;
    /** false while no link is up, or the channel is closed. */
    frame(channel: number, bytes: Uint8Array): boolean;
    /** The host's documents.closed, or the link's end. */
    onClosed(listener: (channel: number, reason: 'host' | 'reset' | 'upstream') => void): () => void;
  };
  /** The engine-host link; every channel's 'upstream' close comes before connected: false. */
  onUpstream(listener: (link: { connected: boolean; generation: number }) => void): () => void;
  /** A private mawsd's idle exit waits while one is out; the returned function releases it. */
  hold(reason: string, standing?: boolean): () => void; // P5 Decision Log 273: `standing`, DaemonServices' (a connection's, no operation)
  activity?(): void; // P5 Decision Log 273: DaemonServices'; none, a fake's
  /** A remote viewer's subscriptions join the union (OX5). */
  interest: { report(viewer: string, sessions: readonly AppSessionId[]): void; drop(viewer: string): void };
  /**
   * P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §C): a `maws-artifact:` URL's answer as
   * `mawsd`'s artifacts.sock serves it (the status, the scheme's headers, the bytes); O7 M5 carries it over RL2, graded
   * `view` on the artifact's session.
   */
  artifacts: { fetch(request: { url: string; method: 'GET' | 'HEAD'; range?: string }): Promise<{ status: number; headers: Record<string, string>; body: ReadableStream<Uint8Array> | null }> };
  /**
   * P5 O7 M5c (O7's §T): the client port's remote targets. The endpoint registers a channel's target under its ref at
   * admission (client-port.ts); `mawsd`'s services front routes a request for that ref to it after its own connections,
   * and the handle's `answer` settles through the port's own `answer` with the target as `from`, `close` at the channel's end.
   */
  clientPort: { serve(ref: ClientRef, target: PortTarget): RemotePortHandle };
  /**
   * P5 O17 M9a (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §G, §K; R1): the agent's tabs on this
   * machine, `mawsd`'s feed seam (`DaemonServices.browser`, the same object): a session's inventory and its changes, read
   * from the route's cache, and a viewer's subscription to one tab, opened only on a tab the session's tab engine holds.
   * The endpoint opens a subscription under a decision that stands (`view`, or `approve` with a done grant for `control`),
   * never on a remote boolean, and maps its words to RL2's (browser-words.ts).
   */
  browser: BrowserFeed;
  /**
   * P5 O7 M8: whether the engine host's welcome on `mawsd`'s link lists `capability` now; false while no link is up.
   * The endpoint sends a remote device a command whose meaning a newer host changed only to a host that lists it.
   */
  engineHostLists(capability: string): boolean;
  /**
   * P5 O8 M7b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §O): the project channel's journal in
   * the spine, which lane A's to-human entries are handed to as sminos's sub-less RL10 host messages arrive (rl10/link.ts),
   * the spine loaded for one if it is cold. Its history and its changes reach the endpoint as every spine read and event
   * does: `dispatch('machine', 'channel.history', …)` and `onEvent`'s `channel.changed`.
   */
  channel: { record(entry: NewHostEntry): void };
  log(line: string): void;
}

export interface EndpointModule {
  /** As soon as mawsd's sockets are up (O2 M5's start step 7). */
  start(services: EndpointServices): Promise<void>;
  /** First in the exit order; mawsd waits up to 2.5 s. */
  stop(): Promise<void>;
  /** daemon.status's endpoint.detail; no paths, addresses or key material. */
  status(): unknown;
  /** The enrollment held (its name and org), null while unenrolled: `machine.identity`'s project id (P5 O3-D D38). */
  enrollment(): { name: string; org: string } | null;
  cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }>;
  /**
   * P5 O8 M6b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §Q): the local door, this machine's
   * own app's way to its own sessions' record acts and their policy read (local-door.ts), which `mawsd` serves as
   * `endpoint.local.act` and `endpoint.local.call`. `act` answers the act's outcome as `done` carries it, or `{state:
   * 'refused', reason}`; `call` answers as RL3's `result` does. Absent from a module that has none (a test's). P5 O8 M4b:
   * `act` takes `endpoint.grant` too, on the grant's own signature, and `call` `endpoint.grants` (mawsd's
   * `endpoint.local.grants`).
   */
  local?: {
    act(action: unknown): Promise<{ state: string } & Record<string, unknown>>;
    call(name: string, input: unknown): Promise<{ ok: true; output: unknown } | { ok: false; code: string }>;
  };
  /**
   * The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §H): what the machine's
   * services ask of the endpoint, which `mawsd` hands the spine's index. Absent from a module that has none (a test's):
   * the index then holds `NO_REGISTRY`.
   */
  registry?: RegistrySeam;
  /**
   * The project registry's M12 (Interfaces §H's `RegistryRead`, §K): the org's projects as this endpoint holds them, for
   * `maws project list`, `show` and `--into` (machine.sock's `projects.registry`). Absent from a module that has none.
   */
  registryRead?: RegistryRead;
  /**
   * The UX wave (U9, M2): whether the machine's ceiling, as its policy stands when asked, refuses a session started from
   * another machine in `mode`, which `mawsd` hands the session service: a fork from another machine is held to it where
   * it is allocated. Absent from a module that has none: every mode is refused.
   */
  aboveCeiling?(mode: string): boolean;
}

/**
 * `dispatch` on behalf of `client`, a channel's ref (P5 O7 M2), its `machine` requests read and written as `reader`'s
 * (P5 O8 M6a: the decision's, readers.ts); `dispatch` itself with neither.
 */
export function dispatchAs(dispatch: EndpointServices['dispatch'], client: ClientRef | undefined, reader?: Reader): EndpointServices['dispatch'] {
  if (client === undefined && reader === undefined) return dispatch;
  return (owner, name, input) => (owner === 'machine' && reader !== undefined ? dispatch(owner, name, input, client, reader) : dispatch(owner, name, input, client));
}
