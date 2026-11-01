// The cua engine stub and its connector (test/support/cua-engine.ts; P5 O17 M8) proved before any Mac run, in plain Node:
// the connector driven over its control socket against a backend speaking cua's extension protocol (cua's creation
// sequence, its events counted, a request on a lost connection, the retry), and the stub coming ready under the real
// engine host's Session over the real process transport, its connector its own child on the socket its settings name,
// started again when it ends.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import { MemoryJournal } from '../../src/engine-host/conformance/scripted-transport';
import { buildLaunch, RELAY_URL } from '../../src/engine-host/launch';
import { EngineSession, SESSION_START_HOOK_MS } from '../../src/engine-host/session';
import { MAX_LINE_CHARS, spawnEngine } from '../../src/engine-host/transport';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';
import { connectorControl, connectorReport, CUA_CONNECTOR, writeCuaEngine, type ConnectorControl } from './cua-engine';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function scratch(): string {
  const root = realpathSync(mkdtempSync('/tmp/mcue-')); // short: two Unix sockets live under it
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out; last ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const frame = (message: unknown) => {
  const body = Buffer.from(JSON.stringify(message));
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32LE(body.length, 0);
  body.copy(out, 4);
  return out;
};

// A backend as MAWS's primitive server answers cua: a hello at once, then each request answered from `answers` (a
// method it does not hold is held unanswered), and every request it heard kept
function backend(path: string, answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const heard: { method: string; params: Record<string, unknown> }[] = [];
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    socket.write(frame({ jsonrpc: '2.0', method: 'hello', params: { extensionId: 'maws', extensionInstanceId: 'maws:S', protocolVersion: 1, profileName: 'MAWS' } }));
    let buffered = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32LE(0)) {
        const message = JSON.parse(buffered.subarray(4, 4 + buffered.readUInt32LE(0)).toString()) as { id: number; method: string; params: Record<string, unknown> };
        buffered = buffered.subarray(4 + buffered.readUInt32LE(0));
        heard.push({ method: message.method, params: message.params });
        const answer = answers[message.method];
        if (answer) socket.write(frame({ jsonrpc: '2.0', id: message.id, result: answer(message.params) }));
      }
    });
  });
  server.listen(path);
  cleanups.push(() => server.close());
  return { heard, sockets, notify: (method: string, params: unknown) => sockets.at(-1)!.write(frame({ jsonrpc: '2.0', method, params })) };
}

const BROWSER = {
  'windows.query': () => [{ id: 1, focused: true, type: 'normal' }],
  'windows.create': () => ({ id: 1 }),
  'tabs.create': () => ({ id: 7 }),
  'debugger.attach': () => ({}),
  'debugger.sendCommand': ({ method }: Record<string, unknown>) => (method === 'Page.captureScreenshot' ? { data: Buffer.from('a png').toString('base64') } : {}),
  'tabs.query': () => [],
};

function startConnector(root: string, socket: string, env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, [CUA_CONNECTOR, socket, join(root, 'cua-connector.json')], { env: { ...process.env, ...env }, stdio: 'ignore' });
  cleanups.push(() => child.kill('SIGKILL'));
  return child;
}
async function controlOf(root: string): Promise<ConnectorControl> {
  const control = await until(() => connectorControl(root).catch(() => null), (c) => c !== null);
  cleanups.push(() => control!.close());
  return control!;
}

describe('the connector under a scene’s control (P5 O17 M8)', () => {
  it('runs cua’s creation sequence, each step timed, and counts the debugger events cua’s host heard', async () => {
    const root = scratch();
    const socket = join(root, 'b.sock');
    const server = backend(socket, BROWSER);
    startConnector(root, socket, { MAWS_CUA_CONNECTOR_RETRY: '1', MAWS_CUA_CONNECTOR_CONTROL: '1' });
    const control = await controlOf(root);
    await until(() => control.state(), (state) => state.hellos === 1);

    const created = await control.sequence('http://127.0.0.1:4000/');
    expect(created).toMatchObject({ ok: true, result: { tabId: 7, windowId: 1, screenshotBytes: 5 } });
    if (!created.ok) return;
    expect(created.result.steps.map((step) => step.method)).toEqual(['windows.query', 'windows.create', 'tabs.create', 'debugger.attach', 'Page.captureScreenshot']);
    expect(server.heard.map((r) => r.method)).toEqual(['windows.query', 'windows.create', 'tabs.create', 'debugger.attach', 'debugger.sendCommand']);
    expect(server.heard[2]!.params).toMatchObject({ url: 'http://127.0.0.1:4000/' });
    expect(server.heard[4]!.params).toMatchObject({ debuggee: { tabId: 7 }, method: 'Page.captureScreenshot' });

    server.notify('debugger.event', { debuggee: { tabId: 7 }, method: 'Page.frameNavigated', params: {} });
    server.notify('debugger.event', { debuggee: { tabId: 7 }, method: 'Page.frameNavigated', params: {} });
    expect(await control.call('tabs.query')).toMatchObject({ ok: true, result: [] }); // after the events, on the same socket
    expect((await control.state()).events).toEqual({ 'Page.frameNavigated': 2 });
    expect(connectorReport(root)).toMatchObject({ connected: true, hellos: 1, control: join(root, 'cua-connector.sock') });
  });

  it('answers a request in flight `lost` when its connection goes, retries at its interval, and answers `not connected` before the next hello', async () => {
    const root = scratch();
    const socket = join(root, 'b.sock');
    const server = backend(socket, BROWSER); // `tabs.remove` is held unanswered
    startConnector(root, socket, { MAWS_CUA_CONNECTOR_RETRY: '1', MAWS_CUA_CONNECTOR_RETRY_MS: '400', MAWS_CUA_CONNECTOR_CONTROL: '1' });
    const control = await controlOf(root);
    await until(() => control.state(), (state) => state.hellos === 1);
    const held = control.call('tabs.remove', { tabId: 7 });
    await until(() => server.heard.length, (n) => n === 1);
    const lostAt = Date.now();
    server.sockets[0]!.destroy();
    expect(await held).toMatchObject({ ok: false, error: 'lost' });
    expect(await control.call('tabs.query')).toMatchObject({ ok: false, error: 'not connected' });
    const again = await until(() => control.state(), (state) => state.hellos === 2);
    expect(Date.now() - lostAt, 'not before the retry interval').toBeGreaterThanOrEqual(350);
    expect(again).toMatchObject({ closes: 1, connected: true });
    expect(await control.call('tabs.query')).toMatchObject({ ok: true, result: [] });
  });

  it('probes another socket from its own process, as an engine-side peer would dial it: a hello heard, or a close without one', async () => {
    const root = scratch();
    const socket = join(root, 'b.sock');
    backend(socket, BROWSER);
    const other = join(root, 'o.sock');
    backend(other, {});
    const refusing = join(root, 'x.sock');
    const closer: Server = createServer((client) => client.destroy());
    closer.listen(refusing);
    cleanups.push(() => closer.close());
    startConnector(root, socket, { MAWS_CUA_CONNECTOR_RETRY: '1', MAWS_CUA_CONNECTOR_CONTROL: '1' });
    const control = await controlOf(root);
    expect(await control.probe(other)).toMatchObject({ ok: true, result: { hello: { extensionInstanceId: 'maws:S' }, closed: false } });
    expect(await control.probe(refusing)).toMatchObject({ ok: true, result: { hello: null, closed: true } });
    expect(await control.probe(join(root, 'none.sock'))).toMatchObject({ ok: true, result: { hello: null, closed: true } });
  });
});

describe('the cua engine stub (P5 O17 M8)', () => {
  it('answers --version in the pinned format', () => {
    const bin = writeCuaEngine(join(scratch(), 'cua-engine'), { ready: true });
    expect(execFileSync(bin, ['--version'], { encoding: 'utf8' })).toBe(`${FIXTURE_ENGINE_VERSION} (Claude Code)\n`);
  });

  it('comes ready under the host’s Session, its connector its own child on the socket its settings name, started again when killed, and ends with the session', { timeout: 60_000 }, async () => {
    const root = scratch();
    const socket = join(root, 'b.sock');
    backend(socket, BROWSER);
    const bin = writeCuaEngine(join(root, 'cua-engine'), { ready: true, retry: true, control: true, respawn: true });
    const spec = LaunchSpecSchema.parse({
      appSessionId: 'cua-stub', cwd: root, additionalDirectories: [], model: null, effort: null, permissionMode: 'default', gateway: 'direct', subagentModel: null,
      resume: null, sessionId: randomUUID(), trust: null, mcpConfig: null, extraSettings: { env: { CUA_BROWSER_BACKENDS: socket } }, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
    });
    const plan = buildLaunch(spec, { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root }, { relayUrl: RELAY_URL, bin, engineVersion: FIXTURE_ENGINE_VERSION, spawnerPid: process.pid });
    const session = new EngineSession({ spec, plan, spawn: (p) => spawnEngine(p, { maxLineChars: MAX_LINE_CHARS }), journal: new MemoryJournal(), log: () => {}, sessionStartHookMs: () => Promise.resolve(SESSION_START_HOOK_MS) });
    try {
      await session.start();
      expect(session.lifecycle).toBe('ready');
      const enginePid = session.status().pid!;
      const first = await until(() => connectorReport(root), (report) => report?.hellos === 1);
      const parentOf = (pid: number) => Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
      expect(parentOf(first!.pid), 'the connector is the engine’s child').toBe(enginePid);

      process.kill(first!.pid, 'SIGKILL');
      const second = await until(() => connectorReport(root), (report) => report !== null && report.pid !== first!.pid && report.hellos === 1);
      expect(parentOf(second!.pid), 'started again by the same engine').toBe(enginePid);

      expect(await session.stop('stop')).toMatchObject({ exited: true });
      await until(() => { try { process.kill(second!.pid, 0); return false; } catch { return true; } }, (gone) => gone); // prettier-ignore
    } finally {
      if (session.lifecycle !== 'exited') await session.stop('stop');
    }
  });
});
