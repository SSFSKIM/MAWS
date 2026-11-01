// `mawsd`'s command line (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6 "The commands"), against the
// daemon in this process (test/support/mawsd-scene.ts: stand-in hosts on real sockets) over its real `machine.sock`, and
// fake unit managers (test/support/fake-units.ts) in a scratch home: what each command prints and exits with, the daemon
// up and down, and the secret-reading commands' path, `enroll`'s and `endpoint provision`'s (stdin or a prompt, never
// argv; sent as `secret`; never logged or printed).
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { readOrMintMachineRef } from '@shared/machine/identity-file';
import { fakePack, packProgram } from '../../test/support/fake-pack';
import { FakeManagers } from '../../test/support/fake-units';
import { MawsdScene, sleep, until } from '../../test/support/mawsd-scene';
import { runCli, sessionHostsLine, type CliDeps } from './cli';
import { LazyEndpoint, NO_ENDPOINT_MODULE, type EndpointModule } from './endpoint-seam';
import { REQUEST_TIMEOUT_MS } from './machine-client';

let scene: MawsdScene;
let managers: FakeManagers;

beforeEach(() => {
  scene = new MawsdScene('maws-cl-');
  managers = new FakeManagers();
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

interface Ran {
  code: number;
  out: string;
  err: string;
}

async function cli(argv: string[], extra: Partial<CliDeps> = {}): Promise<Ran> {
  let out = '';
  let err = '';
  const home = join(scene.root, 'home');
  mkdirSync(home, { recursive: true });
  const code = await runCli(argv, {
    env: { MAWS_USER_DATA: scene.root },
    platform: 'darwin',
    home,
    cwd: scene.root,
    uid: 501,
    user: 'u',
    out: (text) => void (out += text),
    err: (text) => void (err += text),
    stdin: { isTTY: false, read: async () => '', prompt: async () => '' },
    run: managers.run,
    sleep: async () => {},
    now: () => Date.now(),
    self: { runtime: '/opt/maws/node', entry: '/opt/maws/out/main/mawsd.js' },
    build: 'cli-test',
    ...extra,
  });
  return { code, out, err };
}

class FakeEndpoint implements EndpointModule {
  readonly calls: [string, readonly string[], string | undefined][] = [];
  answer = { code: 0, out: 'done' };
  held: Promise<void> | null = null; // when set, every answer waits for it
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  status(): unknown {
    return { enrolled: false };
  }
  enrollment(): null {
    return null;
  }
  async cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }> {
    this.calls.push([command, args, secret]);
    await this.held;
    return this.answer;
  }
}

describe('mawsd status', () => {
  // P5 O16 M2: the engine host's session hosts, under its line when it reports them
  it('names the engine host\'s session hosts, the adopted and the failed among them', () => {
    expect(sessionHostsLine({ hosts: 1, adopted: 0, failed: 0 })).toBe('session hosts  1 (adopted 0, failed 0)');
  });


  it('running: the daemon, its build, its machine ref, profile and role, its hosts, clients and endpoint', async () => {
    const daemon = await scene.start({ role: 'laptop', endpoint: new FakeEndpoint() }); // pinned: the machine's own role depends on its battery
    const { code, out } = await cli(['status']);
    expect(code).toBe(0);
    const engine = scene.lastEngine();
    const lines = out.trimEnd().split('\n');
    expect(lines[0]).toMatch(new RegExp(`^mawsd running · pid ${process.pid} · private · up \\d+s$`));
    expect(lines[1]).toMatch(/^build 0\.0\.0-test test \(built 2026-10-27T00:00:00\.000Z\) · wire 3\.\d+$/);
    expect(lines[2]).toBe(`machine ${daemon.ref}`);
    expect(lines[3]).toBe(`profile ${scene.root} · role laptop`);
    expect(lines[4]).toMatch(new RegExp(`^engine host  ready · pid ${engine.pid} · build \\S+ · \\d+ live$`));
    expect(lines[5]).toBe('pty host     parked');
    expect(lines[6]).toBe('clients      none');
    expect(lines[7]).toBe('endpoint     {"enrolled":false}');
    expect(lines[8]).toBe('render       off'); // P5 O5 M6: no render host runs
  });

  // O16 M5: the engine host's idle release and its gate, read from its own status through machine.sock
  it('running: a release line after the engine host’s, with the gate’s counts (held ones named only when there are any)', async () => {
    const supervisor = (gate: { armed: number; observed: number; unhealthy: number; absent: number } | undefined, role = 'server', idleMs: number | null = 86_400_000) => ({
      mode: 'detached', pid: 1, startedAt: '2026-10-31T00:00:00.000Z', buildId: 'b', protocol: 3, wire: 'w', liveSessions: 2, rows: 2, idleExitMs: null, idleExitAt: null,
      exitWhenIdle: false, socketPath: null, logPath: null, orphansKilled: 0, release: { role, idleMs, ...(gate && { gate }) },
    });
    let answer: unknown = supervisor({ armed: 0, observed: 1, unhealthy: 0, absent: 0 });
    scene.engineSpawn = { answers: { 'host.supervisorStatus': () => answer } };
    await scene.start({ role: 'server' });
    const line = async () => (await cli(['status'])).out.trimEnd().split('\n');
    const lines = await line();
    expect(lines[4]).toMatch(/^engine host {2}ready · pid \d+ · build \S+ · 2 live$/);
    expect(lines[5]).toBe('release      server, 24 h; gate observed 1, armed 0');
    expect(lines[6]).toBe('pty host     parked');
    answer = supervisor({ armed: 1, observed: 1, unhealthy: 2, absent: 3 }, 'laptop', 600_000);
    expect((await line())[5]).toBe('release      laptop, 10 min; gate observed 1, armed 1, unhealthy 2, absent 3');
    answer = supervisor(undefined, 'laptop', null); // an engine host before O16
    expect((await line())[5]).toBe('release      laptop, never');
    answer = null; // one whose status this build cannot read: no line
    expect((await line())[5]).toBe('pty host     parked');
  });

  it('running with no endpoint module (a daemon a test starts with none): the endpoint line is its null detail', async () => {
    await scene.start();
    const { code, out } = await cli(['status']);
    expect(code).toBe(0);
    expect(out.trimEnd().split('\n')[7]).toBe('endpoint     null');
  });

  it('running, --json: the daemon’s status with its machine ref as `machine`', async () => {
    const daemon = await scene.start();
    const { code, out } = await cli(['status', '--json']);
    expect(code).toBe(0);
    const json = JSON.parse(out) as Record<string, unknown>;
    expect(json).toMatchObject({ running: true, pid: process.pid, kind: 'private', machine: daemon.ref, profile: scene.root, unit: null });
  });

  it('stopped: the unit, the log’s path and the machine ref read from the profile, exit 3', async () => {
    const ref = readOrMintMachineRef(scene.root);
    const { code, out } = await cli(['status']);
    expect(code).toBe(3);
    expect(out).toBe(['mawsd not running', 'unit none', `log ${join(scene.root, 'mawsd', 'mawsd.log')}`, `machine ${ref}`, ''].join('\n'));
    expect(managers.calls).toEqual([]); // a profile with no unit asks no manager

    const json = await cli(['status', '--json', '--label', 'dev.maws.mawsd.e2e-5']);
    expect(json.code).toBe(3);
    expect(JSON.parse(json.out)).toEqual({ running: false, unit: { label: 'dev.maws.mawsd.e2e-5', installed: false, loaded: false }, logPath: join(scene.root, 'mawsd', 'mawsd.log'), machine: ref });
  });

  it('stopped, before any ref was minted: machine none', async () => {
    const { code, out } = await cli(['status']);
    expect(code).toBe(3);
    expect(out).toContain('\nmachine none\n');
  });

  it('a mawsd directory that is not private counts as unreachable, saying why', async () => {
    mkdirSync(join(scene.root, 'mawsd'), { recursive: true, mode: 0o755 });
    const { code, err } = await cli(['status']);
    expect(code).toBe(3);
    expect(err).toContain(`${join(scene.root, 'mawsd')} is mode 0755, more open than 0700`);
  });
});

describe('mawsd restart', () => {
  it('a private daemon: daemon.restart, and it exits 75', async () => {
    await scene.start();
    const { code, out } = await cli(['restart']);
    expect(code).toBe(0);
    expect(out).toContain(`asked mawsd (pid ${process.pid}) to restart`);
    await until(() => scene.exits.includes(75), 5_000, 'mawsd to exit 75');
    expect(managers.calls).toEqual([]);
  });

  it('a unit daemon: kickstart -k through launchctl', async () => {
    const label = 'dev.maws.mawsd.e2e-6';
    expect((await cli(['install', '--label', label])).code).toBe(0);
    managers.calls.length = 0;
    const { code, out } = await cli(['restart', '--label', label]);
    expect(code).toBe(0);
    expect(managers.changes()).toEqual([`launchctl kickstart -k gui/501/${label}`]);
    expect(out).toContain(`restarted ${label}`);
  });

  it('nothing running and no unit: exit 3', async () => {
    const { code, err } = await cli(['restart']);
    expect(code).toBe(3);
    expect(err).toContain('mawsd is not running');
  });

  // P5 O16 M3b (D9, D40): the engine host handed over to a successor that adopts its sessions; mawsd stays, a unit too
  it('--engine-host: the engine host hands over, and the successor’s pid and adopted sessions are printed', async () => {
    scene.engineSpawn = {
      answers: {
        'host.handover': () => {
          const old = scene.lastEngine();
          setImmediate(() => void old.supervisor.die());
          return { state: 'detaching' };
        },
        'host.supervisorStatus': () => ({ mode: 'detached', pid: 1, startedAt: 'T', buildId: 'b', protocol: 3, wire: 'w', liveSessions: 3, rows: 3, idleExitMs: null, idleExitAt: null, exitWhenIdle: false, socketPath: null, logPath: null, orphansKilled: 0, holder: { hosts: 3, adopted: 3, failed: 0, gate: null, handover: 'none', adopting: false } }),
      },
    };
    const daemon = await scene.start();
    daemon.hosts.wake('engine-host');
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const old = scene.lastEngine().pid;
    const { code, out } = await cli(['restart', '--engine-host']);
    expect(code).toBe(0);
    expect(scene.lastEngine().pid).not.toBe(old);
    expect(out).toBe(`engine host restarted: pid ${scene.lastEngine().pid}, 3 sessions adopted\n`);
    expect(scene.exits).toEqual([]); // mawsd itself stays
  });

  it('--engine-host deferred: says so and that the successor follows the drain', async () => {
    scene.engineSpawn = { answers: { 'host.handover': () => ({ state: 'deferred', inFlight: 2 }) } };
    const daemon = await scene.start();
    daemon.hosts.wake('engine-host');
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const { code, out } = await cli(['restart', '--engine-host']);
    expect(code).toBe(0);
    expect(out).toBe('the engine host defers its handover: 2 calls in flight; it hands over once they finish, and its successor adopts its sessions\n');
  });

  it('--engine-host with the engine host parked: the refusal, exit 1', async () => {
    await scene.start();
    const { code, err } = await cli(['restart', '--engine-host']);
    expect(code).toBe(1);
    expect(err).toContain('daemon.restartEngineHost failed: engine-host is parked');
  });
});

describe('mawsd logs', () => {
  const write = (path: string, text: string) => {
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(path, text);
  };

  it('prints the three logs from their files, the daemon down, a rotated generation first', async () => {
    const daemonLog = join(scene.root, 'mawsd', 'mawsd.log');
    const engineLog = join(scene.root, 'supervisor', 'host.log');
    write(`${daemonLog}.1`, 'old daemon line\n');
    write(daemonLog, 'daemon line\n');
    write(engineLog, 'engine line\n');
    const { code, out } = await cli(['logs']);
    expect(code).toBe(0);
    expect(out).toBe(
      [`==> ${daemonLog} <==`, 'old daemon line', 'daemon line', '', `==> ${engineLog} <==`, 'engine line', '', `==> ${join(scene.root, 'mawsd', 'pty-host', 'host.log')} (no log yet) <==`, ''].join('\n'),
    );
    const engine = await cli(['logs', '--host', 'engine']);
    expect(engine).toEqual({ code: 0, out: 'engine line\n', err: '' });
    expect((await cli(['logs', '--host', 'kernel'])).code).toBe(1);
  });

  it('a log that cannot be read (not one that is missing) is named with its error, and logs exits 1', async () => {
    const daemonLog = join(scene.root, 'mawsd', 'mawsd.log');
    const engineLog = join(scene.root, 'supervisor', 'host.log');
    mkdirSync(daemonLog, { recursive: true }); // EISDIR, which even root cannot read past
    write(engineLog, 'engine line\n');
    const one = await cli(['logs', '--host', 'daemon']);
    expect(one.code).toBe(1);
    expect(one.err).toMatch(new RegExp(`^cannot read ${daemonLog}: .*EISDIR`));
    const all = await cli(['logs']);
    expect(all.code).toBe(1);
    expect(all.out).toContain(`==> ${daemonLog} (unreadable) <==\n`);
    expect(all.out).toContain('engine line\n');
    expect(all.out).not.toContain(`${daemonLog} (no log yet)`);
  });

  it('--follow ends with exit 1, naming the file, when the file it follows becomes unreadable', async () => {
    const daemonLog = join(scene.root, 'mawsd', 'mawsd.log');
    write(daemonLog, 'first\n');
    let out = '';
    const following = cli(['logs', '--host', 'daemon', '--follow'], {
      out: (text) => void (out += text),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10))),
      follow: { intervalMs: 10, signal: new AbortController().signal },
    });
    await until(() => out === 'first\n', 2_000, 'the first line');
    rmSync(daemonLog);
    mkdirSync(join(daemonLog, 'inside'), { recursive: true }); // a new inode with a size: read from its start, EISDIR
    const ended = await following;
    expect(ended.code).toBe(1);
    expect(ended.err).toMatch(new RegExp(`cannot read ${daemonLog}: .*EISDIR`));
  });

  it('--follow prints what is appended until it is stopped', async () => {
    const daemonLog = join(scene.root, 'mawsd', 'mawsd.log');
    write(daemonLog, 'first\n');
    const stop = new AbortController();
    let out = '';
    const following = cli(['logs', '--host', 'daemon', '--follow'], {
      out: (text) => void (out += text),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10))),
      follow: { intervalMs: 10, signal: stop.signal },
    });
    await until(() => out === 'first\n', 2_000, 'the first line');
    appendFileSync(daemonLog, 'second\n');
    await until(() => out === 'first\nsecond\n', 2_000, 'the appended line');
    renameSync(daemonLog, `${daemonLog}.1`); // a rotation, as openSupervisorLog makes it
    writeFileSync(daemonLog, 'after rotation\n');
    await until(() => out.endsWith('after rotation\n'), 2_000, 'the rotated file');
    stop.abort();
    await expect(following).resolves.toMatchObject({ code: 0 });
  });
});

describe('mawsd enroll, keys and endpoint, with no endpoint module', () => {
  it('enroll reads its code from stdin and answers that there is no endpoint module yet, exit 2', async () => {
    await scene.start();
    const { code, out, err } = await cli(['enroll'], { stdin: { isTTY: false, read: async () => 'CODE-SECRET-1\n', prompt: async () => '' } });
    expect(code).toBe(2);
    expect(err).toBe(`${NO_ENDPOINT_MODULE}\n`);
    expect(`${out}${err}${scene.logs.join('\n')}`).not.toContain('CODE-SECRET-1');
  });

  // Every daemon has the module since P5 O10 M10; one a test starts with none answers each command alike, `keys` too.
  it('keys and any other endpoint command exit 2 with the same line', async () => {
    await scene.start();
    expect(await cli(['keys', '--json'])).toEqual({ code: 2, out: '', err: `${NO_ENDPOINT_MODULE}\n` });
    expect(await cli(['endpoint', 'status'])).toEqual({ code: 2, out: '', err: `${NO_ENDPOINT_MODULE}\n` });
  });

  it('with the daemon down, they exit 3', async () => {
    expect((await cli(['keys'])).code).toBe(3);
    expect((await cli(['endpoint', 'revoke'])).code).toBe(3);
  });
});

describe('mawsd enroll, keys and endpoint, through an endpoint module', () => {
  it('enroll sends its code from piped stdin as `secret`, with its flags; the module’s code and output come back; nothing logs the code', async () => {
    const endpoint = new FakeEndpoint();
    endpoint.answer = { code: 4, out: 'hub confirmed; not yet listed in the org state' };
    await scene.start({ endpoint });
    const { code, out, err } = await cli(['enroll', '--name', 'mini', '--replace', '--wait', '--json'], { stdin: { isTTY: false, read: async () => '  CODE-SECRET-2\n', prompt: async () => 'wrong' } });
    expect(code).toBe(4);
    expect(out).toBe('hub confirmed; not yet listed in the org state\n');
    expect(endpoint.calls).toEqual([['enroll', ['--name', 'mini', '--replace', '--wait', '300', '--json'], 'CODE-SECRET-2']]);
    expect(`${out}${err}${scene.logs.join('\n')}`).not.toContain('CODE-SECRET-2');
  });

  it('enroll at a terminal reads its code from a hidden prompt', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const prompt = vi.fn(async () => 'CODE-SECRET-3');
    const { code } = await cli(['enroll', '--wait', '5'], { stdin: { isTTY: true, read: async () => 'wrong', prompt } });
    expect(code).toBe(0);
    expect(prompt).toHaveBeenCalledOnce();
    expect(endpoint.calls).toEqual([['enroll', ['--wait', '5'], 'CODE-SECRET-3']]);
  });

  it('enroll refuses an argument that is not one of its flags, never echoing it, and sends nothing', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const { code, out, err } = await cli(['enroll', 'CODE-SECRET-4']);
    expect(code).toBe(1);
    expect(`${out}${err}`).not.toContain('CODE-SECRET-4');
    expect(err).toContain('never from the command line');
    expect((await cli(['enroll', '--name'])).code).toBe(1);
    expect((await cli(['endpoint', 'enroll', '--token=CODE-SECRET-5'])).code).toBe(1);
    expect(endpoint.calls).toEqual([]);
  });

  it('enroll with an empty code fails, sending nothing', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    expect((await cli(['enroll'], { stdin: { isTTY: false, read: async () => ' \n', prompt: async () => '' } })).code).toBe(1);
    expect(endpoint.calls).toEqual([]);
  });

  // `endpoint provision` (P5 O14 M1) reads its code as `enroll` does: a `smns-provision-v2.` code carries a delegation's
  // private key and the hub's one-time token, so it is never an argument and never printed.
  it('endpoint provision sends its code from piped stdin as `secret`, with its flags, and nothing logs the code', async () => {
    const endpoint = new FakeEndpoint();
    endpoint.answer = { code: 0, out: 'provisioned: d1_vm in o, certified under the delegation d1' };
    await scene.start({ endpoint });
    const { code, out, err } = await cli(['endpoint', 'provision', '--name', 'd1_vm', '--wait', '--json'], { stdin: { isTTY: false, read: async () => 'PROVISION-SECRET-1\n', prompt: async () => 'wrong' } });
    expect(code).toBe(0);
    expect(out).toBe('provisioned: d1_vm in o, certified under the delegation d1\n');
    expect(endpoint.calls).toEqual([['provision', ['--name', 'd1_vm', '--wait', '300', '--json'], 'PROVISION-SECRET-1']]);
    expect(`${out}${err}${scene.logs.join('\n')}`).not.toContain('PROVISION-SECRET-1');
  });

  it('endpoint provision at a terminal reads its code from a hidden prompt of its own', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const prompt = vi.fn(async () => 'PROVISION-SECRET-2');
    const { code } = await cli(['endpoint', 'provision', '--wait', '5'], { stdin: { isTTY: true, read: async () => 'wrong', prompt } });
    expect(code).toBe(0);
    expect(prompt).toHaveBeenCalledWith('Provisioning code: ');
    expect(endpoint.calls).toEqual([['provision', ['--wait', '5'], 'PROVISION-SECRET-2']]);
  });

  it('endpoint provision refuses what is not one of its flags, `enroll`’s --replace included, never echoing it, and an empty code', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const { code, out, err } = await cli(['endpoint', 'provision', 'smns-provision-v2.PROVISION-SECRET-3']);
    expect(code).toBe(1);
    expect(`${out}${err}`).not.toContain('PROVISION-SECRET-3');
    expect(err).toContain('provision takes --name <name>, --wait [<seconds>] and --json; the provisioning code is read from stdin or a prompt, never from the command line');
    expect((await cli(['endpoint', 'provision', '--replace'])).code).toBe(1);
    expect((await cli(['endpoint', 'provision', '--name'])).code).toBe(1);
    const empty = await cli(['endpoint', 'provision'], { stdin: { isTTY: false, read: async () => ' \n', prompt: async () => '' } });
    expect(empty.code).toBe(1);
    expect(empty.err).toContain('no provisioning code was given');
    expect(endpoint.calls).toEqual([]);
  });

  it('keys and any endpoint command pass through to the module', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    endpoint.answer = { code: 0, out: 'machine x\nkey ed25519:abc (file)' };
    expect(await cli(['keys', '--json'])).toEqual({ code: 0, out: 'machine x\nkey ed25519:abc (file)\n', err: '' });
    endpoint.answer = { code: 1, out: 'refusing its state' };
    expect(await cli(['endpoint', 'policy', '--read-only', 'on'])).toEqual({ code: 1, out: '', err: 'refusing its state\n' });
    expect(endpoint.calls).toEqual([
      ['keys', ['--json'], undefined],
      ['policy', ['--read-only', 'on'], undefined],
    ]);
  });

  // `endpoint revoke|grant <file|->` (P5 O10 M10): the daemon reads a file in its own working directory, not the
  // caller's, and has no stdin of its own, so `-` is read here and sent as the request's `secret`, and a relative path is
  // made the caller's.
  it('endpoint revoke and grant send `-`’s stdin as `secret`', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const state = '{"state":{"version":7}}\n';
    expect((await cli(['endpoint', 'revoke', '-'], { stdin: { isTTY: false, read: async () => state, prompt: async () => 'wrong' } })).code).toBe(0);
    expect((await cli(['endpoint', 'grant', '-'], { stdin: { isTTY: true, read: async () => '{"body":{}}', prompt: async () => 'wrong' } })).code).toBe(0);
    expect(endpoint.calls).toEqual([
      ['revoke', ['-'], state],
      ['grant', ['-'], '{"body":{}}'],
    ]);
  });

  it('endpoint revoke and grant name a file by the caller’s path: a relative one made absolute against its working directory', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    expect((await cli(['endpoint', 'revoke', 'states/next.json'], { cwd: '/home/u/work' })).code).toBe(0);
    expect((await cli(['endpoint', 'grant', '/etc/maws/grant.json'], { cwd: '/home/u/work' })).code).toBe(0);
    expect(endpoint.calls).toEqual([
      ['revoke', ['/home/u/work/states/next.json'], undefined],
      ['grant', ['/etc/maws/grant.json'], undefined],
    ]);
  });

  // `endpoint attest-history` (P5 O14 M4) reads every inventory writer's events from the hub, minutes on a machine with
  // hundreds of writers: its request waits past the 10 s every other endpoint command keeps. Both are held past that
  // default at once, so one wait covers both.
  it('endpoint attest-history waits for the module past the request’s 10 s default; another endpoint command still gives up at 10 s', async () => {
    const endpoint = new FakeEndpoint();
    let release = () => {};
    endpoint.held = new Promise<void>((done) => (release = done));
    endpoint.answer = { code: 0, out: 'verified p/w through 3\n1 verified under mini' };
    await scene.start({ endpoint });
    let attestEnded = false;
    const attesting = cli(['endpoint', 'attest-history', '--check']).finally(() => (attestEnded = true));
    const status = cli(['endpoint', 'status']);
    await until(() => endpoint.calls.length === 2, 5_000, 'both commands to reach the module');
    await sleep(REQUEST_TIMEOUT_MS + 1_500);
    expect(await status).toEqual({ code: 1, out: '', err: `mawsd did not answer daemon.endpoint within ${REQUEST_TIMEOUT_MS / 1000} s\n` });
    expect(attestEnded).toBe(false);
    release();
    expect(await attesting).toEqual({ code: 0, out: 'verified p/w through 3\n1 verified under mini\n', err: '' });
    expect(endpoint.calls).toEqual(expect.arrayContaining([['attest-history', ['--check'], undefined], ['status', [], undefined]]));
  }, 30_000);

  it('endpoint revoke and grant refuse nothing on stdin, and more than one source, sending nothing', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const empty = await cli(['endpoint', 'grant', '-'], { stdin: { isTTY: false, read: async () => ' \n', prompt: async () => '' } });
    expect(empty).toMatchObject({ code: 1, err: expect.stringContaining('no signed grant came on stdin') });
    expect((await cli(['endpoint', 'revoke', 'a.json', 'b.json'])).code).toBe(1);
    expect(endpoint.calls).toEqual([]);
  });
});

// The architect's lever (a) on acceptance 14 (P5 Decision Log 114): on a machine with nothing in its endpoint's state
// directory, a read-only check costs the daemon no module. Each answers as the module would answer it unenrolled
// (test/endpoint/presence.test.ts holds the two byte for byte); a command that needs the module loads it.
describe('mawsd keys and endpoint status, policy, unenrolled: answered without loading the module', () => {
  it('as text and --json, the module never loaded; the first command that needs it loads it', async () => {
    const loaded: FakeEndpoint[] = [];
    const endpoint = new LazyEndpoint('cli-test', async () => ({ createEndpoint: () => (loaded.push(new FakeEndpoint()), loaded.at(-1)!) }));
    const daemon = await scene.start({ endpoint });
    const keys = { code: 0, out: `enrollment: none\nref: ${daemon.ref}\n`, err: '' };
    expect(await cli(['keys'])).toEqual(keys);
    expect(await cli(['endpoint', 'keys'])).toEqual(keys);
    expect(await cli(['keys', '--json'])).toEqual({ code: 0, out: `{"enrollment":"none","ref":"${daemon.ref}","delegated":false}\n`, err: '' });
    expect(await cli(['endpoint', 'status'])).toEqual({ code: 0, out: 'enrollment: none\nhub: not connected; channels: 0 relayed, 0 direct; sminos: not connected\n', err: '' });
    expect(await cli(['endpoint', 'status', '--json'])).toEqual({
      code: 0,
      out: '{"enrollment":"none","hub":{"connected":false},"channels":{"relayed":0,"direct":0},"rl10":{"connected":false},"listener":{"bound":false},"legacyKey":false,"legacyRetired":false,"delegated":false}\n',
      err: '',
    });
    expect(await cli(['endpoint', 'policy'])).toEqual({ code: 0, out: "read-only: no\nceiling: settings (from your settings' defaultMode)\n(the default: no policy is set)\n", err: '' });
    expect(await cli(['endpoint', 'policy', '--json'])).toEqual({ code: 0, out: '{"read_only":false,"ceiling":"settings","source":"default"}\n', err: '' });
    expect(loaded).toEqual([]);
    expect(scene.logs.join('\n')).not.toContain('loading the endpoint');

    expect(await cli(['endpoint', 'policy', '--read-only', 'on'])).toEqual({ code: 0, out: 'done\n', err: '' });
    expect(loaded).toHaveLength(1);
    expect(loaded[0].calls).toEqual([['policy', ['--read-only', 'on'], undefined]]);
    expect(scene.logs.join('\n')).toContain('loading the endpoint for its first command');
    expect(await cli(['keys'])).toEqual({ code: 0, out: 'done\n', err: '' }); // loaded: the module answers
  });
});

describe('mawsd install and uninstall', () => {
  it('installs a LaunchAgent under a label for a non-default profile, idempotently, and uninstalls it', async () => {
    const label = 'dev.maws.mawsd.e2e-7';
    const first = await cli(['install', '--label', label]);
    expect(first.code).toBe(0);
    expect(first.out).toContain(`unit ${label} loaded`);
    const plist = join(scene.root, 'home', 'Library', 'LaunchAgents', `${label}.plist`);
    expect(readFileSync(plist, 'utf8')).toContain('<string>/opt/maws/out/main/mawsd.js</string>');
    managers.calls.length = 0;
    expect((await cli(['install', '--label', label])).out).toContain(`unit ${label} unchanged`);
    expect(managers.changes()).toEqual([]);
    const removed = await cli(['uninstall', '--label', label]);
    expect(removed.code).toBe(0);
    expect(removed.out).toContain(`unit ${label} removed`);
  });

  it('takes the program and runtime paths as arguments', async () => {
    const label = 'dev.maws.mawsd.e2e-8';
    expect((await cli(['install', '--label', label, '--runtime', '/rel/node', '--entry', '/rel/mawsd.js'])).code).toBe(0);
    expect(readFileSync(join(scene.root, 'home', 'Library', 'LaunchAgents', `${label}.plist`), 'utf8')).toContain('<string>/rel/mawsd.js</string>');
    expect((await cli(['install', '--label', label, '--runtime', 'node'])).code).toBe(1); // a relative path
  });

  it('refuses a non-default profile with no label, and a malformed delegation id', async () => {
    const unlabelled = await cli(['install']);
    expect(unlabelled.code).toBe(1);
    expect(unlabelled.err).toContain('--label');
    const malformed = await cli(['install', '--label', 'dev.maws.mawsd.e2e-9', '--delegation-id', 'nope']);
    expect(malformed.code).toBe(1);
    expect(malformed.err).toContain('delegation id');
    expect(managers.calls).toEqual([]);
  });

  it('warns, naming the existing ref and the id, when --delegation-id meets an identity the profile already has; the install still succeeds (O14 residue 9)', async () => {
    const label = 'dev.maws.mawsd.e2e-9';
    const ref = readOrMintMachineRef(scene.root);
    const installed = await cli(['install', '--label', label, '--delegation-id', '0123456789abcdef0123456789abcdef']);
    expect(installed.code).toBe(0);
    expect(installed.out).toContain(`unit ${label} loaded`);
    expect(installed.err).toContain(ref);
    expect(installed.err).toContain('0123456789abcdef0123456789abcdef');
    expect(installed.err).toContain(join(scene.root, 'machine.json'));
    expect((await cli(['install', '--label', label])).err).toBe(''); // no flag, no warning
  });

  it('refuses to install the default profile’s unit for a build that is not packaged, writing nothing', async () => {
    const refused = await cli(['install'], { env: {} }); // the default profile, so dev.maws.mawsd; this CLI runs from /opt/maws/out
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("/opt/maws/out/main/mawsd.js is not inside a packaged app's app.asar");
    expect(managers.calls).toEqual([]);
    const packaged = await cli(['install'], { env: {}, self: { runtime: '/Applications/MAWS.app/Contents/MacOS/MAWS', entry: '/Applications/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js' } });
    expect(packaged.code).toBe(0);
    expect(packaged.out).toContain('unit dev.maws.mawsd loaded');
    const linux = await cli(['install'], { env: {}, platform: 'linux' }); // not a pack
    expect(linux.code).toBe(1);
    expect(linux.err).toContain('/opt/maws/out/main/mawsd.js is not a mawsd release (pnpm mawsd:pack makes one)');
  });

  it('on Linux, installs the pack it runs from as the release directory’s current, and the default unit runs current', async () => {
    const home = join(scene.root, 'home');
    const self = packProgram(fakePack(join(scene.root, 'checkout', 'dist', 'mawsd'), 'a1b2c3d4'));
    const installed = await cli(['install'], { env: {}, platform: 'linux', self });
    expect(installed.code).toBe(0);
    const current = join(home, '.local', 'share', 'maws', 'mawsd', 'current');
    expect(installed.out).toContain(`release 0.0.0-a1b2c3d4 installed as ${current}`);
    expect(installed.out).toContain('unit mawsd.service loaded');
    expect(readFileSync(join(home, '.config', 'systemd', 'user', 'mawsd.service'), 'utf8')).toContain(`ExecStart=${current}/runtime/bin/node --disable-sigusr1 ${current}/out/main/mawsd.js run --unit`);
    expect((await cli(['install'], { env: {}, platform: 'linux', self })).out).toContain('release 0.0.0-a1b2c3d4 is current');
    // the canonical Linux unit always runs its release's own runtime, so naming another is refused
    const named = await cli(['install', '--runtime', '/usr/bin/node'], { env: {}, platform: 'linux', self });
    expect(named.code).toBe(1);
    expect(named.err).toContain('--runtime');
  });

  it('is not available where there is no unit manager', async () => {
    expect((await cli(['install', '--label', 'dev.maws.mawsd.e2e-9'], { platform: 'win32' })).code).toBe(2);
  });
});

// P5 O5 M6 (Interfaces §J): the render runtime's commands, from a pack carrying its pin and the zip beside it (`pnpm
// mawsd:pack --render`); `unzip`, `sudo` and `ldd` faked, the helper's ownership read for real (so here it is never
// root-owned, as on a machine whose sudo cannot set it)
describe('mawsd render', () => {
  const zip = Buffer.from('a zip of electron for linux-x64');
  const sha = createHash('sha256').update(zip).digest('hex');
  const pack = () => {
    const dist = join(scene.root, 'checkout', 'dist', 'mawsd');
    const root = fakePack(dist, 'a1b2c3d4');
    mkdirSync(join(root, 'packaging', 'mawsd'), { recursive: true });
    writeFileSync(join(root, 'packaging', 'mawsd', 'electron.json'), JSON.stringify({ version: '44.4.5', sha256: { [`linux-${process.arch}`]: sha } }));
    writeFileSync(join(dist, `electron-v44.4.5-linux-${process.arch}.zip`), zip);
    return packProgram(root);
  };
  const ran: string[] = [];
  const run: CliDeps['run'] = (command, args, options) => {
    if (command === 'unzip') {
      ran.push(`unzip ${options?.timeoutMs ?? 'default'}`);
      const into = args[args.indexOf('-d') + 1]!;
      for (const name of ['electron', 'chrome-sandbox']) writeFileSync(join(into, name), name);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'sudo' || command === 'ldd') {
      ran.push(`${command} ${args.join(' ')}`);
      return { status: 0, stdout: command === 'ldd' ? '\tlibgtk-3.so.0 => not found\n' : '', stderr: '' };
    }
    return managers.run(command, args);
  };
  const entryName = `44.4.5-${sha.slice(0, 12)}`;
  const renderLock: CliDeps['renderLock'] = async () => () => {}; // a Mac has no flock; the lock's own cases are render-install.test.ts's
  const cacheRoot = () => join(scene.root, 'home', '.local', 'share', 'maws', 'mawsd', 'render');

  it('is Linux’s: on a Mac the app’s own binary renders, so there is nothing to install (exit 2)', async () => {
    const mac = await cli(['render', 'install']);
    expect(mac.code).toBe(2);
    expect(mac.err).toContain('the render runtime is installed on Linux');
  });

  it('status on a machine without the runtime says so, and how to install it', async () => {
    const { code, out } = await cli(['render', 'status'], { platform: 'linux', self: pack(), run });
    expect(code).toBe(0);
    expect(out).toContain(`render runtime 44.4.5 (linux-${process.arch}) · not installed`);
    expect(out).toMatch(/the render service: unavailable: the render runtime 44\.4\.5 is not installed on .*: run mawsd render install/);
  });

  it('install from the pack’s zip unpacks it without a download; with the helper not root-owned it publishes nothing and says so (exit 1)', async () => {
    ran.length = 0;
    const installed = await cli(['render', 'install'], { platform: 'linux', self: pack(), run, renderLock });
    expect(installed.code).toBe(1);
    expect(installed.err).toContain('sandbox missing: setting Chromium\'s sandbox helper needs sudo -n to work for u');
    expect(installed.err).toContain('then run mawsd render install again as u, not as root');
    expect(installed.err).toContain(join(cacheRoot(), `.staged-${entryName}`));
    expect(ran[0]).toBe('unzip 300000');
    expect(ran.filter((line) => line.startsWith('sudo'))).toHaveLength(2);
    const status = await cli(['render', 'status', '--json'], { platform: 'linux', self: pack(), run });
    expect(JSON.parse(status.out)).toMatchObject({ state: 'staged', sandbox: 'not configured', missingLibraries: ['libgtk-3.so.0'], reading: { available: false, reason: expect.stringMatching(/^Chromium’s sandbox is not configured on /) } });
    const removed = await cli(['render', 'uninstall'], { platform: 'linux', self: pack(), run, renderLock });
    expect(removed.code).toBe(0);
    expect(removed.out).toBe(`removed .staged-${entryName}\n`);
  });

  it('takes install, uninstall and status alone', async () => {
    expect((await cli(['render'], { platform: 'linux' })).code).toBe(1);
    expect((await cli(['render', 'frob'], { platform: 'linux' })).code).toBe(1);
    expect((await cli(['render', 'install', '--json'], { platform: 'linux' })).code).toBe(1);
  });
});

describe('the command line itself', () => {
  it('without a command, or with an unknown one, prints its usage and exits 1', async () => {
    const none = await cli([]);
    expect(none.code).toBe(1);
    expect(none.err).toContain('usage: mawsd');
    expect((await cli(['frobnicate'])).code).toBe(1);
  });

  it('takes the profile from --profile (resolved against the working directory), else MAWS_USER_DATA, else the default', async () => {
    const ref = readOrMintMachineRef(join(scene.root, 'elsewhere'));
    const { out } = await cli(['status', '--profile', 'elsewhere']);
    expect(out).toContain(`machine ${ref}`);
    const fallback = await cli(['status'], { env: {} });
    expect(fallback.out).toContain(`log ${join(scene.root, 'home', 'Library', 'Application Support', 'MAWS', 'mawsd', 'mawsd.log')}`);
    expect(fallback.out).toContain('unit dev.maws.mawsd · not installed'); // the default profile's unit
  });
});
