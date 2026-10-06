// The remote runner over a fake spawn (an EventEmitter child whose streams the test drives) and fake timers: what is
// spawned and how, the order and `seq` of the streamed chunks, the 16 KiB split, the 1 MiB cap, cancel and the timeout
// on the process group, one run per checkout, and the latest run during and after. Two cases spawn a real /bin/sh.
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { RemotePlan, ScmRemoteOutput } from '@shared/ipc/schema/scm';
import { CHUNK_BYTES, OUTPUT_CAP_BYTES, RemoteRunner, runCollected, type KillFn, type SpawnFn } from './remote-runner';

const ID = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const TOKEN = '11111111-1111-4111-8111-111111111111';
const OTHER_TOKEN = '22222222-2222-4222-8222-222222222222';
const PID = 4242;

const plan = (over: Partial<RemotePlan> = {}): RemotePlan => ({
  token: TOKEN, kind: 'push', cwd: '/repo', program: '/opt/homebrew/bin/git',
  argv: ['push', '--progress', 'origin', 'refs/heads/main:refs/heads/main'], remote: 'origin', remoteUrl: 'https://github.com/o/r',
  pushUrls: ['https://github.com/o/r'], repository: null, branch: 'main', head: 'abc123', upstream: 'origin/main',
  expiresAt: '2026-10-06T12:05:00.000Z', ...over,
});

const CAPTURED = {
  PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: '/Users/o', SSH_AUTH_SOCK: '/tmp/agent.sock', GIT_SSH_COMMAND: 'ssh -i k',
  GIT_DIR: '/elsewhere/.git', GIT_CONFIG_PARAMETERS: "'core.fsmonitor=true'", GH_REPO: 'someone/else', MAWS_E2E: '1',
  CLAUDE_CODE_SESSION_ID: 'parent',
};

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  constructor(readonly pid: number | undefined = PID) {
    super();
  }
  out(text: string | Buffer) {
    this.stdout.emit('data', typeof text === 'string' ? Buffer.from(text) : text);
  }
  err(text: string | Buffer) {
    this.stderr.emit('data', typeof text === 'string' ? Buffer.from(text) : text);
  }
  close(code: number | null, signal: NodeJS.Signals | null = null) {
    this.emit('close', code, signal);
  }
}

describe('scm remote runner streams with sequence numbers, caps, cancels, times out and keeps the latest run', () => {
  let children: FakeChild[];
  let spawn: ReturnType<typeof vi.fn<SpawnFn>>;
  let kill: ReturnType<typeof vi.fn<KillFn>>;
  let events: ScmRemoteOutput[];
  let onExit: ReturnType<typeof vi.fn<(key: string) => void>>;
  let runner: RemoteRunner;

  const child = () => children[children.length - 1];
  const start = (key = '/repo', over: Partial<RemotePlan> = {}) => runner.start({ appSessionId: ID, key, plan: plan(over), captured: CAPTURED });

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-10-06T12:00:00.000Z') });
    children = [];
    spawn = vi.fn<SpawnFn>(() => {
      children.push(new FakeChild());
      return child() as unknown as ChildProcess;
    });
    kill = vi.fn<KillFn>();
    events = [];
    onExit = vi.fn();
    runner = new RemoteRunner({ emit: (event) => events.push(event), spawn, kill, onExit });
  });
  afterEach(() => {
    runner.dispose();
    vi.useRealTimers();
  });

  it('spawns the plan program and argv in its cwd, in a new group, stdin ignored, no shell, under the remote environment', () => {
    expect(start()).toEqual({ started: true, token: TOKEN });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [program, argv, options] = spawn.mock.calls[0];
    expect(program).toBe('/opt/homebrew/bin/git');
    expect(argv).toEqual(['push', '--progress', 'origin', 'refs/heads/main:refs/heads/main']);
    expect(Object.keys(options).sort()).toEqual(['cwd', 'detached', 'env', 'stdio']);
    expect(options).toMatchObject({ cwd: '/repo', detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(options.env).toMatchObject({
      PATH: CAPTURED.PATH, HOME: '/Users/o', SSH_AUTH_SOCK: '/tmp/agent.sock', GIT_SSH_COMMAND: 'ssh -i k',
      GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GH_PROMPT_DISABLED: '1',
    });
    for (const name of ['GIT_DIR', 'GIT_CONFIG_PARAMETERS', 'GH_REPO', 'MAWS_E2E', 'CLAUDE_CODE_SESSION_ID']) expect(options.env).not.toHaveProperty(name);
  });

  it('streams both outputs in arrival order with seq from 1, then the exit', () => {
    start();
    child().err('Enumerating objects: 3, done.\n');
    child().out('To /o.git\n');
    child().err('   abc..def  main -> main\n');
    child().close(0);
    expect(events).toEqual([
      { appSessionId: ID, token: TOKEN, seq: 1, kind: 'stderr', text: 'Enumerating objects: 3, done.\n' },
      { appSessionId: ID, token: TOKEN, seq: 2, kind: 'stdout', text: 'To /o.git\n' },
      { appSessionId: ID, token: TOKEN, seq: 3, kind: 'stderr', text: '   abc..def  main -> main\n' },
      { appSessionId: ID, token: TOKEN, seq: 4, kind: 'exit', exitCode: 0, signal: null },
    ]);
    expect(onExit).toHaveBeenCalledWith('/repo');
  });

  it('decodes a character split across two data events whole', () => {
    start();
    const bytes = Buffer.from('café\n');
    child().out(bytes.subarray(0, 4)); // 'caf' and the first byte of 'é'
    child().out(bytes.subarray(4));
    child().close(0);
    expect(events.filter((e) => e.kind === 'stdout').map((e) => e.text).join('')).toBe('café\n');
    expect(events.every((e) => !e.text?.includes('�'))).toBe(true);
  });

  it('splits a large write into chunks of at most 16 KiB, never inside a character', () => {
    start();
    const text = 'é'.repeat(20 * 1024); // 40 KiB of two-byte characters
    child().out(text);
    const chunks = events.filter((e) => e.kind === 'stdout');
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) expect(Buffer.byteLength(chunk.text ?? '')).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
    expect(chunks.map((c) => c.seq)).toEqual([1, 2, 3]);
  });

  it('keeps the first MiB, then one truncated chunk, drops the rest and still ends with the exit', () => {
    start();
    const block = 'x'.repeat(256 * 1024);
    for (let i = 0; i < 4; i++) child().out(block);
    child().err('past the cap\n'); // over by one write
    child().out('more\n');
    child().close(1);
    const texts = events.filter((e) => e.text !== undefined).map((e) => e.text).join('');
    expect(Buffer.byteLength(texts)).toBe(OUTPUT_CAP_BYTES);
    const truncated = events.filter((e) => e.truncated === true);
    expect(truncated).toEqual([{ appSessionId: ID, token: TOKEN, seq: expect.any(Number), kind: 'stderr', truncated: true }]);
    expect(events[events.length - 1]).toMatchObject({ kind: 'exit', exitCode: 1 });
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    const last = runner.last('/repo');
    expect(last).toMatchObject({ truncated: true, running: false, exitCode: 1, seq: events.length });
    expect(Buffer.byteLength(last?.output ?? '')).toBe(OUTPUT_CAP_BYTES);
  });

  it('cuts at the cap inside a write and never inside a character', () => {
    start();
    child().out('x'.repeat(OUTPUT_CAP_BYTES - 1));
    child().out('éé'); // the first é would end one byte past the cap
    const kept = events.filter((e) => e.text !== undefined).map((e) => e.text).join('');
    expect(Buffer.byteLength(kept)).toBe(OUTPUT_CAP_BYTES - 1);
    expect(events[events.length - 1]).toMatchObject({ kind: 'stdout', truncated: true });
  });

  it('runs one remote command at a time per checkout', () => {
    expect(start()).toEqual({ started: true, token: TOKEN });
    expect(runner.isRunning('/repo')).toBe(true);
    expect(start('/repo', { token: OTHER_TOKEN })).toMatchObject({ refused: 'busy' });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(start('/other', { token: OTHER_TOKEN })).toEqual({ started: true, token: OTHER_TOKEN });
    children[0].close(0);
    expect(runner.isRunning('/repo')).toBe(false);
    expect(start('/repo', { token: OTHER_TOKEN })).toEqual({ started: true, token: OTHER_TOKEN });
  });

  it('cancel sends SIGTERM to the group, then SIGKILL after 2 s; another token or checkout cancels nothing', () => {
    start();
    runner.cancel('/repo', OTHER_TOKEN);
    runner.cancel('/other', TOKEN);
    expect(kill).not.toHaveBeenCalled();
    runner.cancel('/repo', TOKEN);
    expect(kill).toHaveBeenCalledWith(PID, 'SIGTERM');
    vi.advanceTimersByTime(1999);
    expect(kill).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenLastCalledWith(PID, 'SIGKILL');
    child().close(null, 'SIGTERM');
    expect(events[events.length - 1]).toMatchObject({ kind: 'exit', exitCode: null, signal: 'SIGTERM' });
    runner.cancel('/repo', TOKEN); // ended: nothing more
    vi.advanceTimersByTime(5000);
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it('times out at 120 s: says so, SIGTERM to the group, SIGKILL after 2 s', () => {
    start();
    vi.advanceTimersByTime(119_999);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledWith(PID, 'SIGTERM');
    expect(events[events.length - 1]).toMatchObject({ kind: 'stderr', text: expect.stringContaining('timed out after 120 s') });
    vi.advanceTimersByTime(2000);
    expect(kill).toHaveBeenLastCalledWith(PID, 'SIGKILL');
    child().close(null, 'SIGKILL');
    expect(runner.last('/repo')).toMatchObject({ running: false, exitCode: null, signal: 'SIGKILL' });
  });

  it('a run that ends in time arms no timeout', () => {
    start();
    child().close(0);
    vi.advanceTimersByTime(200_000);
    expect(kill).not.toHaveBeenCalled();
  });

  it('keeps the latest run: null before, running with the seq the next event exceeds, then ended for 10 minutes', () => {
    expect(runner.last('/repo')).toBeNull();
    start();
    child().err('Counting objects\n');
    const during = runner.last('/repo');
    expect(during).toEqual({
      token: TOKEN, kind: 'push', plan: plan(), running: true, exitCode: null, signal: null, output: 'Counting objects\n', truncated: false,
      seq: 1, startedAt: '2026-10-06T12:00:00.000Z',
    });
    child().out('done\n');
    expect(events[events.length - 1].seq).toBeGreaterThan(during?.seq ?? Infinity);
    child().close(0);
    expect(runner.last('/repo')).toMatchObject({ running: false, exitCode: 0, output: 'Counting objects\ndone\n', seq: 3 });
    vi.advanceTimersByTime(10 * 60_000);
    expect(runner.last('/repo')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(runner.last('/repo')).toBeNull();
    expect(runner.last('/other')).toBeNull();
  });

  it('a running run is kept however long it runs, and the next run replaces it', () => {
    start();
    vi.advanceTimersByTime(60_000);
    child().close(0);
    start('/repo', { token: OTHER_TOKEN, kind: 'pr' });
    expect(runner.last('/repo')).toMatchObject({ token: OTHER_TOKEN, kind: 'pr', running: true, output: '', seq: 0 });
  });

  it('a program that cannot start ends the run once, with the reason on stderr', () => {
    spawn.mockImplementationOnce(() => {
      children.push(new FakeChild(undefined));
      return child() as unknown as ChildProcess;
    });
    start();
    child().emit('error', Object.assign(new Error('spawn /opt/homebrew/bin/git ENOENT'), { code: 'ENOENT' }));
    child().close(-2); // Node closes a child that never started too
    expect(events).toEqual([
      { appSessionId: ID, token: TOKEN, seq: 1, kind: 'stderr', text: 'could not start /opt/homebrew/bin/git: spawn /opt/homebrew/bin/git ENOENT\n' },
      { appSessionId: ID, token: TOKEN, seq: 2, kind: 'exit', exitCode: null, signal: null },
    ]);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(runner.isRunning('/repo')).toBe(false);
    runner.cancel('/repo', TOKEN);
    expect(kill).not.toHaveBeenCalled();
  });

  it('dispose stops every run, keeps no latest run and emits nothing after', () => {
    start();
    start('/other', { token: OTHER_TOKEN });
    runner.dispose();
    expect(kill.mock.calls).toEqual([[PID, 'SIGTERM'], [PID, 'SIGTERM']]);
    const count = events.length;
    children[0].out('late\n');
    children[0].close(0);
    expect(events.length).toBe(count);
    expect(runner.last('/repo')).toBeNull();
    expect(runner.isRunning('/repo')).toBe(false);
  });

  it('starts nothing after dispose (a revalidation resolving after will-quit)', () => {
    runner.dispose();
    expect(start()).toMatchObject({ refused: 'busy', detail: expect.stringMatching(/quitting/) });
    expect(spawn).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('a start drops the latest runs of every checkout that ended more than 10 minutes ago', () => {
    const runs = (runner as unknown as { runs: Map<string, unknown> }).runs;
    start('/a');
    child().close(0);
    start('/b', { token: OTHER_TOKEN });
    child().close(0);
    vi.advanceTimersByTime(5 * 60_000);
    start('/c');
    expect([...runs.keys()].sort()).toEqual(['/a', '/b', '/c']);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    start('/d', { token: OTHER_TOKEN });
    expect([...runs.keys()].sort()).toEqual(['/c', '/d']);
  });
});

describe('scm remote runner over a real process', () => {
  const tmp = realpathSync(tmpdir());
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('streams a real child and its exit code, with the remote environment it was given', async () => {
    const events: ScmRemoteOutput[] = [];
    let ended!: () => void;
    const done = new Promise<void>((resolve) => { ended = resolve; });
    const runner = new RemoteRunner({ emit: (event) => events.push(event), onExit: () => ended() });
    runner.start({
      appSessionId: ID, key: tmp, captured: { PATH: '/usr/bin:/bin', GH_REPO: 'x/y' },
      plan: plan({ program: '/bin/sh', argv: ['-c', 'pwd; printf "%s" "${GH_REPO-unset} $GIT_TERMINAL_PROMPT" >&2; exit 3'], cwd: tmp }),
    });
    await done;
    expect(events.filter((e) => e.kind === 'stdout').map((e) => e.text).join('')).toBe(`${tmp}\n`);
    expect(events.filter((e) => e.kind === 'stderr').map((e) => e.text).join('')).toBe('unset 0');
    expect(events[events.length - 1]).toMatchObject({ kind: 'exit', exitCode: 3, signal: null });
    runner.dispose();
  });

  it('cancel stops the whole process group, a grandchild included', async () => {
    const events: ScmRemoteOutput[] = [];
    let ended!: () => void;
    const done = new Promise<void>((resolve) => { ended = resolve; });
    const runner = new RemoteRunner({ emit: (event) => events.push(event), onExit: () => ended() });
    runner.start({ appSessionId: ID, key: tmp, captured: { PATH: '/usr/bin:/bin' }, plan: plan({ program: '/bin/sh', argv: ['-c', 'sleep 30 & echo $!; wait'], cwd: tmp }) });
    let grandchild = 0;
    await vi.waitFor(() => {
      grandchild = Number(events.find((e) => e.kind === 'stdout')?.text?.trim());
      expect(grandchild).toBeGreaterThan(0);
    }, { timeout: 5000 });
    expect(alive(grandchild)).toBe(true);
    runner.cancel(tmp, TOKEN);
    await done;
    expect(events[events.length - 1]).toMatchObject({ kind: 'exit', exitCode: null, signal: 'SIGTERM' });
    await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 5000 }); // gone once launchd reaps the orphan
    runner.dispose();
  });

  it('collects a short command whole: both streams, the exit code, the cwd', async () => {
    const result = await runCollected({
      program: '/bin/sh', argv: ['-c', 'pwd; echo "${GH_REPO-unset}" >&2; exit 4'], cwd: tmp, captured: { PATH: '/usr/bin:/bin', GH_REPO: 'x/y' }, timeoutMs: 10_000,
    });
    expect(result).toEqual({ exitCode: 4, signal: null, stdout: `${tmp}\n`, stderr: 'unset\n', failure: null });
  });

  it('answers a program that cannot start as a failure, not a throw', async () => {
    const result = await runCollected({ program: '/nonexistent/gh', argv: ['--version'], cwd: tmp, captured: { PATH: '/usr/bin' }, timeoutMs: 10_000 });
    expect(result).toMatchObject({ exitCode: null, stdout: '', failure: expect.stringContaining('could not start /nonexistent/gh') });
  });
});

describe('scm collected run times out on the process group', () => {
  afterEach(() => vi.useRealTimers());

  it('SIGTERM at the timeout, SIGKILL 2 s later, answered as a failure with what was printed', async () => {
    vi.useFakeTimers();
    const fake = new FakeChild();
    const kill = vi.fn<KillFn>();
    const pending = runCollected({
      program: '/opt/gh', argv: ['pr', 'view'], cwd: '/repo', captured: {}, timeoutMs: 30_000,
      spawn: () => fake as unknown as ChildProcess, kill,
    });
    fake.err('waiting\n');
    vi.advanceTimersByTime(30_000);
    expect(kill).toHaveBeenCalledWith(PID, 'SIGTERM');
    vi.advanceTimersByTime(2000);
    expect(kill).toHaveBeenLastCalledWith(PID, 'SIGKILL');
    fake.close(null, 'SIGKILL');
    expect(await pending).toEqual({ exitCode: null, signal: 'SIGKILL', stdout: '', stderr: 'waiting\n', failure: 'timed out after 30 s' });
  });
});
