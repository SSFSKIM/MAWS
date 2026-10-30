// Acceptance 8's process-level half (P5 O3-D M5a; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Acceptance 8,
// D46): with no app attached, the endpoint module reaches the machine through `mawsd`'s seam over a scratch profile with a
// replayed lane B session. `onEvent` delivers the session's events (owner `engine-host`), `dispatch('machine',
// 'session.list', …)` answers the spine's records, `onEvent` carries `attention.changed` with owner `machine` for the
// session's pending permission, and MAWS's projects answer `CheckoutSource.known`. The daemon runs in this process with
// the product's options since M5b (`permanentClient`, `spine.wakeOnEvents`, `claimSpine`); the engine host is the built bundle (`out/main/`), spawned by `mawsd` as its own process under
// MAWS_ENGINE_REPLAY=1, whose replay runs no engine; the spine is the services entry, loaded on demand as the seam loads
// it. The endpoint module is a stand-in that keeps the seam it is started with (the real one needs a hub; its use of the
// same seam is process-endpoint.test.ts's). Skipped without a build, as the bundle guard is; class 1a builds first.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { launchDefaults } from '@shared/composer/launch-defaults';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { endHostProcess } from '../../test/support/host-exit';
import { writeReplayEngine } from '../../test/support/replay-engine';
import { writeSpineFixture } from '../../test/support/spine-fixture';
import { readLock } from '../engine-host/supervisor-files';
import { startDaemon, type RunningDaemon } from './daemon';
import type { DaemonServices, EndpointModule } from './endpoint-seam';

const REPO_ROOT = resolve(__dirname, '../..');
const OUT = join(REPO_ROOT, 'out/main');
const MAWSD = join(OUT, 'mawsd.js');
const PERMISSION = join(REPO_ROOT, 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl');
const SESSION = 'app-process-spine' as AppSessionId;
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

// The two host bundles the build emits beside main (`?modulePath`): the pty host's carries node-pty, the engine host's not.
function hostBundles(): { engineHost: string; ptyHost: string } {
  const files = readdirSync(OUT).filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name)).map((name) => join(OUT, name));
  const pty = files.filter((file) => readFileSync(file, 'utf8').includes('node-pty'));
  const engine = files.filter((file) => !pty.includes(file));
  if (pty.length !== 1 || engine.length !== 1) throw new Error(`expected one engine host and one pty host bundle in ${OUT}: ${files.join(', ')}`);
  return { engineHost: engine[0]!, ptyHost: pty[0]! };
}

// The fixture's first recorded human prompt, sent as recorded (the replay holds at it).
function firstPrompt(fixture: string): string {
  for (const line of readFileSync(fixture, 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as { direction: string; frame: { type: string; message?: { content: string } } };
    if (row.direction === 'out' && row.frame.type === 'user') return row.frame.message!.content;
  }
  throw new Error(`${fixture} records no prompt`);
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

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-mps-'))); // the index keeps a project's real directory (/private/var on macOS)
  profile = join(scratch, 'profile');
  mkdirSync(join(scratch, 'home'));
  mkdirSync(join(scratch, 'claude-config'));
  daemon = null;
  logs = [];
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${logs.join('\n')}\n`));
  for (const method of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {}); // the spine's own lines, in this process
});

afterEach(async () => {
  try {
    await daemon?.stop('test over');
    const pid = readLock(join(profile, 'supervisor'))?.pid; // the engine host mawsd woke outlives it, as it does in the product
    if (pid !== undefined) await endHostProcess(pid);
  } finally {
    vi.restoreAllMocks(); // the console back first, so a failure below is heard
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe.skipIf(!existsSync(MAWSD))('the endpoint reaches the machine with no app (acceptance 8, process level)', () => {
  it('lane B events on onEvent, the spine’s records from dispatch(machine), attention.changed with owner machine, and MAWS’s projects as known checkouts', async () => {
    const folders = join(scratch, 'projects');
    await writeSpineFixture({ profile, folders, counts: { sessions: 3, projects: 2, attention: 0, pending: 0, library: 0, drafts: 0, history: 1 } });
    const project = join(folders, 'project-00');
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: join(scratch, 'home'),
      ZDOTDIR: join(scratch, 'home'),
      SMINOS_HOME: join(scratch, 'home'),
      CLAUDE_CONFIG_DIR: join(scratch, 'claude-config'),
      MAWS_USER_DATA: profile,
      MAWS_ENGINE_REPLAY: '1', // the replay transport: no engine runs
      MAWS_E2E: '1',
      MAWS_E2E_ENGINE_BIN: writeReplayEngine(scratch), // a probe of the binary reads this stub's version, never an installed engine
    };

    let services: DaemonServices | null = null;
    const heard: { owner: string; name: string; payload: unknown }[] = [];
    const endpoint: EndpointModule = {
      start: async (seam) => {
        services = seam;
        seam.onEvent((owner, message) => void heard.push({ owner, ...message }));
      },
      stop: async () => {},
      status: () => null,
      enrollment: () => null,
      cli: async () => ({ code: 0, out: '' }),
    };
    const exits: number[] = [];
    daemon = await startDaemon({
      kind: 'private',
      dir: join(profile, 'mawsd'),
      profileDir: profile,
      modules: { self: MAWSD, ...hostBundles() },
      build: { version: '0.0.0-test', commit: 'process-spine', builtAt: '2026-10-29T00:00:00.000Z' },
      env,
      exit: (code) => void exits.push(code),
      openLog: () => (line) => void logs.push(line),
      endpoint,
      // the product's options since M5b (src/mawsd/index.ts): events flow to mawsd with no app, and the spine is the machine's
      permanentClient: true,
      spine: { load: () => import('../services/entry'), wakeOnEvents: true },
      claimSpine: true,
    });
    expect(daemon, `mawsd did not start (exits ${JSON.stringify(exits)})`).not.toBeNull();
    const seam = services as DaemonServices | null;
    if (seam === null) throw new Error('the endpoint was not started');
    const ok = (answer: HostResponse) => {
      if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
      return answer.value;
    };

    // A replayed lane B session, launched through the seam with no app: the request wakes the parked engine host
    expect(ok(await seam.dispatch('engine-host', 'session.launch', { spec: { ...launchDefaults(SESSION, project), replay: PERMISSION } }))).toMatchObject({ status: 'launching' });
    await until(async () => {
      const answer = await seam.dispatch('engine-host', 'session.status', { appSessionId: SESSION });
      return answer.ok && (answer.value as { process?: string }).process === 'ready';
    }, 'the replayed session ready');
    // Its first prompt through the endpoint's machine route: the spine's conversation-act intercept (D44(3)) loads it
    ok(await seam.dispatch('machine', 'session.send', { appSessionId: SESSION, content: firstPrompt(PERMISSION) }));

    // (1) the session's events reach the endpoint with no app attached
    await until(() => heard.some((event) => event.owner === 'engine-host' && event.name === 'session.eventBatch' && (event.payload as { appSessionId?: string }).appSessionId === SESSION), 'a lane B batch on onEvent');
    // (3) its pending permission derives in the spine's attention, which the endpoint hears with owner machine
    await until(
      () => heard.some((event) => event.owner === 'machine' && event.name === 'attention.changed' && (event.payload as { appSessionId?: string; items?: { state?: string }[] }).appSessionId === SESSION && (event.payload as { items: { state?: string }[] }).items.some((item) => item.state === 'pending')),
      'attention.changed with owner machine',
    );
    // (2) the spine's records, through the endpoint's machine route
    const listed = ok(await seam.dispatch('machine', 'session.list', { includeArchived: true })) as { sessions: { appSessionId: string }[] };
    expect(listed.sessions.length).toBeGreaterThanOrEqual(3); // the fixture's
    // (4) MAWS's projects are checkouts the endpoint knows; another directory is not
    expect(daemon!.projects.known(project)).toBe(true);
    expect(daemon!.projects.known(join(scratch, 'elsewhere'))).toBe(false);

    const status = await daemon!.status();
    expect(status.clients.engineHost).toBe(false); // no app, all along
    expect(status.spine).toMatchObject({ state: 'loaded' });
    expect(logs).toContainEqual(expect.stringMatching(/^\[spine\] loaded in \d+ ms$/));
  });
});
