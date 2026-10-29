// The second-profile stand-in (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The stand-in";
// P5 Decision Log 21's conditions). O3 DELETES THIS FILE, with serve-gate.ts: profile B's private `mawsd` (O2's
// per-profile daemon) then serves the same link surface from its own directory, and the e2e scene starts that daemon
// instead of a second app. The connection manager, the socket link, the link surface and known machines stay.
//
// Until O3 a profile's main is its own machine services (P5 §2, two composition roots), so a second profile's app started
// with MAWS_MACHINE_SERVE=1, in a build that is not packaged (serve-gate.ts, checked by the composition root), serves them
// to another profile's app: every link-surface command through its router's local path, every link event through an
// `onEmitted` tap, over a same-uid socket on protocol 3.
//
// - `<userData>/machine-serve/`, created or corrected to 0700 after an `lstat` that refuses a symlink or another owner,
//   holds `machine.token` (32 random bytes as hex, 0600, written through a temporary file and a rename) and
//   `machine.sock` (0600 after `listen`).
// - Every accepted connection is checked before the server reads a byte (O1's socket server's `admit`): its peer's uid,
//   from the peer-auth addon (src/main/browser/cua/peer.ts), must be this process's; with no addon every peer is refused,
//   logged once (fail closed).
// - A command's answer is the router's `CommandResult` unwrapped for the host runtime: its value, or a thrown
//   HostCommandError carrying the IpcError whole (O1 M5: one typed failure for both roots).
// - `exit` is ignored: a client never stops this machine. One client at a time, as O1's server serves (RL3 is O3's).
// - The welcome's counts are this profile's supervisor's (its latest `host.supervisorStatus`), 0 when its host is a
//   utility process.
// - A machine-bound command that reaches this app's client port shows its dialog or notice in this app, since O1's
//   Electron port draws unparented UI for a ref with no page (O3's mawsd answers `noClient`). Accepted: the stand-in runs
//   only in tests and dev runs, and no O6 surface calls such a command for another machine.
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { createHostRuntime, HostCommandError, type HostEmit } from '@shared/host/runtime';
import { serveSocketClients } from '@shared/host/socket-server';
import { PEER_CAPABILITIES, SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import type { REGISTRY, WireRegistry } from '@shared/ipc/registry';
import type { CommandName, EventName } from '@shared/ipc/schema';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import type { MachineRef } from '@shared/machine/ref';
import { socketFd, type PeerAddon } from '../browser/cua/peer';
import { onEmitted } from '../ipc/events';
import type { Router } from '../ipc/router';
import { LINK_REGISTRY } from './link-surface';
import { MACHINE_SOCKET, MACHINE_TOKEN } from './socket-link';

export const SERVE_DIR = 'machine-serve';
const SOCKET_PATH_MAX_BYTES = 103; // sun_path on macOS, less its terminator

export interface StandInDeps {
  userData: string;
  router: Pick<Router<typeof REGISTRY>, 'dispatchLocal'>;
  localRef: MachineRef;
  peer: PeerAddon | null;
  log(line: string): void;
  build: string; // this app's build, said in the welcome
  registry?: WireRegistry; // the link surface unless a test passes a fixture
}

export interface StandIn {
  ready: Promise<void>; // listening; rejects when the socket could not be made
  close(): Promise<void>;
}

// Throws, naming the path, when the serve directory is a symlink, not a directory, or another user's.
export function serveMachineStandIn(deps: StandInDeps): StandIn {
  const { userData, router, localRef, peer, log } = deps;
  const registry = deps.registry ?? LINK_REGISTRY;
  const dir = join(userData, SERVE_DIR);
  const socketPath = join(dir, MACHINE_SOCKET);
  if (Buffer.byteLength(socketPath, 'utf8') > SOCKET_PATH_MAX_BYTES) throw new Error(`${socketPath} is longer than a Unix socket path may be`);
  privateServeDirectory(dir);
  const token = writeToken(dir);
  fs.rmSync(socketPath, { force: true }); // a socket left by an earlier run of this profile, which the profile lock says is gone

  let emit: HostEmit<WireRegistry> | null = null;
  const runtime = createHostRuntime(
    (on, kept) => {
      emit = kept;
      for (const name of Object.keys(registry.commands)) {
        on(name, async (input, ctx) => {
          const result = await router.dispatchLocal(name as CommandName, input, { client: ctx.client, target: localRef });
          if (result.ok) return result.value;
          throw new HostCommandError(result.error);
        });
      }
    },
    { registry },
  );
  const taps = (Object.keys(registry.events) as EventName[]).map((name) => onEmitted(name, (payload) => void emit?.(name, payload)));
  let counts = { liveSessions: 0, rows: 0 };
  taps.push(onEmitted('host.supervisorStatus', ({ liveSessions, rows }) => void (counts = { liveSessions, rows })));

  let refusedForNoAddon = false;
  const admit = (socket: Socket): boolean => {
    if (!peer) {
      if (!refusedForNoAddon) log('refusing every peer: the peer-auth addon is unavailable, so no peer can be shown to be this user');
      refusedForNoAddon = true;
      return false;
    }
    const fd = socketFd(socket);
    try {
      const { uid } = fd === null ? { uid: null } : peer.peer(fd);
      if (uid === process.getuid?.()) return true;
      log(`refused a peer of uid ${uid ?? 'unknown'}`);
    } catch (error) {
      log(`refused a peer whose credentials could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  };

  const startedAt = new Date().toISOString();
  const server = createServer();
  server.on('error', (error) => log(`server error: ${error.message}`));
  const clients = serveSocketClients(server, {
    runtime,
    identity: () => ({ protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, buildId: deps.build, capabilities: PEER_CAPABILITIES.daemon /* P5 O3-D: as mawsd's machine.sock */, wire: wireFingerprint(), pid: process.pid, startedAt }),
    counts: () => counts,
    token: () => token,
    onExit: (when) => log(`ignored exit ${when}: a client never stops this machine`),
    log,
    admit,
  });
  const ready = new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      fs.chmodSync(socketPath, 0o600);
      log(`serving machine ${localRef} on ${socketPath} (a stand-in, until O3's mawsd)`);
      resolve();
    });
  });
  ready.catch((error: unknown) => log(`cannot serve on ${socketPath}: ${error instanceof Error ? error.message : String(error)}`));

  return {
    ready,
    async close() {
      for (const off of taps) off();
      clients.closeClient();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function privateServeDirectory(dir: string): void {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (stat === null) {
    fs.mkdirSync(dir, { mode: 0o700 });
  } else {
    if (stat.isSymbolicLink()) throw new Error(`${dir} is a symlink; the stand-in serves from no directory it does not own`);
    if (!stat.isDirectory()) throw new Error(`${dir} is not a directory`);
    const uid = process.getuid?.();
    if (uid !== undefined && stat.uid !== uid) throw new Error(`${dir} is owned by uid ${stat.uid}, not this process's ${uid}`);
  }
  fs.chmodSync(dir, 0o700); // a pre-existing directory is corrected too
}

// 32 random bytes as hex, written through a temporary file and a rename, as the supervisor writes its token
// (src/engine-host/detached.ts), so a reader never sees half a token.
function writeToken(dir: string): string {
  const token = randomBytes(32).toString('hex');
  const path = join(dir, MACHINE_TOKEN);
  const temporary = `${path}.${process.pid}`;
  fs.writeFileSync(temporary, token, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, path);
  return token;
}
