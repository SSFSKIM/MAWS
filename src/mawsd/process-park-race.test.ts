// A request just after a discovery wake's park (P5 O5 landing 1; acceptance 5's machine side): a machine.sock
// client's read that needs the index wakes the parked engine host for its discovery pass, and once the pass is heard the
// host is asked to park again (discovery-wake.ts, DaemonClocks.parkNow). An engine host request that arrives in that
// window, through the front's path to the engine host (front.ts `forward`, `hosts.forward`: the path a render host's
// reads take for another machine's Export, and a bare client's `artifacts.create`), is answered as if no park were
// under way: the host it is sent to is not left to exit under it. Over the daemon in this process with the product's
// options, its engine host the built bundle (`out/main/`) under MAWS_ENGINE_REPLAY=1, the spine the services entry, a
// bare machine.sock client as the CLI's (as process-discovery-wake.test.ts). Skipped without a build; class 1a builds
// first.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { daemonPaths } from '@shared/daemon/files';
import { endHostProcess } from '../../test/support/host-exit';
import { RawApp } from '../../test/support/mawsd-scene';
import { writeReplayEngine } from '../../test/support/replay-engine';
import { seedTranscript } from '../../test/support/transcripts';
import { readLock } from '../engine-host/supervisor-files';
import { startDaemon, type RunningDaemon } from './daemon';

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


describe.skipIf(!existsSync(MAWSD))('a request just after a discovery wake’s park, through the front’s path to the engine host', () => {
  it('is answered: the host asked to park is not left to exit under a request it was sent', async () => {
    const loose = join(scratch, 'loose');
    mkdirSync(loose);
    seedTranscript(join(scratch, 'claude-config'), loose, 'a session of a folder nobody added');
    daemon = await startDaemon({
      kind: 'private',
      dir: join(profile, 'mawsd'),
      profileDir: profile,
      modules: { self: MAWSD, ...hostBundles() },
      build: { version: '0.0.0-test', commit: 'park-race', builtAt: '2026-10-31T00:00:00.000Z' },
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
    const token = readFileSync(join(profile, 'mawsd', 'mawsd.token'), 'utf8').trim();
    const client = await RawApp.connect(daemonPaths(profile).sockets.machine, token, { capabilities: [] }); // the CLI's hello
    opened.push(client);

    // the discovery read: it wakes the parked host and answers once the pass is heard, when the park is asked
    expect(await client.request('session.list', { includeArchived: true }, 60_000)).toMatchObject({ ok: true });
    // at once, as the e2e's machine-side export did (artifacts.create, then the export's reads)
    const page = '<!doctype html><title>B</title><h1>B</h1>';
    const created = await client.request('artifacts.create', { kind: 'html', title: 'B’s page', content: { bytes: new TextEncoder().encode(page), name: 'index.html' } }, 30_000);
    expect(created, `${JSON.stringify(created)}\n${logs.join('\n')}`).toMatchObject({ ok: true });
    const { artifact } = (created as { value: { artifact: { id: string } } }).value;
    expect(await client.request('artifacts.get', { artifactId: artifact.id }, 30_000), logs.join('\n')).toMatchObject({ ok: true, value: { artifact: { id: artifact.id } } });
    // the scene is the race's: the park was asked of the woken host, and the request went only once that host had gone
    // (or before the ask, held off by it); the host that answered is not asked to park under the next request
    expect(logs).toContain('[spine] discovery: the wake is over: asking the engine host to exit when idle');
    const after = logs.indexOf('[hosts] artifacts.create arrived after the engine host was asked to park: waiting for its exit');
    if (after >= 0) expect(logs.slice(after).some((line) => /\[hosts\] supervisor pid \d+ exited \(code 0\)/.test(line))).toBe(true);
    expect(logs.filter((line) => line.includes('asking the engine host to exit when idle')), 'the next host stays for the park clock').toHaveLength(1);
  });
});
