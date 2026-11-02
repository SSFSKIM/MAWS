// `EndpointServices` as `mawsd` will give them (O2's seam), for the endpoint's suites before O2 lands: a scratch profile
// with its state directory (0700), the machine's ref, and a log the suite reads. Nothing here touches the owner's
// profile: every directory is a fresh temporary one.
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { DocumentsOpen } from '@shared/host/socket-protocol';
import type { MachineRef } from '@shared/machine/ref';
import { endpointLibrary, type ContentLookup } from '../../src/services/artifacts/scheme/endpoint-library';
import type { EndpointServices } from '../../src/endpoint/services';

export type FakeServices = EndpointServices & { lines: string[]; holds: Set<string>; cleanup(): void };

/** A fresh ref as `mawsd` mints one: 22 base64url characters, or `<prefix>_` and 22 under a delegation. */
export const mintRef = (prefix?: string) => `${prefix === undefined ? '' : `${prefix}_`}${randomBytes(16).toString('base64url')}` as MachineRef;

export function fakeServices(options: { ref?: MachineRef; kind?: 'unit' | 'private'; profileDir?: string } = {}): FakeServices {
  const profileDir = options.profileDir ?? fs.mkdtempSync(join(tmpdir(), 'endpoint-profile-'));
  const stateDir = join(profileDir, 'mawsd', 'endpoint');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(join(profileDir, 'mawsd'), 0o700);
  fs.chmodSync(stateDir, 0o700);
  const lines: string[] = [];
  const holds = new Set<string>();
  const none = () => () => {};
  return {
    machine: { ref: options.ref ?? mintRef(), profileDir, stateDir, kind: options.kind ?? 'private' },
    dispatch: async (_owner, name) => ({ t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: `the fake services dispatch nothing (${name})` } }),
    onEvent: none,
    onAttachment: none,
    onFrame: none,
    documents: { open: () => false, close: () => {}, frame: () => false, onClosed: none },
    onUpstream: none,
    hold(reason) {
      const id = `${reason}#${holds.size}`;
      holds.add(id);
      return () => void holds.delete(id);
    },
    interest: { report: () => {}, drop: () => {} },
    artifacts: { fetch: async () => ({ status: 404, headers: {}, body: null }) }, // P5 O5 M2
    log: (line) => void lines.push(line),
    lines,
    holds,
    cleanup: () => fs.rmSync(profileDir, { recursive: true, force: true }),
  };
}

/**
 * P5 O7 M5b: a real `artifacts.fetch` over a scratch store, in place of the fake's 404: the artifact endpoint's own library
 * (endpoint-library.ts, the scheme's handler: its headers, ranges, the bridge script in an `html` page) over an
 * `artifacts.content` that answers the files `put` here, under the profile. A path never put, or a revision but 1 or
 * `live`, is the store's not-found. `fetches` counts the requests the handler answered.
 */
export function scratchArtifacts(services: FakeServices): { put(artifactId: string, path: string, content: string | Uint8Array, kind?: ArtifactKind): void; fetches: () => number } {
  const root = join(services.machine.profileDir, 'scratch-artifacts');
  const files = new Map<string, { disk: string; kind: ArtifactKind; size: number; sha256: string }>();
  const content: ContentLookup = async ({ artifactId, revision, path }) => {
    const file = files.get(`${artifactId}\n${path ?? ''}`);
    if (file === undefined || (revision !== undefined && revision !== 1)) return { ok: false, error: { code: 'internal', message: 'not found' } };
    return { ok: true, value: { revision: 1, kind: file.kind, name: basename(path!), size: file.size, sha256: file.sha256, path: file.disk } };
  };
  let fetches = 0;
  services.artifacts = endpointLibrary(content, () => void fetches++);
  return {
    put(artifactId, path, data, kind = path.endsWith('.html') ? 'html' : 'file') {
      const disk = join(root, artifactId, ...path.split('/'));
      fs.mkdirSync(join(disk, '..'), { recursive: true });
      fs.writeFileSync(disk, data);
      const bytes = fs.readFileSync(disk);
      files.set(`${artifactId}\n${path}`, { disk, kind, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
    },
    fetches: () => fetches,
  };
}

/** P5 O7 M5b: one endpoint document channel as the fake host port holds it. */
export type FakeDocumentChannel = { open: DocumentsOpen; received: Uint8Array[]; ended: 'endpoint' | 'host' | 'reset' | 'upstream' | null };

/**
 * P5 O7 M5b: `documents` over a fake host port, in place of the fake's stub (which opens nothing): the endpoint's document
 * channels as `mawsd` relays them to the engine host (daemon.ts' `EndpointChannel`). Each open is kept with the frames the
 * endpoint wrote to it (`received`) and how it ended; `send` is a host frame on a channel, through `onFrame` as `mawsd`
 * hands it (`{owner: 'engine-host', channel, bytes}`), and `end` the host's or the link's end of one (`onClosed`).
 * `refuse` makes the next opens answer false (no engine-host link). Installed before the endpoint starts.
 */
export function fakeDocuments(services: FakeServices): {
  channels: Map<number, FakeDocumentChannel>;
  /** The channel the endpoint opened last. */
  last(): FakeDocumentChannel & { channel: number };
  send(channel: number, bytes: Uint8Array): void;
  end(channel: number, reason: 'host' | 'reset' | 'upstream'): void;
  refuse: boolean;
} {
  const channels = new Map<number, FakeDocumentChannel>();
  const frames = new Set<Parameters<FakeServices['onFrame']>[0]>();
  const closed = new Set<(channel: number, reason: 'host' | 'reset' | 'upstream') => void>();
  const others = services.onFrame;
  services.onFrame = (listener) => {
    const off = others(listener);
    frames.add(listener);
    return () => {
      off();
      frames.delete(listener);
    };
  };
  const fake = {
    channels,
    refuse: false,
    last() {
      const [channel, held] = [...channels].at(-1)!;
      return { channel, ...held };
    },
    send(channel: number, bytes: Uint8Array) {
      if (channels.get(channel)?.ended !== null) return;
      for (const listener of [...frames]) listener({ owner: 'engine-host', channel, bytes });
    },
    end(channel: number, reason: 'host' | 'reset' | 'upstream') {
      const held = channels.get(channel);
      if (held === undefined || held.ended !== null) return;
      held.ended = reason;
      for (const listener of [...closed]) listener(channel, reason);
    },
  };
  services.documents = {
    open(message) {
      if (fake.refuse || message.channel < 2 ** 31 || channels.get(message.channel)?.ended === null) return false;
      channels.set(message.channel, { open: message, received: [], ended: null });
      return true;
    },
    close(channel) {
      const held = channels.get(channel);
      if (held !== undefined && held.ended === null) held.ended = 'endpoint';
    },
    frame(channel, bytes) {
      const held = channels.get(channel);
      if (held === undefined || held.ended !== null) return false;
      held.received.push(bytes.slice());
      return true;
    },
    onClosed: (listener) => (closed.add(listener), () => void closed.delete(listener)),
  };
  return fake;
}
