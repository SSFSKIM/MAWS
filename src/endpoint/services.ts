// The endpoint's seam with `mawsd` (docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md, Interfaces §F; O2's Interfaces,
// "The endpoint seam"). `EndpointServices` is O2's `DaemonServices` field for field, so the module builds and is tested
// before `mawsd` exists (test/endpoint/fake-services.ts); M10 binds it to O2's seam and proves the two types equal.
import type { AppSessionId } from '@shared/graph/ids';
import type { DocumentsOpen } from '@shared/host/socket-protocol';
import type { ClientRef } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { MachineRef } from '@shared/machine/ref';

export interface EndpointServices {
  /** stateDir: <profile>/mawsd/endpoint, 0700; only `unit` binds the tailnet listener by default. */
  machine: { ref: MachineRef; profileDir: string; stateDir: string; kind: 'unit' | 'private' };
  /**
   * Raw; wakes a parked host; pty.attach goes with credit: false, pty.ack and pty.checkpoint are refused. P5 O3-D M4:
   * `machine` is `mawsd`'s services front (the daemon's own namespace and the spine's commands, which load the spine).
   */
  dispatch(owner: 'engine-host' | 'pty-host' | 'machine', name: string, input: unknown, client?: ClientRef): Promise<HostResponse>;
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
  hold(reason: string): () => void;
  /** A remote viewer's subscriptions join the union (OX5). */
  interest: { report(viewer: string, sessions: readonly AppSessionId[]): void; drop(viewer: string): void };
  /**
   * P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §C): a `maws-artifact:` URL's answer as
   * `mawsd`'s artifacts.sock serves it (the status, the scheme's headers, the bytes); O7 M5 carries it over RL2, graded
   * `view` on the artifact's session.
   */
  artifacts: { fetch(request: { url: string; method: 'GET' | 'HEAD'; range?: string }): Promise<{ status: number; headers: Record<string, string>; body: ReadableStream<Uint8Array> | null }> };
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
}

/** `dispatch` on behalf of `client`, a channel's ref (P5 O7 M2); `dispatch` itself without one. */
export function dispatchAs(dispatch: EndpointServices['dispatch'], client: ClientRef | undefined): EndpointServices['dispatch'] {
  return client === undefined ? dispatch : (owner, name, input) => dispatch(owner, name, input, client);
}
