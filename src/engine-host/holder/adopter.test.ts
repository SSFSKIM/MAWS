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

async function adopter(opts: { responder?: Responder; adoptMs?: number; spec?: typeof SPEC; deps?: Partial<LauncherDeps>; store?: MemorySessionStateStore; ps?: () => Promise<string> } = {}) {
  const store = opts.store ?? new MemorySessionStateStore();
  await store.saveLaunchSpec(ID, opts.spec ?? SPEC);
  const table = new ProcessTable({ ps: opts.ps ?? (async () => ''), log: () => {} });
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
  return { adopt: createAdopter(deps, opts.adoptMs), table, transports, logs, deps };
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

  // P5 O7 M9: the stored spec carries no `route` (an older strict reader's file, as launchedBy), so the adopter takes the
  // machine route from the launch's own spawn row and rebuilds the plan under it, never under the legacy field
  it('restores a machine-route launch on the machine route from its spawn row, the stored spec carrying none', async () => {
    const { route: _route, ...stored } = { ...SPEC, gateway: 'direct' as const, route: 'machine' as const };
    void _route;
    const { entry } = launched({ ...stored, route: 'machine' });
    let plan: Parameters<LauncherDeps['wire']>[1] | undefined;
    const a = await adopter({ spec: stored, deps: { wire: (_session, built) => void (plan = built), captureEnv: async () => ({ PATH: '/opt/now/bin', HOME: '/Users/x', CLAUDE_CONFIG_DIR: '/Users/x/.claude-now' }) } });
    const adopting = a.adopt(entry);
    await until(() => a.transports.length === 1 && a.table.get(ID) !== undefined, 'the reservation');
    caughtUp(a.transports[0]!);
    await adopting;
    expect(plan).toMatchObject({ route: 'machine', gateway: 'direct' });
    expect(plan!.flagSettings).toEqual({ dialogExpiry: 'never' }); // never the legacy direct route's blanking
    expect(a.table.get(ID)!.status().gateway).toMatchObject({ route: 'machine' });
    a.transports[0]!.exit(0);
    await a.table.get(ID)!.exited;
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

  // P5 O16 M4 (review of 33c3ecb06): `adoptable` takes a host holding no engine beside the newest host of the same
  // session; its release ends its adoption with a failure, which must not wake the real adoption's reads
  it('keeps the reads of a session waiting for its real adoption when a host of the same session holding no engine is released first', async () => {
    const { entry } = launched();
    const empty: RosterEntry = { ...entry, holderId: 'empty001', socket: '/x/empty.sock', state: 'ready', child: null, startedAt: '2026-10-31T11:00:00.000Z' };
    let attach: () => void = () => {};
    const attached = new Promise<void>((resolve) => (attach = resolve));
    const a = await adopter();
    const hosting = a.deps.holder!;
    const adoptHost = hosting.adopt!;
    hosting.adopt = async (...args) => (await attached, adoptHost(...args));
    a.table.holdForAdoption([ID]); // the start's hold: the host holding an engine only
    let woken = false;
    void a.table.adoptionSettled(ID, 8_000)!.then(() => void (woken = true));
    const real = a.adopt(entry);
    expect(await a.adopt(empty)).toBeNull(); // released first
    await sleep(20);
    expect(woken).toBe(false);
    expect(a.table.adoptionSettled(ID, 8_000)).not.toBeNull(); // a later read still waits for the real adoption
    attach();
    await until(() => woken, 'the reads woken at the real reservation');
    expect(a.table.get(ID)).toBeDefined();
    caughtUp(a.transports[0]!);
    expect(await real).toBe(ID);
    a.transports[0]!.exit(0);
    await a.table.get(ID)!.exited;
  });

  // P5 O16 panel fix wave 1 (sweep#3): the predecessor wrote `committed` before its fork and was lost before the child
  // showed; the host forks it all the same, so the entry holds an engine (or is about to): adopted, never released
  it('adopts a host whose launch committed with no child yet, through the host, never releasing it', async () => {
    const { entry } = launched();
    const committed: RosterEntry = { ...entry, state: 'committed', child: null };
    const released: string[] = [];
    const a = await adopter({ deps: {} });
    a.deps.holder!.release = async (e) => void released.push(e.holderId);
    a.table.holdForAdoption([ID]);
    const adopting = a.adopt(committed);
    await until(() => a.transports.length === 1 && a.table.get(ID) !== undefined, 'the reservation');
    caughtUp(a.transports[0]!);
    expect(await adopting).toBe(ID);
    expect(released).toEqual([]);
    expect(a.table.get(ID)!.status().pid).toBe(4101); // the child the host showed
    a.transports[0]!.exit(0);
    await a.table.get(ID)!.exited;
  });

  it('a committed host with no child yet whose adoption fails wakes its held reads', async () => {
    const { entry } = launched();
    const a = await adopter();
    a.deps.holder!.adopt = async () => {
      throw new Error('its spawn did not resolve in time');
    };
    a.table.holdForAdoption([ID]);
    let woken = false;
    void a.table.adoptionSettled(ID, 8_000)!.then(() => void (woken = true));
    await expect(a.adopt({ ...entry, state: 'committed', child: null })).rejects.toThrow(/did not resolve/);
    await until(() => woken, 'the reads woken at the failure');
  });

  // P5 O16 panel fix wave 1 follow-up (discovery 2): a reservation refused by closed admission (a stop-all or the exit
  // order between the attach and the reserve) lets the host go as an abandoned adoption does: its connection closed,
  // nothing released or signalled, so the next start attaches it again
  it('a reservation refused after the attach detaches the attached transport, its engine untouched', async () => {
    const { entry } = launched();
    let attach: () => void = () => {};
    const attached = new Promise<void>((resolve) => (attach = resolve));
    const a = await adopter();
    const hosting = a.deps.holder!;
    const adoptHost = hosting.adopt!;
    hosting.adopt = async (...args) => {
      const adopted = await adoptHost(...args);
      await attached;
      return adopted;
    };
    a.table.holdForAdoption([ID]);
    const adopting = a.adopt(entry);
    await until(() => a.transports.length === 1, 'the attach');
    await a.table.shutdown({ graceMs: 0, mode: 'detach' });
    attach();
    await expect(adopting).rejects.toThrow(/shutting down/);
    expect(a.transports[0]!.calls).toEqual(['detach']);
    expect(a.transports[0]!.writes).toEqual([]);
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

// The plan's D69: the descendant veto after an adoption, over the owner's server shapes (the veto probe's fixtures,
// spikes/protocol-probe/fixtures/p5/p5-o16-veto-mcp[-installed].jsonl). The plan is rebuilt (`environmentRebuilt`), so a
// bare command is never resolved through the adopter's PATH: cua's `node` is bound by what the launch's manager saved, or
// by count when it saved nothing (a build before D69); ptc's launcher, exec'd into its venv's python, likewise. The
// engine is pid 4101, born in the same second as its servers.
describe('the descendant veto after an adoption', () => {
  const BORN = 'Mon Nov  2 14:26:56 2026';
  const HOUR = 'Mon Nov  2 15:31:40 2026';
  const at = (pid: number, ppid: number, start: string, command: string) => `${pid} ${ppid} 1024 S ${start} ${command}`;
  const CUA = ['--disable-sigusr1', '/u/.claude/plugins/cache/cua/cua/0.21.0/cua-shim.mjs'];
  const PTC = '/u/.claude/plugins/cache/ptc-tool/ptc/0.6.1/bin/ptc-launch';
  const ABS = ['/x/server.mjs', 'flag'];
  const servers = { mcp_status: () => ({ response: { mcpServers: [
    { name: 'plugin:cua:cua_repl', status: 'connected', scope: 'dynamic', source: 'plugin', transport: 'stdio', config: { type: 'stdio', command: 'node', args: CUA } },
    { name: 'plugin:ptc:ptc', status: 'connected', scope: 'dynamic', source: 'plugin', transport: 'stdio', config: { type: 'stdio', command: PTC, args: [] } },
    { name: 'flag', status: 'connected', scope: 'dynamic', source: 'dynamic', transport: 'stdio', config: { type: 'stdio', command: '/usr/bin/node', args: ABS } },
  ] } }) };
  const resting = (session: string) => [
    at(4101, 4100, BORN, '/u/.local/share/claude/versions/2.1.316 -p --input-format stream-json'),
    at(820, 4101, BORN, `node ${CUA.join(' ')}`),
    at(821, 4101, BORN, '/u/.ptc/venvs/4c410075651a/bin/python -m ptc.mcp'),
    at(822, 4101, BORN, `/usr/bin/node ${ABS.join(' ')}`),
    at(823, 4101, BORN, `/Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python /u/.claude/plugins/cache/doperpowers/sminos/1.31.0/skills/sminos/scripts/sminos.py bridge --session ${session} --launch=k9vHeE6YTaP3bkSm5E93tw`),
  ];
  const BASH = [at(830, 4101, HOUR, "/opt/homebrew/bin/bash -c source /u/.claude/shell-snapshots/snapshot-bash-1793629565532-co9nny.sh 2>/dev/null || true && eval 'sleep 600'"), at(831, 830, HOUR, 'sleep 600')];

  async function adopted(tree: () => string[], store = new MemorySessionStateStore()) {
    const a = await adopter({ responder: servers, store, ps: async () => tree().join('\n') });
    return a;
  }
  // adopted, then a Stop: an adopted row's work is unknown until its first Stop (D32)
  async function ready(a: Awaited<ReturnType<typeof adopted>>, entry: RosterEntry) {
    const adopting = a.adopt(entry);
    await until(() => a.transports.length === 1 && a.table.get(ID) !== undefined, 'the reservation');
    caughtUp(a.transports[0]!);
    await adopting;
    const session = a.table.get(ID)!;
    a.transports[0]!.push({ type: 'control_request', request_id: 'stop-1', request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_id: 's', stop_hook_active: false, last_assistant_message: 'Done.', background_tasks: [], session_crons: [] } } });
    await until(() => session.status().work?.unknown === null, 'the first Stop');
    return session;
  }
  const work = (session: { status(): { work?: { descendants?: number | null } } }) => session.status().work?.descendants;

  it('restores what the launch’s manager saved: a bare command and an exec’d launcher with nothing to resolve, the bridge, and the releases take it', async () => {
    const { launchId, entry } = launched();
    const store = new MemorySessionStateStore();
    await store.saveInfrastructure(ID, { launch: launchId, processes: [
      { pid: 820, start: BORN, kind: 'server' }, { pid: 821, start: BORN, kind: 'server' }, { pid: 822, start: BORN, kind: 'server' }, { pid: 823, start: BORN, kind: 'bridge' },
    ] });
    let tree = resting(entry.engineSessionId!);
    const a = await adopted(() => tree, store);
    const session = await ready(a, entry);
    await a.table.sampleMemory();
    expect(work(session)).toBe(0);
    expect(a.transports[0]!.requestsOf('mcp_status')).toEqual([]); // nothing left to ask about
    tree = [...resting(entry.engineSessionId!), ...BASH];
    await a.table.sampleMemory();
    expect(work(session)).toBe(2); // a background Bash is still the session's work
    tree = resting(entry.engineSessionId!);
    await a.table.sampleMemory();
    a.table.setIdleRelease({ idleMs: 200, active: true });
    await until(() => a.transports[0]!.requestsOf('end_session').length > 0, 'the idle release');
    a.transports[0]!.exit(0);
    await session.exited;
  });

  it('adopted from a manager that saved nothing (a build before D69): the servers by count, the bridge by its argv; the budget release takes it', async () => {
    const { entry } = launched();
    const store = new MemorySessionStateStore();
    let tree = [...resting(entry.engineSessionId!), ...BASH];
    const a = await adopted(() => tree, store);
    const session = await ready(a, entry);
    await a.table.sampleMemory();
    await until(() => work(session) === 2, 'the servers bound, the Bash still counted');
    await until(() => store.infrastructure.get(ID)?.processes.length === 4, 'the bindings saved for the next adopter');
    tree = resting(entry.engineSessionId!);
    a.table.configure({ enabled: true, limitKiB: 1, statefulMcpServers: [] });
    await a.table.sampleMemory();
    expect(work(session)).toBe(0);
    await a.table.sampleMemory();
    await until(() => a.transports[0]!.requestsOf('end_session').length > 0, 'the budget release');
    a.transports[0]!.exit(0);
    await session.exited;
  });

  it('a saved binding whose process is gone, or another process now at its pid, binds nothing', async () => {
    const { launchId, entry } = launched();
    const store = new MemorySessionStateStore();
    await store.saveInfrastructure(ID, { launch: launchId, processes: [{ pid: 820, start: BORN, kind: 'server' }, { pid: 821, start: BORN, kind: 'server' }] });
    const tree = [at(4101, 4100, BORN, 'claude'), at(820, 4101, HOUR, 'sleep 900'), at(821, 4101, HOUR, `node ${CUA.join(' ')}`)];
    const a = await adopted(() => tree, store);
    const session = await ready(a, entry);
    await a.table.sampleMemory();
    await sleep(20);
    expect(work(session)).toBe(2); // neither is the process saved, and both started past the engine's spawn window
    a.transports[0]!.exit(0);
    await session.exited;
  });
});
