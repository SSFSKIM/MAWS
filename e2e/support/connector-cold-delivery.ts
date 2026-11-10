// WR 76/78: an HTTP connector's delivery completes with the app gone, no engine and no session. P5 O15 M1
// (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): on the daemon shape the profile's private `mawsd` is the
// engine host's permanent client and delivery is the daemon's (O4), so the app quits and a second client of the
// profile's machine.sock (as O4's no-app cases observe the machine) asks the engine host's route D through `mawsd`, which
// forwards an engine host name raw: one machine.sock connection spans locate and send, because source handles belong to
// the client that located them. The delivery service's own `delivery.deliver` is not the stand-in: its Notion host
// allowlist admits no loopback fixture. No production seam or allowlist changes.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type TestInfo } from '@playwright/test';
import { daemonPaths } from '@shared/daemon/files';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { validateCommandOutput } from '@shared/ipc/validate';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { reachMachine } from '../../src/mawsd/machine-client';
import { probeLayout, readLog, startHttpFixture } from './connector-direct-probe';
import { shellQuoted } from './connector-direct-checks';
import { invoke, value } from './connector-scene';
import { launchMaws, type MawsLaunch } from './launch';
import { isAlive, killScratchProcesses } from './processes';

const NOTION_TOOL = 'notion-create-pages';

// A client of the profile's machine.sock, with no app running: its requests, each validated as the app's would be, and
// a direct operation's outcome taken once it has ended (`connectors.directTake` answers null while it runs)
async function connectMachine(userData: string) {
  const reached = await reachMachine(daemonPaths(userData), { build: 'e2e-cold-delivery' });
  if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
  const { link } = reached;
  const request = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const answer = await link.request(name, input, 15_000);
    if (!answer.ok) throw new Error(`${name} failed: ${answer.error.code} ${answer.error.message}`);
    const checked = validateCommandOutput(name, answer.value);
    if (!checked.ok) throw new Error(`${name} returned an invalid output`);
    return checked.value as CommandOutput<N>;
  };
  return {
    request,
    async take(operationId: string) {
      let outcome: CommandOutput<'connectors.directTake'>['outcome'] = null;
      await expect.poll(async () => (outcome = (await request('connectors.directTake', { operationId })).outcome) !== null, { timeout: 30_000, message: 'the real direct operation completes' }).toBe(true);
      return outcome!;
    },
    close: () => link.close(),
  };
}

export async function coldHttpDelivery(info: TestInfo): Promise<void> {
  const layout = probeLayout();
  const userData = join(layout.scratch, 'app');
  const fixtures: Awaited<ReturnType<typeof startHttpFixture>>[] = [];
  let maws: MawsLaunch | null = null;
  let child: ReturnType<MawsLaunch['app']['process']> | null = null;
  let client: Awaited<ReturnType<typeof connectMachine>> | null = null;
  const pids: number[] = []; // `mawsd` and the engine host, which outlive the app
  mkdirSync(userData);
  try {
    const user = await startHttpFixture(layout, 'cold-user', { tools: [NOTION_TOOL] }); fixtures.push(user);
    const app = await startHttpFixture(layout, 'cold-app', { tools: [NOTION_TOOL] }); fixtures.push(app);
    maws = await launchMaws({
      userData,
      env: { HOME: layout.home, SHELL: '/bin/zsh', MAWS_HARNESS: '0', MAWS_HOST_MODE: 'daemon' },
      prepare: ({ shellHome, claudeConfigDir }) => {
        // Inherited config home deliberately has no server: only the scratch login shell names the real user entry.
        writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ mcpServers: {} }));
        writeFileSync(join(layout.config, '.claude.json'), JSON.stringify({ mcpServers: { 'cold-user': { type: 'http', url: user.url } } }));
        appendFileSync(join(shellHome, '.zprofile'), `export CLAUDE_CONFIG_DIR=${shellQuoted(layout.config)}\n`);
        // P5 O3-A: an O2-era unified file, which the launch splits; the app scope's identity keeps naming settings.json
        writeFileSync(join(userData, 'settings.json'), JSON.stringify({ ...SETTINGS_DEFAULTS_V21, version: 20, engine: { ...SETTINGS_DEFAULTS_V21.engine, mcpServers: [{ name: 'cold-app', type: 'http', url: app.url }] } }));
      },
    });
    child = maws.app.process();
    const exited = once(child, 'exit');
    await expect.poll(async () => {
      const status = value(await invoke(maws!.page, 'host.status', undefined));
      if (status.state !== 'ready' || !status.supervisor?.pid || status.transport !== 'daemon' || status.daemon === null) return false;
      pids.push(status.supervisor.pid, status.daemon.pid);
      return true;
    }, { timeout: 30_000, message: 'the built app reaches its real engine host through the profile\'s mawsd' }).toBe(true);
    expect(value(await invoke(maws.page, 'engine.sessions', undefined))).toEqual([]);
    const { artifact } = value(await invoke(maws.page, 'artifacts.create', { kind: 'document', title: 'Cold delivery fixture' }));
    // The app quits; `mawsd` and its engine host outlive it, and the client below is a fresh one, with no source handle.
    await maws.app.close();
    await exited;
    expect(pids.filter((pid) => !isAlive(pid)), 'mawsd and its engine host outlive the app').toEqual([]);
    client = await connectMachine(userData);
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
      await maws?.cleanup().catch((error: unknown) => console.error(error)); // ends the profile's `mawsd` and hosts too
      await killScratchProcesses(layout.scratch, pids);
    } finally {
      const { socketDir } = daemonPaths(userData); // `mawsd`'s sockets' $TMPDIR fallback, when they took it
      if (!socketDir.startsWith(layout.scratch)) rmSync(socketDir, { recursive: true, force: true });
      layout.close();
    }
  }
}
