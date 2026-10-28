// WR 76/78: the built app starts a real detached host over scratch files, with no engine/session. As in the
// supervisor group's askWithNoApp, the test then replaces main with an authenticated socket client. One attachment
// spans locate and send because source handles belong to that attachment. No production seam or allowlist changes.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { expect, type TestInfo } from '@playwright/test';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { HostResponseSchema, type HostResponse } from '@shared/ipc/host-protocol';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { validateCommandOutput } from '@shared/ipc/validate';
import { SOCKET_PROTOCOL, splitLines } from '@shared/host/socket-protocol';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';
import { probeLayout, readLog, startHttpFixture } from './connector-direct-probe';
import { shellQuoted } from './connector-direct-checks';
import { invoke, value } from './connector-scene';
import { launchMaws, type MawsLaunch } from './launch';
import { killScratchProcesses } from './processes';
import { tmpSocketDirOf } from './supervisor-socket';

const NOTION_TOOL = 'notion-create-pages';
type Lock = { pid: number; socketPath: string; buildId: string };

async function connectHost(userData: string, lock: Lock) {
  const socket = createConnection(lock.socketPath);
  const responses = new Map<string, HostResponse>();
  const ended = new Set<string>();
  let welcome: { liveSessions: number; rows: number } | null = null;
  let fault: string | null = null;
  const lines = splitLines((text) => {
    const message = JSON.parse(text) as { t: string; name?: string; payload?: { operationId?: string }; liveSessions: number; rows: number; reason?: string };
    if (message.t === 'welcome') welcome = message;
    else if (message.t === 'refuse') fault = `supervisor refused the scratch client: ${message.reason}`;
    else if (message.t === 'res') {
      const response = HostResponseSchema.parse(message);
      responses.set(response.id, response);
    } else if (message.t === 'evt' && message.name === 'connectors.directOperation' && message.payload?.operationId) ended.add(message.payload.operationId);
  }, () => { fault = 'supervisor line exceeded the protocol bound'; });
  socket.on('data', (chunk: Buffer) => lines.push(chunk));
  socket.on('error', (error) => { fault = error.message; });
  socket.on('close', () => { fault ??= 'supervisor socket closed'; });
  try {
    await once(socket, 'connect');
    const token = readFileSync(join(userData, 'supervisor', 'host.token'), 'utf8').trim();
    socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: lock.buildId, capabilities: [], appPid: process.pid })}\n`);
    await expect.poll(() => { if (fault) throw new Error(fault); return welcome; }, { timeout: 10_000, message: 'the cold built host welcomes the scratch client' }).toMatchObject({ liveSessions: 0, rows: 0 });
    socket.write(`${JSON.stringify({ t: 'ready' })}\n`);
  } catch (error) {
    socket.destroy();
    throw error;
  }
  const request = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const id = randomUUID();
    socket.write(`${JSON.stringify({ t: 'req', id, name, input })}\n`);
    await expect.poll(() => { if (fault) throw new Error(fault); return responses.has(id); }, { timeout: 15_000, message: `${name} answers through the built host` }).toBe(true);
    const answer = responses.get(id)!;
    responses.delete(id);
    if (!answer.ok) throw new Error(`${name} failed: ${answer.error.code}`);
    const checked = validateCommandOutput(name, answer.value);
    if (!checked.ok) throw new Error(`${name} returned an invalid output`);
    return checked.value as CommandOutput<N>;
  };
  return {
    request,
    async take(operationId: string) {
      await expect.poll(() => { if (fault) throw new Error(fault); return ended.has(operationId); }, { timeout: 30_000, message: 'the real direct operation completes' }).toBe(true);
      const { outcome } = await request('connectors.directTake', { operationId });
      expect(outcome).not.toBeNull();
      return outcome!;
    },
    close: () => socket.destroy(),
  };
}

export async function coldHttpDelivery(info: TestInfo): Promise<void> {
  const layout = probeLayout();
  const userData = join(layout.scratch, 'app');
  const lockFile = join(userData, 'supervisor', 'host.lock');
  const fixtures: Awaited<ReturnType<typeof startHttpFixture>>[] = [];
  let maws: MawsLaunch | null = null;
  let child: ReturnType<MawsLaunch['app']['process']> | null = null;
  let client: Awaited<ReturnType<typeof connectHost>> | null = null;
  let lock: Lock | null = null;
  mkdirSync(userData);
  try {
    const user = await startHttpFixture(layout, 'cold-user', { tools: [NOTION_TOOL] }); fixtures.push(user);
    const app = await startHttpFixture(layout, 'cold-app', { tools: [NOTION_TOOL] }); fixtures.push(app);
    maws = await launchMaws({
      userData,
      env: { HOME: layout.home, SHELL: '/bin/zsh', MAWS_HARNESS: '0', MAWS_HOST_MODE: 'detached' },
      prepare: ({ shellHome, claudeConfigDir }) => {
        // Inherited config home deliberately has no server: only the scratch login shell names the real user entry.
        writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ mcpServers: {} }));
        writeFileSync(join(layout.config, '.claude.json'), JSON.stringify({ mcpServers: { 'cold-user': { type: 'http', url: user.url } } }));
        appendFileSync(join(shellHome, '.zprofile'), `export CLAUDE_CONFIG_DIR=${shellQuoted(layout.config)}\n`);
        writeFileSync(join(userData, 'settings.json'), JSON.stringify({ ...SETTINGS_DEFAULTS_V19, engine: { ...SETTINGS_DEFAULTS_V19.engine, mcpServers: [{ name: 'cold-app', type: 'http', url: app.url }] } }));
      },
    });
    child = maws.app.process();
    const exited = once(child, 'exit');
    await expect.poll(async () => {
      const status = value(await invoke(maws!.page, 'host.status', undefined));
      return status.state === 'ready' && status.supervisor?.pid ? status.supervisor.pid : 0;
    }, { timeout: 30_000, message: 'the built app registers its real detached engine host' }).not.toBe(0);
    lock = JSON.parse(readFileSync(lockFile, 'utf8')) as Lock;
    expect(value(await invoke(maws.page, 'engine.sessions', undefined))).toEqual([]);
    const { artifact } = value(await invoke(maws.page, 'artifacts.create', { kind: 'document', title: 'Cold delivery fixture' }));
    // Main's real client goes, clearing every observation and source handle; the fresh attachment below is cold.
    child.kill('SIGKILL');
    await exited;
    client = await connectHost(userData, lock);
    expect(await client.request('engine.sessions', undefined)).toEqual([]);
    const locating = randomUUID();
    await client.request('connectors.directLocate', { operationId: locating, tool: NOTION_TOOL, urlHosts: ['127.0.0.1'] });
    const found = await client.take(locating);
    if (found.kind !== 'locate') throw new Error(`unexpected direct operation ${found.kind}`);
    expect(found.answer.sources.map((source) => [source.server, source.scope, source.path]).sort((a, b) => a[0]!.localeCompare(b[0]!))).toEqual([
      ['cold-app', 'app', join(userData, 'settings.json')], ['cold-user', 'user', join(layout.config, '.claude.json')],
    ]);
    expect(readLog(layout), 'source location made no MCP request').toEqual([]);
    for (const source of found.answer.sources) {
      const operationId = randomUUID();
      const args = { pages: [{ properties: { title: source.server }, content: '# Cold delivery\nNo model turn.' }], allow_async: false };
      await client.request('connectors.directSend', { operationId, artifactId: artifact.id, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: source.server, tool: NOTION_TOOL, arguments: args });
      const sent = await client.take(operationId);
      expect(sent).toMatchObject({ kind: 'call', outcome: { ok: true, result: { structuredContent: { server: source.server, tool: NOTION_TOOL, arguments: args, n: 1 } } } });
    }
    expect(await client.request('connectors.grants', { artifactId: artifact.id })).toEqual({ grants: [] });
    expect(await client.request('engine.sessions', undefined)).toEqual([]);
    const journal = join(userData, 'engine-host', 'journal');
    expect(existsSync(journal) ? readdirSync(journal) : [], 'no engine/session journal was ever created').toEqual([]);
    const calls = readLog(layout).filter((row) => row.method === 'tools/call');
    // The HTTP fixture logs request methods, not tool parameters; each receipt above pins the tool and exact payload.
    expect(calls.map((row) => row.server).sort()).toEqual(['cold-app', 'cold-user']);
    await info.attach('cold-http-delivery.json', { body: JSON.stringify({ scopes: found.answer.sources.map((source) => source.scope), calls: calls.map((row) => ({ server: row.server, method: row.method })), sessions: 0, grants: 0 }), contentType: 'application/json' });
  } finally {
    client?.close();
    for (const fixture of fixtures) fixture.close();
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    try {
      await maws?.cleanup().catch((error: unknown) => console.error(error));
      if (!lock) {
        try { lock = JSON.parse(readFileSync(lockFile, 'utf8')) as Lock; } catch { /* startup may have failed or the host already exited */ }
      }
      await killScratchProcesses(layout.scratch, lock ? [lock.pid] : []);
    } finally {
      const socketDir = lock && tmpSocketDirOf(userData, lock.socketPath);
      if (socketDir) rmSync(socketDir, { recursive: true, force: true });
      layout.close();
    }
  }
}
