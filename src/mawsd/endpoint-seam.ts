// The endpoint seam (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, Interfaces "The endpoint seam"; its shape
// settled with O10, which owns the module behind it, src/endpoint/). `mawsd` holds `endpoint: EndpointModule | null`:
// O10's module since O10 M10 (`loadEndpointModule`), null only where a test brings none. `DaemonServices` is O10's
// `EndpointServices` field for field (P5 Decision Log 45; endpoint-seam.test.ts holds the two types equal).
//
// When it runs: as soon as `mawsd`'s own sockets are up (start step 7), so the machine is reachable from outside even
// while both hosts are parked; a remote request that needs a host wakes it through `dispatch`. It stops first in the
// exit order, awaited at most ENDPOINT_STOP_MS. No hub configuration and no tailnet address pass through it: both are the
// endpoint's own state, under `machine.stateDir`.
import type { AppSessionId } from '@shared/graph/ids';
import type { DocumentsOpen } from '@shared/host/socket-protocol';
import type { ClientRef } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { MachineRef } from '@shared/machine/ref';
import { createEndpoint } from '../endpoint/index';

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
  dispatch(owner: 'engine-host' | 'pty-host' | 'machine', name: string, input: unknown, client?: ClientRef): Promise<HostResponse>; // raw; wakes a parked host; pty.attach goes with credit: false, pty.ack and pty.checkpoint are refused
  onEvent(listener: (owner: 'engine-host' | 'pty-host', message: { name: string; payload: unknown }) => void): () => void; // lane B events only while an app is attached, until O3
  onAttachment(listener: (attached: boolean) => void): () => void; // an app attached to, or left, engine-host.sock (a recycle: the endpoint's document channels ended)
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
  log(line: string): void;
}

export interface EndpointModule {
  start(services: DaemonServices): Promise<void>; // as soon as mawsd's sockets are up (start step 7)
  stop(): Promise<void>; // first in the exit order; mawsd waits up to 2.5 s
  status(): unknown; // daemon.status's endpoint.detail; no paths, addresses or key material
  cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }>;
}

// O10's endpoint module (P5 O10 M10), one for each daemon, unstarted; `build` is the daemon's build id, which RL1's hello
// and RL2's h2 name. It is bundled into mawsd.js with its `ws` (the bundle guard bars a dynamic import), and an
// unenrolled one starts no hub link, binds no listener and serves no RL10 socket.
export function loadEndpointModule(build: string): EndpointModule {
  return createEndpoint({ build });
}
