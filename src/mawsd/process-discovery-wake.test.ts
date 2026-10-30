// The discovery wake (P5 O3-D M6 fix round 1, item 7; the architect's ruling (a)): a machine.sock client's read that
// needs the index, on a `mawsd` with no app and its engine host parked, sees what is on disk as of the read. The read
// wakes the host and waits (DISCOVERY_WAKE_BOUND_MS) for its first discovery pass to reach the index, then answers; the
// host is asked to park again at once (nothing attached, no interest); reads that arrive meanwhile join the one wake,
// and a read within DISCOVERY_FRESH_MS of the pass wakes nothing. Nobody sends daemon.status first. Over the daemon in
// this process with the product's options, its engine host the built bundle (`out/main/`) under MAWS_ENGINE_REPLAY=1,
// the spine the services entry, a bare machine.sock client as the CLI's. Skipped without a build; class 1a builds first.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { daemonPaths } from '@shared/daemon/files';
import { endHostProcess } from '../../test/support/host-exit';
import { RawApp } from '../../test/support/mawsd-scene';
import { writeReplayEngine } from '../../test/support/replay-engine';
import { seedTranscript } from '../../test/support/transcripts';
import { isAlive, readLock } from '../engine-host/supervisor-files';
import { startDaemon, type RunningDaemon } from './daemon';
import { DISCOVERY_FRESH_MS } from './discovery-wake';

const REPO_ROOT = resolve(__dirname, '../..');
const OUT = join(REPO_ROOT, 'out/main');
const MAWSD = join(OUT, 'mawsd.js');
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

function hostBundles(): { engineHost: string; ptyHost: string } {
  const files = readdirSync(OUT).filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name)).map((name) => join(OUT, name));
  const pty = files.filter((file) => readFileSync(file, 'utf8').includes('node-pty'));
  const engine = files.filter((file) => !pty.includes(file));
  if (pty.length !== 1 || engine.length !== 1) throw new Error(`expected one engine host and one pty host bundle in ${OUT}: ${files.join(', ')}`);
  return { engineHost: engine[0]!, ptyHost: pty[0]! };
}

async function until<T>(check: () => T | null | undefined | false | Promise<T | null | undefined | false>, what: string, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await check();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

let scratch: string;
let profile: string;
let daemon: RunningDaemon | null;
let logs: string[];
const opened: RawApp[] = [];

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-mdw-'))); // the index keeps a project's real directory
  profile = join(scratch, 'profile');
  mkdirSync(join(scratch, 'home'));
  mkdirSync(join(scratch, 'claude-config'));
  daemon = null;
  logs = [];
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${logs.join('\n')}\n`));
  for (const method of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(async () => {
  try {
    for (const client of opened.splice(0)) client.destroy();
    await daemon?.stop('test over');
    const pid = readLock(join(profile, 'supervisor'))?.pid;
    if (pid !== undefined) await endHostProcess(pid);
  } finally {
    vi.restoreAllMocks();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const wakes = () => logs.filter((line) => line.startsWith('[spine] discovery: ') && line.includes('wakes the parked engine host')).length;
const spawns = () => logs.filter((line) => line.includes('spawned a supervisor, pid ')).length;

describe.skipIf(!existsSync(MAWSD))('the discovery wake: a read that needs the index, on a mawsd with no app and its engine host parked', () => {
  it('wakes the host once for concurrent reads, answers with the folder on disk, parks it again, and a fresh read wakes nothing', async () => {
    const loose = join(scratch, 'loose');
    mkdirSync(loose);
    const sessionId = seedTranscript(join(scratch, 'claude-config'), loose, 'a session of a folder nobody added');
    daemon = await startDaemon({
      kind: 'private',
      dir: join(profile, 'mawsd'),
      profileDir: profile,
      modules: { self: MAWSD, ...hostBundles() },
      build: { version: '0.0.0-test', commit: 'discovery-wake', builtAt: '2026-10-29T00:00:00.000Z' },
      env: {
        PATH: '/usr/bin:/bin',
        HOME: join(scratch, 'home'),
        ZDOTDIR: join(scratch, 'home'),
        SMINOS_HOME: join(scratch, 'home'),
        CLAUDE_CONFIG_DIR: join(scratch, 'claude-config'),
        MAWS_USER_DATA: profile,
        MAWS_ENGINE_REPLAY: '1',
        MAWS_E2E: '1',
        MAWS_E2E_ENGINE_BIN: writeReplayEngine(scratch),
      },
      exit: () => {},
      openLog: () => (line) => void logs.push(line),
      endpoint: null,
      permanentClient: true,
      spine: { load: () => import('../services/entry'), wakeOnEvents: true },
      claimSpine: true,
    });
    expect(daemon).not.toBeNull();
    expect(logs).toContainEqual(expect.stringContaining('serving; engine host parked'));
    const token = readFileSync(join(profile, 'mawsd', 'mawsd.token'), 'utf8').trim();
    const client = await RawApp.connect(daemonPaths(profile).sockets.machine, token, { capabilities: [] }); // the CLI's hello
    opened.push(client);
    expect(client.welcomed()).toBe(true);

    // two reads at once, the first loading the spine: one wake, and both answers carry what is on disk
    const [listed, projects] = await Promise.all([client.request('session.list', { includeArchived: true }, 60_000), client.request('session.projects.list', undefined, 60_000)]);
    expect(listed, logs.join('\n')).toMatchObject({ ok: true });
    expect((listed as { value: { sessions: { engineSessionId: string | null }[] } }).value.sessions.map((s) => s.engineSessionId)).toContain(sessionId);
    expect((projects as { ok: boolean; value: { projects: { directory: string; discovered: boolean }[] } }).value.projects).toContainEqual(expect.objectContaining({ directory: loose, discovered: true }));
    expect(wakes(), 'concurrent reads make one wake').toBe(1);
    expect(spawns(), 'one engine host started').toBe(1);

    // the host parks again at once: asked to exit when idle for the wake, then gone
    // the woken host's pid from the spawn line, not its lock: the park can be over before the answers are read (run 41021922751)
    const host = Number(/spawned a supervisor, pid (\d+)/.exec(logs.find((line) => line.includes('spawned a supervisor, pid ')) ?? '')?.[1]);
    expect(host, 'the woken host’s pid').toBeGreaterThan(0);
    await until(() => logs.some((line) => line.includes('[spine] discovery: the wake is over: asking the engine host to exit when idle')), 'the park asked after the pass', 10_000);
    await until(() => !isAlive(host), 'the woken engine host parked again', 30_000);

    // a read within DISCOVERY_FRESH_MS of the pass wakes nothing
    expect(DISCOVERY_FRESH_MS).toBeGreaterThan(5_000);
    expect(await client.request('session.list', { includeArchived: true }, 10_000)).toMatchObject({ ok: true });
    expect(wakes(), 'a fresh read wakes nothing').toBe(1);
    expect(spawns()).toBe(1);
  });
});
