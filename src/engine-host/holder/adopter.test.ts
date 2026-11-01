// P5 O16 M3a fix wave 1 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3a; D58): the launcher's `adopt(entry)`
// against a scripted session host. Its result is the adoption's outcome, not its reservation: it settles once the
// session is ready (the fold, the catch-up, the queue's restore and the re-initialize done) or has failed, a failure
// after the reservation is counted by adoptAll, and the bound counts an adoption still under way as failed without
// killing it. The plan's environment was rebuilt (this build's capture now, cut to the spawn row's keys), so nothing
// attests from it: a changed PATH and config home between the launch and the adoption reach no connector context.
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDocuments, type Documents } from '../documents'; // P5 O16 M3b fix wave 1
import type { AppSessionId } from '@shared/graph/ids';
import { autoResponder, scriptedTransport, type Responder, type ScriptedTransport } from '../conformance/scripted-transport';
import { handshakeResponder, launchSpec } from '../conformance/session-harness';
import { JournalWriter } from '../journal';
import { buildLaunch, RELAY_URL, spawnMeta } from '../launch';
import { createAdopter, journalDir, type LauncherDeps } from '../launcher';
import { ProcessTable } from '../process-table';
import { AdoptionFailed } from '../session';
import { MemorySessionStateStore } from '../store/memory-session-state-store';
import { adoptAll } from './adopt';
import { SESSION_HOST_PROTOCOL } from './protocol';
import type { RosterEntry } from './roster';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

const ID = 'app-adopter' as AppSessionId;
const SPEC = launchSpec({ appSessionId: ID, cwd: '/tmp/maws-session' });
let userData: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-adopter-'));
});
afterEach(() => rmSync(userData, { recursive: true, force: true }));

// The launch as the old manager made it, under the environment it captured then; its journal's spawn row names the keys
function launched(spec = SPEC): { launchId: string; entry: RosterEntry } {
  const plan = buildLaunch(spec, { PATH: '/opt/then/bin', HOME: '/Users/x', CLAUDE_CONFIG_DIR: '/Users/x/.claude-then' }, { relayUrl: RELAY_URL, bin: '/x/claude', engineVersion: '2.1.283', spawnerPid: 4100, holder: { gateSocket: '/x/gate.sock' } });
  const writer = new JournalWriter(journalDir(userData, ID), plan.launchId, { maxBytes: 1_000_000 });
  writer.row('meta', spawnMeta(plan, { appVersion: 'test', holder: { pid: 4100, holderId: plan.launchId, binary: '/x/maws-session-host' } }));
  writer.row('out', { type: 'control_request', request_id: `${plan.launchId}-1`, request: { subtype: 'initialize', hooks: {} } });
  writer.row('in', { type: 'control_response', response: { subtype: 'success', request_id: `${plan.launchId}-1`, response: { commands: [], models: [], account: {}, current_permission_mode: 'default' } } });
  void writer.close();
  const entry: RosterEntry = {
    protocol: SESSION_HOST_PROTOCOL, holderId: plan.launchId, pid: 4100, procStart: 'then', startedAt: '2026-10-31T10:00:00.000Z', socket: '/x/host.sock', binary: '/x/maws-session-host',
    appSessionId: ID, engineSessionId: plan.sessionId, state: 'running', child: { pid: 4101, procStart: 'then' }, fence: 1, exit: null,
  };
  return { launchId: plan.launchId, entry };
}

async function adopter(opts: { responder?: Responder; adoptMs?: number; spec?: typeof SPEC; deps?: Partial<LauncherDeps> } = {}) {
  const store = new MemorySessionStateStore();
  await store.saveLaunchSpec(ID, opts.spec ?? SPEC);
  const table = new ProcessTable({ ps: async () => '', log: () => {} });
  const transports: ScriptedTransport[] = [];
  const logs: string[] = [];
  const deps: LauncherDeps = {
    userData, replayEnabled: false, cwd: userData, table, store, appVersion: 'test', log: (line) => logs.push(line), wire: () => {},
    binaryProbe: () => Promise.reject(new Error('an adoption probes nothing')),
    checkRelay: () => Promise.reject(new Error('an adoption checks no relay')),
    spawn: () => {
      throw new Error('an adoption spawns nothing');
    },
    // the environment now: another PATH and another config home than the launch's
    captureEnv: async () => ({ PATH: '/opt/now/bin', HOME: '/Users/x', CLAUDE_CONFIG_DIR: '/Users/x/.claude-now' }),
    holder: {
      gateSocket: '/x/gate.sock',
      start: () => Promise.reject(new Error('an adoption starts no host')),
      adopt: async (entry) => {
        const transport = scriptedTransport({ holder: { pid: entry.pid, holderId: entry.holderId, fence: 2 }, pid: 4101, onWrite: autoResponder(handshakeResponder(opts.responder)) });
        transports.push(transport);
        return { transport, fence: 2 };
      },
      release: async () => {},
    },
    ...opts.deps,
  };
  return { adopt: createAdopter(deps, opts.adoptMs), table, transports, logs };
}

const caughtUp = (t: ScriptedTransport) => t.pushProblem({ kind: 'host_caught_up', message: 'caught up', length: 0, typeGuess: null });

describe('the launcher’s adoption', () => {
  it('settles at ready, not at the reservation; the rebuilt environment attests nothing', async () => {
    const { entry } = launched();
    const a = await adopter();
    let settled = false;
    const adopting = a.adopt(entry).then((id) => {
      settled = true;
      return id;
    });
    await until(() => a.transports.length === 1 && a.table.get(ID) !== undefined, 'the reservation');
    await sleep(20);
    expect(settled).toBe(false); // reserved and started, still replaying
    caughtUp(a.transports[0]!);
    expect(await adopting).toBe(ID);
    const session = a.table.get(ID)!;
    expect(session.lifecycle).toBe('ready');
    expect(session.status().pid).toBe(4101);
    expect(session.connectorLaunchContext()).toBeNull(); // PATH and CLAUDE_CONFIG_DIR changed since the launch: unknown, never the capture's
    a.transports[0]!.exit(0);
    await session.exited;
  });

  // P5 O16 M3c: the stream begins at the adoption; what the launch journaled before it is the journal's to answer
  it('wires the adopted session with its journal’s last seq, through which its stream answers from the journal', async () => {
    const { entry } = launched();
    let through: number | undefined;
    const a = await adopter({ deps: { wire: (_session, _plan, _spec, historyThrough) => void (through = historyThrough) } });
    const adopting = a.adopt(entry);
    await until(() => a.transports.length === 1 && a.table.get(ID) !== undefined, 'the reservation');
    expect(through, 'the spawn row, the initialize and its answer').toBe(3);
    caughtUp(a.transports[0]!);
    await adopting;
    a.transports[0]!.exit(0);
    await a.table.get(ID)!.exited;
  });

  it('a failure after the reservation is the adoption’s, counted by adoptAll', async () => {
    const { entry } = launched();
    const a = await adopter({ responder: { initialize: () => ({ error: 'no session to resume' }) } });
    const counting = adoptAll([entry], { adopt: (e) => a.adopt(e), log: () => {} });
    await until(() => a.transports.length === 1, 'the attach');
    caughtUp(a.transports[0]!);
    const outcome = await counting;
    expect(outcome.adopted).toEqual([]);
    expect(outcome.failed.map((f) => f.reason)).toEqual([expect.stringMatching(/^re-initialize after the handover failed: .*no session to resume/)]);
    const session = a.table.get(ID)!;
    await until(() => a.transports[0]!.calls.includes('kill:SIGTERM'), 'the ladder');
    a.transports[0]!.exit(null, 'SIGTERM');
    await session.exited;
  });

  it('past its bound an adoption is counted failed and left running, never killed', async () => {
    const { entry } = launched();
    const a = await adopter({ adoptMs: 300 });
    const counting = adoptAll([entry], { adopt: (e) => a.adopt(e), log: () => {} });
    const outcome = await counting;
    expect(outcome.failed.map((f) => f.reason)).toEqual([expect.stringMatching(/not ready within 0\.3 s/)]);
    const session = a.table.get(ID)!;
    const t = a.transports[0]!;
    expect(t.calls).toEqual([]);
    expect(session.lifecycle).toBe('initializing');
    caughtUp(t); // it goes on, and is served once ready
    await until(() => session.lifecycle === 'ready', 'ready');
    t.exit(0);
    await session.exited;
  });

  it('an adoption given up before its first write releases its row and leaves the host attached to nothing, its engine untouched', async () => {
    const { launchId, entry } = launched();
    appendFileSync(join(journalDir(userData, ID), `${launchId}.jsonl`), '{broken\n{"seq":9,"at":"2026-10-31T10:00:09.000Z","direction":"meta","frame":{"event":"tail"}}\n');
    const a = await adopter();
    const error = await a.adopt(entry).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AdoptionFailed);
    expect((error as AdoptionFailed).abandoned).toBe(true);
    expect(a.table.get(ID)).toBeUndefined();
    expect(a.transports[0]!.calls).toEqual(['detach']);
    expect(a.transports[0]!.writes).toEqual([]);
  });
});

// P5 O16 M3b fix wave 1: an adopted session's capture and export bridges ask the client that renders (the daemon's render
// seam) as a launched one's do, app or no app (#418's `rendersAnswered`, which the adopter dropped)
describe('an adopted session’s bridges', () => {
  let documents: Documents;
  let cwd: string;
  beforeEach(() => {
    documents = openDocuments(userData, () => {})!;
    cwd = mkdtempSync(join(tmpdir(), 'maws-adopter-cwd-'));
  });
  afterEach(() => {
    documents.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('with no app attached and a client that renders, artifact_screenshot sends its capture request', async () => {
    writeFileSync(join(cwd, 'dashboard.html'), '<h1>ADOPTED</h1>');
    const spec = launchSpec({ appSessionId: ID, cwd });
    const { entry } = launched(spec);
    const captures: unknown[] = [];
    const a = await adopter({ spec, deps: { appAttached: () => false, rendersAnswered: () => true, artifacts: () => documents.store, wire: (session) => void session.on('artifactCapture', (request) => captures.push(request)) } });
    const adopting = a.adopt(entry);
    await until(() => a.transports.length === 1, 'the attach');
    caughtUp(a.transports[0]!);
    await adopting;
    const t = a.transports[0]!;
    const tool = (id: string, rpcId: number, name: string, args: unknown) => t.push({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: rpcId, method: 'tools/call', params: { name, arguments: args, _meta: { 'claudecode/toolUseId': `toolu_${rpcId}` } } } } });
    tool('e-create', 1, 'artifact_create', { id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' });
    await until(() => t.writes.some((w) => w.type === 'control_response' && JSON.stringify(w).includes('e-create')), 'the create');
    tool('e-shot', 2, 'artifact_screenshot', { id: 'dash' });
    await until(() => captures.length === 1, 'the capture request, sent with no app');
    expect(captures[0]).toMatchObject({ requestId: 'e-shot' });
    t.exit(0);
    await a.table.get(ID)!.exited;
  });
});
