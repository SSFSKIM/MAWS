// The page server over the built bundles (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, M3's
// Proves: "running and stopped without the app", T29; "the registration", X4, across a stop and a kill). Two scenes:
// the daemon in this process with its engine host the built bundle (`out/main/`) under MAWS_ENGINE_REPLAY=1 and the
// spine the services entry, no app attached, the engine's store seeded with one session a live stand-in process holds
// and one nobody holds; and the built `mawsd` as a process of its own, killed. Skipped without a build; class 1a
// builds first. The login shell, as the spine captures it, is this suite's.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { endHostProcess } from '../../test/support/host-exit';
import { writeReplayEngine } from '../../test/support/replay-engine';
import { HOST, JSON_BODY, ORIGIN, jsonOf, pairedTab, request } from '../../test/support/sheet-page-client';
import { slugOf } from '../engine-host/fs/paths';
import { isAlive, readLock } from '../engine-host/supervisor-files';
import { startDaemon, type RunningDaemon } from './daemon';
import { registrationName } from './sheet-page/registration';

let loginShell: Record<string, string> = {};
vi.mock('@shared/host/shell-env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/host/shell-env')>();
  return { ...actual, captureShellEnvironment: async () => ({ ...loginShell }) };
});

const REPO = resolve(__dirname, '../..');
const OUT = join(REPO, 'out/main');
const MAWSD = join(OUT, 'mawsd.js');
const FIXTURE = join(REPO, 'test/fixtures/sheet-page/bundle');
const RECORD = join(REPO, 'test/fixtures/sheet/set/fixtures/references/before/sheet/5eed0000-0000-4000-8000-000000000019');
const HELD = '5eed0000-0000-4000-8000-0000000000a1';
const NOBODY = '5eed0000-0000-4000-8000-0000000000a2';
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
let dirs: { profile: string; home: string; sminos: string; config: string };
let logs: string[];
let daemon: RunningDaemon | null;
const children: ChildProcess[] = [];

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-spb-'))); // the index keeps a project's real directory
  dirs = { profile: join(scratch, 'profile'), home: join(scratch, 'home'), sminos: join(scratch, 'sminos'), config: join(scratch, 'claude-config') };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  loginShell = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dirs.home, CLAUDE_CONFIG_DIR: dirs.config };
  logs = [];
  daemon = null;
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${logs.join('\n')}\n`));
  for (const method of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(async () => {
  try {
    await daemon?.stop('test over');
    const pid = readLock(join(dirs.profile, 'supervisor'))?.pid;
    if (pid !== undefined) await endHostProcess(pid);
    for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  } finally {
    vi.restoreAllMocks();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// A record of the pin's form for `session` under the scratch sminos home
function seedRecord(session: string): void {
  const record = join(dirs.sminos, 'sheet', session);
  cpSync(RECORD, record, { recursive: true });
  writeFileSync(join(record, 'inbox.jsonl'), '');
  const state = JSON.parse(readFileSync(join(record, 'state.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(record, 'state.json'), JSON.stringify({ ...state, session }));
}

// A terminal session's transcript in the engine's store, and for a held one a registry record naming a live stand-in
// process with its start time as the engine renders it (e2e/support/lane-a.ts's terminal)
function seedSession(session: string, cwd: string, held: boolean): void {
  const folder = join(dirs.config, 'projects', slugOf(cwd));
  mkdirSync(folder, { recursive: true });
  const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: `a session that asked (${session.slice(-2)})` }, uuid: `${session.slice(0, -2)}ff`, timestamp: '2026-11-24T09:00:00.000Z', cwd, sessionId: session, version: '2.1.300' };
  writeFileSync(join(folder, `${session}.jsonl`), `${JSON.stringify(first)}\n`);
  if (!held) return;
  const child = spawn('/bin/sh', ['-c', 'read -r _'], { stdio: ['pipe', 'ignore', 'ignore'] });
  children.push(child);
  const pid = child.pid!;
  const procStart = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8' }).trim();
  mkdirSync(join(dirs.config, 'sessions'), { recursive: true });
  writeFileSync(join(dirs.config, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: session, cwd, kind: 'interactive', procStart, status: 'idle' }));
}

describe.skipIf(!existsSync(MAWSD))('running and stopped without the app (T29)', () => {
  // The scene up to the first snapshot a paired connection is sent
  async function firstSnapshot() {
    const project = join(scratch, 'proj');
    mkdirSync(project);
    seedSession(HELD, project, true);
    seedSession(NOBODY, project, false);
    seedRecord(HELD);
    seedRecord(NOBODY);
    const running = await startDaemon({
      kind: 'private',
      dir: join(dirs.profile, 'mawsd'),
      profileDir: dirs.profile,
      modules: { self: MAWSD, ...hostBundles() },
      build: { version: '0.0.0-test', commit: 'sheet-page-built', builtAt: '2026-11-24T00:00:00.000Z' },
      env: {
        PATH: '/usr/bin:/bin',
        HOME: dirs.home,
        ZDOTDIR: dirs.home,
        SMINOS_HOME: dirs.sminos,
        CLAUDE_CONFIG_DIR: dirs.config,
        MAWS_USER_DATA: dirs.profile,
        MAWS_ENGINE_REPLAY: '1',
        MAWS_E2E: '1',
        MAWS_E2E_ENGINE_BIN: writeReplayEngine(scratch),
        MAWS_SHEET_PAGE: '1',
        MAWS_SHEET_PORT: '0',
      },
      exit: () => {},
      openLog: () => (line) => void logs.push(line),
      endpoint: null,
      permanentClient: true,
      spine: { load: () => import('../services/entry'), wakeOnEvents: true },
      claimSpine: true,
      sheetPage: { bundleDir: FIXTURE, shell: async () => ({ ...loginShell }) },
    });
    expect(running).not.toBeNull();
    daemon = running;
    expect(logs).toContainEqual(expect.stringContaining('serving; engine host parked')); // no app: nothing keeps the index current
    await until(() => running!.sheetPage.status().state === 'listening', 'the sheet page listening', 10_000);
    const port = Number(new URL(running!.sheetPage.status().url!).port);

    const minted = await running!.sheetPage.pair();
    if (!minted.ok) throw new Error(minted.why);
    const browser = jsonOf(await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), JSON_BODY], JSON.stringify({ code: minted.code }))) as { id: string; credential: string };
    const tab = await pairedTab(port, browser);
    const ready = (await tab.next(2, 60_000)) as { t: string; sessions: { session: string; live: boolean | null }[] };
    expect(ready.t).toBe('ready');
    return { tab, ready };
  }
  const liveOf = (sessions: { session: string; live: boolean | null }[]) => Object.fromEntries(sessions.map((summary) => [summary.session, summary.live]));

  it('wakes the parked engine host for one pass before the first snapshot, which reads the held session running and the unheld one stopped; the host parks again', async () => {
    const { tab, ready } = await firstSnapshot();
    expect(liveOf(ready.sessions)).toEqual({ [HELD]: true, [NOBODY]: false }); // without the wake the index would not hold them: null, listed as running
    expect(logs.filter((line) => line.includes('wakes the parked engine host')), 'one wake').toHaveLength(1);

    const host = Number(/spawned a supervisor, pid (\d+)/.exec(logs.find((line) => line.includes('spawned a supervisor, pid ')) ?? '')?.[1]);
    expect(host, 'the woken host’s pid').toBeGreaterThan(0);
    await until(() => !isAlive(host), 'the woken engine host parked again', 30_000);
    tab.ws.close();
  });
});

describe.skipIf(!existsSync(MAWSD))('the registration across a stop and a kill (X4; A.f)', () => {
  // The built daemon as a process, from a copy of the build beside which the fixture stands as the page's bundle
  // (`mawsd` finds it one directory above its own entry)
  function tree(): string {
    const root = join(scratch, 'release');
    cpSync(OUT, join(root, 'main'), { recursive: true });
    cpSync(FIXTURE, join(root, 'sheet-page'), { recursive: true });
    symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules')); // what the build leaves external, as from the tree
    return join(root, 'main', 'mawsd.js');
  }
  const surfaces = () => join(dirs.sminos, 'sheet', 'surfaces');
  const file = () => join(surfaces(), `${registrationName(false, dirs.profile)}.json`);

  function run(entry: string): ChildProcess {
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', SHELL: '/bin/sh', HOME: dirs.home, MAWS_USER_DATA: dirs.profile, CLAUDE_CONFIG_DIR: dirs.config, SMINOS_HOME: dirs.sminos, MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', MAWS_E2E: '1', MAWS_ENGINE_REPLAY: '1' };
    const child = spawn(process.execPath, ['--disable-sigusr1', entry, 'run', '--private', '--dir', join(dirs.profile, 'mawsd')], { env, stdio: ['ignore', 'ignore', 'ignore'] });
    children.push(child);
    onTestFailed(() => void process.stdout.write(`--- mawsd.log\n${existsSync(join(dirs.profile, 'mawsd', 'mawsd.log')) ? readFileSync(join(dirs.profile, 'mawsd', 'mawsd.log'), 'utf8') : '(none)'}\n`));
    return child;
  }
  const exited = (child: ChildProcess) => new Promise<void>((done) => (child.exitCode !== null || child.signalCode !== null ? done() : child.once('exit', () => done())));

  it('stands while mawsd runs, is removed by a clean stop, and after a kill stays naming a pid that is gone', async () => {
    const entry = tree();
    const first = run(entry);
    const written = await until(() => existsSync(file()) && (JSON.parse(readFileSync(file(), 'utf8')) as { pid: number; url: string; reach: string }), 'the registration', 30_000);
    expect(written).toMatchObject({ v: 1, name: registrationName(false, dirs.profile), pid: first.pid, reach: 'local', url: expect.stringMatching(/^http:\/\/sheet\.localhost:\d+$/) });
    first.kill('SIGTERM');
    await exited(first);
    expect(existsSync(file()), 'a clean stop removed it').toBe(false);

    const second = run(entry);
    await until(() => existsSync(file()) && (JSON.parse(readFileSync(file(), 'utf8')) as { pid: number }).pid === second.pid, 'the second registration', 30_000);
    second.kill('SIGKILL');
    await exited(second);
    const left = JSON.parse(readFileSync(file(), 'utf8')) as { pid: number };
    expect(left.pid).toBe(second.pid);
    expect(isAlive(left.pid), 'the pid it names is gone').toBe(false);
  });
});
