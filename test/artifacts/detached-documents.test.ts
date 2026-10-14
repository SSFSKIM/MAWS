// P3-A M5 (docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 34; P3-0's items routed to A): a window's
// replica of a document a detached host serves, through every layer main and the supervisor run: the renderer's
// ArtifactHost and its provider, main's `artifacts.open` and relay, the host supervisor's detached transport over a real
// Unix socket and SocketPort, the socket server's channel table, the runtime's document handler, the engine host's
// artifacts surface and document service over a real store. Only Electron's MessageChannelMain is stood in for, by
// Node's MessageChannel.
//
// It proves the real SocketPort carries the document frames both ways, that the 8 MB high-water reset (lowered here, and
// forced by corking the host's socket so its writes queue) sends the window's replica down its one reopen path with
// nothing acknowledged lost, that a dropped connection does the same, and that the bytes of the artifact surface cross
// the JSON line as bytes.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/nonexistent' }, utilityProcess: {}, MessageChannelMain: class {}, BrowserWindow: {}, ipcMain: {} }));

import type { DocumentHandle } from '@artifacts/host';
import type { PortLike } from '@artifacts/provider/port';
import type { Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { CommandInput, CommandName, CommandResult, HostState, MawsBridge } from '@shared/ipc/schema';
import { openDocuments, type Documents } from '../../src/engine-host/documents';
import { registerArtifacts } from '../../src/engine-host/documents/register';
import { openDocument, type DocOpenDeps } from '../../src/main/artifacts/open';
import { createHostSupervisor, type HostSupervisor, type HostSpec } from '../../src/main/hosts/supervisor';
import type { HostOwner } from '../../src/main/ipc/router';
import { CommandFailure } from '../../src/main/ipc/router';
import { createArtifactHost, type DocPorts } from '../../src/renderer/src/artifacts/host';
import { fakeProfile, FakeProcesses, FakeSupervisor, type FakeProfile } from '../support/fake-supervisor';

const AGENT: Actor = { kind: 'session', appSessionId: 'app-agent' as never };
const HIGH_WATER = 64 * 1024;
const until = (check: () => boolean, timeout = 10_000) => vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 10 });

let dir: string;
let documents: Documents;
let profile: FakeProfile;
let fake: FakeSupervisor;
let supervisor: HostSupervisor;
let closeSurface: () => void = () => {};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-detached-docs-'));
  documents = openDocuments(dir, () => {})!;
  profile = fakeProfile('maws-dd-');
  const processes = new FakeProcesses();
  fake = await new FakeSupervisor(profile, processes, {
    pid: processes.newPid(),
    docHighWater: HIGH_WATER,
    register: (on, emit, client) => {
      closeSurface = registerArtifacts(on, emit, client, { documents, env: { MAWS_E2E: '1' } }).close;
    },
  }).start();
  supervisor = createHostSupervisor({
    hosts: { 'engine-host': { modulePath: profile.modulePath, serviceName: 'maws-engine-host', transport: 'detached' } } as Record<HostOwner, HostSpec>,
    emit: () => true,
    restartBackoffMs: [20, 40, 60],
    detached: {
      userData: () => profile.userData,
      packaged: () => false,
      env: () => ({}),
      spawn: () => {
        throw new Error('this test starts no supervisor');
      },
      ...processes.deps,
      timing: { connectTimeoutMs: 200, helloTimeoutMs: 300, startTimeoutMs: 3_000, pidPollMs: 20 },
      log: () => {},
    },
  });
  await supervisor.start();
});

afterEach(async () => {
  supervisor.stop();
  await fake.die();
  closeSurface();
  documents.close();
  profile.dispose();
  rmSync(dir, { recursive: true, force: true });
});

// Main's end of a window's channel, with MessagePortMain's shape (Electron delivers `{data}` events and a `close`).
function mainEnd(port: MessagePort) {
  return {
    postMessage: (message: unknown) => port.postMessage(message),
    on: (event: 'message' | 'close', listener: (event?: unknown) => void) => (event === 'message' ? port.on('message', (data) => listener({ data })) : port.on('close', () => listener())),
    start: () => port.start(),
    close: () => port.close(),
  };
}

// One window: its renderer's ArtifactHost, reaching main's real `artifacts.open` and the host through the supervisor's
// dispatch, its document ports posted by main as the preload would hand them to the page.
function window(id = 1) {
  const posted = new Map<number, PortLike>();
  const waiting = new Map<number, (port: PortLike) => void>();
  const ports: DocPorts = {
    take: (channel) =>
      new Promise((resolve) => {
        const port = posted.get(channel);
        if (port) {
          posted.delete(channel);
          resolve(port);
        } else waiting.set(channel, resolve);
      }),
  };
  const sender = {
    id,
    isDestroyed: () => false,
    on: () => {},
    once: () => {},
    postMessage: (_name: string, { channel }: { channel: number }, [port]: PortLike[]) => {
      const waiter = waiting.get(channel);
      if (!waiter) return void posted.set(channel, port);
      waiting.delete(channel);
      waiter(port);
    },
  };
  const deps: DocOpenDeps = {
    dispatch: supervisor.dispatch,
    postDocPort: supervisor.postDocPort,
    closeDocPorts: supervisor.closeDocPorts,
    channel: () => {
      const { port1, port2 } = new MessageChannel();
      return { port1: mainEnd(port1), port2 } as never;
    },
  };
  const opens: number[] = [];
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async (name: CommandName, input: unknown) => {
      if (name !== 'artifacts.open') return supervisor.dispatch('engine-host', name, input as never);
      opens.push(Date.now());
      try {
        return { ok: true, value: await openDocument(deps, (input as CommandInput<'artifacts.open'>).artifactId, sender as never) };
      } catch (error) {
        if (error instanceof CommandFailure) return { ok: false, error: error.error };
        throw error;
      }
    }) as MawsBridge['invoke'],
    on: ((name: string, listener: (state: HostState) => void) => (name === 'engine.hostState' ? supervisor.onState('engine-host', listener) : () => {})) as MawsBridge['on'],
  };
  return { host: createArtifactHost({ ipc, ports, log: () => {} }), opens };
}

const ok = async <N extends CommandName>(name: N, input: CommandInput<N>) => {
  const result = (await supervisor.dispatch('engine-host', name, input)) as CommandResult<N>;
  if (!result.ok) throw new Error(`${name}: ${result.error.code} ${result.error.message}`);
  return result.value;
};
const textOf = (doc: Doc) => doc.get('root').toArray().filter((part): part is string => typeof part === 'string').join('');
const hostText = (artifactId: string) => textOf(documents.service.loaded(artifactId)!);
const type = (handle: DocumentHandle, token: string) => {
  const root = (handle.doc as Doc).get('root');
  root.insert(textOf(handle.doc as Doc).length, token);
};
const settled = (handle: DocumentHandle) => handle.state().phase === 'live' && handle.state().synced && handle.state().unsaved === 0;

describe('a document served by a detached host, relayed by main (P3-A M5)', () => {
  it('syncs over the socket’s document frames, and a high-water reset re-opens the window’s replica with nothing acknowledged lost', async () => {
    const { artifact } = await ok('artifacts.create', { kind: 'document', title: 'Relayed' });
    await ok('artifacts.testWrite', { artifactId: artifact.id, opId: 'w1', appSessionId: 'app-agent', ops: [{ op: 'insertText', index: 0, text: 'agent;' }] });
    const { host, opens } = window();
    const handle = await host.open(artifact.id);
    expect(textOf(handle.doc as Doc)).toBe('agent;');
    for (let i = 0; i < 10; i++) type(handle, `a${i};`);
    await until(() => settled(handle));
    expect(hostText(artifact.id)).toBe(textOf(handle.doc as Doc));

    // The host's socket is corked: everything it writes queues, past the mark, so its next frame for the channel resets it.
    const hostSocket = fake.connections.at(-1)!;
    hostSocket.cork();
    await documents.service.writeAs(artifact.id, AGENT, (doc) => doc.get('root').insert(0, 'x'.repeat(100_000)));
    for (let i = 0; i < 5; i++) type(handle, `b${i};`); // in flight across the reset: unacked, so carried and re-sent
    await documents.service.writeAs(artifact.id, AGENT, (doc) => doc.get('root').insert(0, 'y;'));
    await until(() => fake.logs.some((line) => /channel \d+ reset/.test(line)));
    hostSocket.uncork();

    await until(() => opens.length >= 2 && settled(handle));
    const text = textOf(handle.doc as Doc);
    expect(text).toBe(hostText(artifact.id));
    for (const token of ['agent;', 'y;', ...Array.from({ length: 10 }, (_, i) => `a${i};`), ...Array.from({ length: 5 }, (_, i) => `b${i};`)]) expect(text).toContain(token);
    expect(text).toContain('x'.repeat(100_000));
  });

  it('re-opens through the same path when the connection drops and comes back, the edit made meanwhile saved', async () => {
    const { artifact } = await ok('artifacts.create', { kind: 'document', title: 'Dropped' });
    const { host, opens } = window();
    const handle = await host.open(artifact.id);
    type(handle, 'before;');
    await until(() => settled(handle));
    fake.dropClient();
    await until(() => supervisor.snapshot('engine-host').state !== 'ready');
    type(handle, 'offline;');
    await until(() => supervisor.snapshot('engine-host').state === 'ready' && opens.length >= 2 && settled(handle));
    expect(hostText(artifact.id)).toBe('before;offline;');
  });

  it('carries the artifact surface’s bytes across the JSON line as bytes', async () => {
    const { artifact } = await ok('artifacts.create', { kind: 'html', title: 'Page', content: { bytes: new TextEncoder().encode('<p>hi</p>') } });
    const { assetId } = await ok('artifacts.uploadAsset', { artifactId: artifact.id, name: 'logo.bin', mime: 'application/octet-stream', bytes: Uint8Array.from([0, 10, 255]) });
    expect(assetId).toMatch(/^[0-9a-f-]{36}$/);
    const doc = await ok('artifacts.create', { kind: 'document', title: 'Attributed' });
    const { revision } = await ok('artifacts.testWrite', { artifactId: doc.artifact.id, opId: 'w', appSessionId: 'app-agent', ops: [{ op: 'insertText', index: 0, text: 'hi' }] });
    const { bytes } = await ok('artifacts.attributions', { artifactId: doc.artifact.id, fromSeq: 0, toSeq: revision });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    const { versionId } = await ok('artifacts.saveVersion', { artifactId: doc.artifact.id, label: 'One' });
    const state = await ok('artifacts.versionState', { artifactId: doc.artifact.id, versionId });
    expect(state.bytes).toBeInstanceOf(Uint8Array);
    expect(state.bytes.length).toBeGreaterThan(0);
  });
});
