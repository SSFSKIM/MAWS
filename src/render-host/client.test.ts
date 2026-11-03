// P5 O5 M3 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M3 "Touches", Interfaces §E): the render host's
// persistent `machine.sock` client, against the fake front over the real socket machinery: refused with the reason when
// the daemon's token or socket is missing, the hello listing `render.client`, `ready` when its root says so, the events
// read in order, a command's answer as the render library's `CommandResult`, and the connection's end told once with
// every request still waiting answered `host_unavailable`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonPaths } from '@shared/daemon/files';
import { BROWSER_ENGINE_CAPABILITY, RENDER_CLIENT_CAPABILITY } from '@shared/host/socket-protocol';
import type { CommandResult } from '@shared/ipc/schema';
import { startFakeFront, type FakeFront, type FrontHandler } from '../../test/support/fake-front';
import { connectRenderClient, hostCall, type RenderClient } from './client';

const ARTIFACT = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function scratch(): string {
  const profile = mkdtempSync(join(tmpdir(), 'mrh-'));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  return profile;
}

async function front(handlers: Record<string, FrontHandler> = {}): Promise<FakeFront> {
  const started = await startFakeFront(scratch(), handlers);
  cleanups.push(() => started.close());
  return started;
}

async function connected(at: FakeFront, events: { name: string; payload: unknown }[] = []): Promise<RenderClient> {
  const reached = await connectRenderClient(at.paths, { build: 'render-test', onEvent: (name, payload) => void events.push({ name, payload }) });
  if (!reached.ok) throw new Error(reached.why);
  cleanups.push(() => reached.client.close());
  return reached.client;
}

describe('the render host’s machine.sock client', () => {
  it('refuses with the reason when no daemon has served the profile, or its socket is gone', async () => {
    const none = await connectRenderClient(daemonPaths(scratch()), { build: 'b', onEvent: () => {} });
    expect(none).toEqual({ ok: false, why: expect.stringContaining('no mawsd has served this profile') });
    const at = await front();
    await at.close();
    rmSync(at.paths.sockets.machine, { force: true });
    const gone = await connectRenderClient(at.paths, { build: 'b', onEvent: () => {} });
    expect(gone).toEqual({ ok: false, why: expect.stringContaining('machine.sock') });
  });

  it('says hello with render.client and browser.engine (P5 O17 M4) and says ready when its root does, not before', async () => {
    const at = await front();
    const client = await connected(at);
    const seen = await at.client();
    expect(seen.capabilities).toEqual([RENDER_CLIENT_CAPABILITY, BROWSER_ENGINE_CAPABILITY]);
    expect(seen.appPid).toBe(process.pid);
    expect(client.welcome.protocol).toBe(3);
    let ready = false;
    void seen.ready().then(() => (ready = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ready).toBe(false);
    client.ready();
    await seen.ready();
  });

  it('answers a command as the render library’s CommandResult: the value, the front’s error, an unknown name', async () => {
    const at = await front({
      'artifacts.state': () => ({ bytes: new Uint8Array([1, 2]), revision: 4 }),
      'artifacts.get': () => {
        throw new Error('the engine host is restarting');
      },
    });
    const call = hostCall((await connected(at)).invoke);
    expect(await call('artifacts.state', { artifactId: ARTIFACT })).toEqual({ ok: true, value: { bytes: new Uint8Array([1, 2]), revision: 4 } }); // the socket's codec carries bytes as bytes
    expect(await call('artifacts.get', { artifactId: ARTIFACT })).toEqual({ ok: false, error: { code: 'internal', message: 'the engine host is restarting' } });
    const unknown = (await call('no.such' as never, undefined as never)) as CommandResult<'artifacts.get'>;
    expect(unknown).toMatchObject({ ok: false, error: { code: 'unknown_command' } });
  });

  it('reads the front’s events in order once it said ready', async () => {
    const at = await front();
    const events: { name: string; payload: unknown }[] = [];
    const client = await connected(at, events);
    const seen = await at.client();
    client.ready();
    await seen.ready();
    seen.send('render.exit', {});
    seen.send('render.request', { id: 'r1', kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'pdf' } });
    await expect.poll(() => events.map((event) => event.name)).toEqual(['render.exit', 'render.request']);
    expect(events[1]!.payload).toEqual({ id: 'r1', kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'pdf' } });
  });

  // P5 O17 M4 (Interfaces §D, §H): the render host's cua sockets admit mawsd's relay by the peer of this very link
  it('gives the link’s descriptor while it is open, and none once it closed', async () => {
    const at = await front();
    const client = await connected(at);
    const fd = client.socketFd();
    expect(Number.isInteger(fd) && fd! >= 0).toBe(true);
    client.close();
    expect(client.socketFd()).toBeNull();
  });

  it('tells the connection’s end once and answers every request still waiting host_unavailable', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    cleanups.push(() => release());
    const at = await front({ 'artifacts.state': () => held });
    const client = await connected(at);
    const seen = await at.client();
    const waiting = client.invoke('artifacts.state', { artifactId: ARTIFACT });
    await expect.poll(() => seen.asked.length).toBe(1);
    at.drop();
    expect(await waiting).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(await client.closed).toBe('mawsd closed the connection');
    expect(await client.invoke('artifacts.state', { artifactId: ARTIFACT })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });
});
