// The lock a deployment tool holds for a whole run (O11 M3's reviews: two access-sync runs that overlap, an operator's
// retry beside a slow run, could each read the checkpoint, and the older could finish last). A file beside the state it
// guards, created only if absent, naming the process that holds it; any lock already there, its process gone or not,
// refuses the run before it starts, until the operator removes it. A run ended by a signal (an `admin pair` interrupted in
// its wait, its terminal closed) removes its own lock before it exits. Run in a temporary directory.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withRunLock } from '../../deploy/run-lock.ts';

let dir: string;
let lock: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'desk-hub-lock-'));
  lock = join(dir, 'state', 'desk-hub-test.json.lock');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The lock as another run left it. */
const heldBy = (holder: { pid: number; host: string }) => {
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, `${JSON.stringify({ at: new Date().toISOString(), token: 'theirs', ...holder })}\n`);
};
/** The pid of a process that has exited. */
const exited = () => spawnSync(process.execPath, ['-e', '']).pid;

const deploy = (file: string) => pathToFileURL(join(import.meta.dirname, '../../deploy', file)).href;
/** Node running `source` as a module, the deployment's own modules importable from it as the command loads them. */
const nodeArgs = (source: string) => ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--input-type=module', '-e', source];
/** A run in another process holding `lock` until it is signalled: it prints `held` once the lock is its. */
const holding = (lock: string) =>
  `import { withRunLock } from ${JSON.stringify(deploy('run-lock.ts'))};
await withRunLock(${JSON.stringify(lock)}, () => { process.stdout.write('held\\n'); setInterval(() => {}, 1000); return new Promise(() => {}); });`;

/** Starts `source` in a child, waits for its `held`, runs `then`, and resolves with how the child ended (bounded). */
async function signalled(source: string, signal: NodeJS.Signals, then: () => void = () => {}, stdin: 'ignore' | 'pipe' = 'ignore'): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  // With `stdin: 'pipe'` the child's stdin is a pipe this side holds open and never writes to.
  const child = spawn(process.execPath, nodeArgs(source), { stdio: [stdin, 'pipe', 'inherit'] });
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once('exit', (code, sig) => resolve({ code, signal: sig })));
  try {
    await new Promise<void>((resolve, reject) => {
      let seen = '';
      child.stdout!.on('data', (chunk: Buffer) => (seen += chunk.toString()).includes('held') && resolve());
      void ended.then(() => reject(new Error(`the child ended before it held the lock: ${seen}`)));
    });
    then();
    child.kill(signal);
    return await Promise.race([ended, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still running 10 s after ${signal}`)), 10_000))]);
  } finally {
    child.kill('SIGKILL');
  }
}

describe('the run lock', () => {
  it('is held, naming this process, for the length of the run, and released after it, though the run throws', async () => {
    const seen = await withRunLock(lock, async () => JSON.parse(readFileSync(lock, 'utf8')) as { pid: number; host: string });
    expect(seen).toMatchObject({ pid: process.pid, host: hostname() });
    expect(existsSync(lock)).toBe(false);
    await expect(withRunLock(lock, async () => Promise.reject(new Error('the run failed')))).rejects.toThrow('the run failed');
    expect(existsSync(lock)).toBe(false);
  });

  it('refuses a second run while a run in this process holds it', async () => {
    let finish!: () => void;
    const first = withRunLock(lock, () => new Promise<string>((resolve) => (finish = () => resolve('first'))));
    let ran = false;
    await expect(withRunLock(lock, async () => (ran = true))).rejects.toThrow(/another run holds/);
    expect(ran).toBe(false);
    finish();
    expect(await first).toBe('first');
    expect(await withRunLock(lock, async () => 'after')).toBe('after');
  });

  it('refuses a run while another live process on this host holds it, and leaves its lock', async () => {
    heldBy({ pid: process.ppid, host: hostname() });
    let ran = false;
    const refusal = withRunLock(lock, async () => (ran = true));
    await expect(refusal).rejects.toThrow(new RegExp(`another run holds .*pid ${process.ppid} on .*: wait for it, or remove the file once no run is going$`));
    expect(ran).toBe(false);
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toMatchObject({ pid: process.ppid, token: 'theirs' });
  });

  it('refuses a lock whose process is gone, saying it is gone, until the operator removes it', async () => {
    const gone = exited();
    heldBy({ pid: gone, host: hostname() });
    let ran = false;
    const refusal = withRunLock(lock, async () => (ran = true));
    await expect(refusal).rejects.toThrow(new RegExp(`another run holds ${lock.replaceAll('.', '\\.')} \\(pid ${gone} on ${hostname()}, since `));
    await expect(refusal).rejects.toThrow(`: pid ${gone} on ${hostname()} is gone: remove the file once you've checked no run is going`);
    expect(ran).toBe(false);
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toMatchObject({ pid: gone, token: 'theirs' });
    rmSync(lock);
    expect(await withRunLock(lock, async () => JSON.parse(readFileSync(lock, 'utf8')) as { pid: number })).toMatchObject({ pid: process.pid });
    expect(existsSync(lock)).toBe(false);
  });

  it('refuses a lock taken on another host, whose process it cannot see', async () => {
    heldBy({ pid: exited(), host: 'another-host' });
    await expect(withRunLock(lock, async () => 'ran')).rejects.toThrow(/another run holds .*another-host.*: wait for it, or remove the file once no run is going$/);
    expect(existsSync(lock)).toBe(true);
  });
});

describe('a run ended by a signal', () => {
  it.each(['SIGINT', 'SIGHUP', 'SIGTERM'] as const)('removes its lock at %s and exits 128 plus the signal number', async (signal) => {
    expect(await signalled(holding(lock), signal)).toEqual({ code: 128 + constants.signals[signal], signal: null });
    expect(existsSync(lock)).toBe(false);
  });

  it('leaves a lock that is no longer its own', async () => {
    // Its lock removed by hand under it, and another run's taken in its place.
    const ended = await signalled(holding(lock), 'SIGINT', () => heldBy({ pid: process.pid, host: hostname() }));
    expect(ended).toEqual({ code: 130, signal: null });
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toMatchObject({ pid: process.pid, token: 'theirs' });
  });

  it('gives the process its own signal behaviour back once the run ends', async () => {
    const before = ['SIGINT', 'SIGHUP', 'SIGTERM'].map((s) => process.listenerCount(s));
    const during = await withRunLock(lock, async () => ['SIGINT', 'SIGHUP', 'SIGTERM'].map((s) => process.listenerCount(s)));
    expect(during).toEqual(before.map((n) => n + 1));
    expect(['SIGINT', 'SIGHUP', 'SIGTERM'].map((s) => process.listenerCount(s))).toEqual(before);
    await expect(withRunLock(lock, async () => Promise.reject(new Error('the run failed')))).rejects.toThrow('the run failed');
    expect(['SIGINT', 'SIGHUP', 'SIGTERM'].map((s) => process.listenerCount(s))).toEqual(before);
  });

  it('ends, with no handler left, as the signal ends it once the run is over', async () => {
    const source = `import { withRunLock } from ${JSON.stringify(deploy('run-lock.ts'))};
await withRunLock(${JSON.stringify(lock)}, async () => {});
process.stdout.write('held\\n');
setInterval(() => {}, 1000);`;
    expect(await signalled(source, 'SIGTERM')).toEqual({ code: null, signal: 'SIGTERM' });
  });
});

// The owner's prompt, as `admin pair` asks at /dev/tty with the lock held: a signal there ends the run at once, a byte
// never typed, and the lock goes with it. The terminal is a pty this test owns (python's pty; no hub is reached).
const PTY = `import json, os, pty, select, signal, sys, time
how, argv = sys.argv[1], sys.argv[2:]
pid, master = pty.fork()
if pid == 0:
    os.execv(argv[0], argv)
def drain(seconds):
    seen, end = b'', time.time() + seconds
    while time.time() < end:
        if select.select([master], [], [], 0.05)[0]:
            try: seen += os.read(master, 4096)
            except OSError: break
        if b'READY' in seen: break
    return seen
shown = b''
def reap(seconds):
    global shown
    end = time.time() + seconds
    while time.time() < end:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done == pid: return status
        if how == 'hangup': time.sleep(0.05)
        else: shown += drain(0.05)
    return None
if b'READY' not in drain(20):
    os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0); print(json.dumps({'ended': 'never asked'})); sys.exit()
# The prompt is waiting, as the owner's would be: a hangup before its first read would be read as the end of input
# before the loop ever saw the SIGHUP.
time.sleep(0.3)
if how == 'hangup': os.close(master)
elif how == 'ctrl-c': os.write(master, b'\\x03')
elif how == 'type': os.write(master, b'yes\\nmore\\n')
else: os.kill(pid, getattr(signal, how))
status = reap(5)
if status is None:
    os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0); print(json.dumps({'ended': 'still at the prompt 5 s after the signal'})); sys.exit()
print(json.dumps({'ended': f'exit {os.WEXITSTATUS(status)}' if os.WIFEXITED(status) else f'signal {os.WTERMSIG(status)}', 'shown': shown.decode(errors='replace')}))`;

describe.skipIf(spawnSync('python3', ['-c', 'import pty']).status !== 0)('a run ended by a signal at the owner’s prompt', () => {
  /** A run asking at the deployment's terminal (/dev/tty), or at the local hub's (stdin and stdout). */
  const asking = (lock: string, deployment = true) =>
    `import { withRunLock } from ${JSON.stringify(deploy('run-lock.ts'))};
import { openTerminal } from ${JSON.stringify(deploy('terminal.ts'))};
await withRunLock(${JSON.stringify(lock)}, async () => {
  const terminal = openTerminal(${deployment});
  terminal.write('approve? READY\\n');
  const first = await terminal.readLine();
  const second = await terminal.readLine();
  terminal.write(\`read \${JSON.stringify([first, second])}\\n\`);
});`;
  const atPrompt = (how: string, deployment = true) => {
    const r = spawnSync('python3', ['-I', '-c', PTY, how, process.execPath, ...nodeArgs(asking(lock, deployment))], { encoding: 'utf8', timeout: 30_000 });
    return JSON.parse(r.stdout) as { ended: string; shown?: string };
  };

  it('reads each line the owner types, byte by byte, and releases the lock as the run ends', () => {
    const { ended, shown } = atPrompt('type');
    expect(ended).toBe('exit 0');
    expect(shown).toContain('read ["yes","more"]');
    expect(existsSync(lock)).toBe(false);
  });

  it.each([
    ['SIGINT', 'exit 130'],
    ['ctrl-c', 'exit 130'],
    ['SIGHUP', 'exit 129'],
    ['SIGTERM', 'exit 143'],
    ['hangup', 'exit 129'],
  ])('ends at %s while the prompt waits for a line, removing its lock', (how, ended) => {
    expect(atPrompt(how).ended).toBe(ended);
    expect(existsSync(lock)).toBe(false);
  });

  // At the local hub the prompt is stdin's: a terminal there (the pty) as an operator runs it by hand.
  it('reads each line typed at the local hub’s terminal', () => {
    const { ended, shown } = atPrompt('type', false);
    expect(ended).toBe('exit 0');
    expect(shown).toContain('read ["yes","more"]');
    expect(existsSync(lock)).toBe(false);
  });

  it.each([
    ['SIGINT', 'exit 130'],
    ['ctrl-c', 'exit 130'],
    ['SIGTERM', 'exit 143'],
    ['hangup', 'exit 129'],
  ])('ends at %s while the local hub’s terminal prompt waits, removing its lock', (how, ended) => {
    expect(atPrompt(how, false).ended).toBe(ended);
    expect(existsSync(lock)).toBe(false);
  });
});

// A pipe or a file on the local hub's stdin is read as it always was, with a blocking read of fd 0, byte by byte: what
// follows the line stays on the descriptor for the next reader, and no flag of the description it shares changes. The
// accepted limit: a signal while the prompt waits on an empty pipe is handled once input comes.
describe('the local hub’s prompt on a pipe', () => {
  /**
   * A run holding the lock that reads `lines` answers from stdin, printing `held` first and each line after it; then
   * whether stdin's open file description is non-blocking (python's F_GETFL, when `flags`), and what a `cat` that
   * inherits fd 0 reads after it.
   */
  const reading = (lock: string, lines: number, flags = false) =>
    `import { spawnSync } from 'node:child_process';
import { withRunLock } from ${JSON.stringify(deploy('run-lock.ts'))};
import { openTerminal } from ${JSON.stringify(deploy('terminal.ts'))};
await withRunLock(${JSON.stringify(lock)}, async () => {
  const terminal = openTerminal(false);
  process.stdout.write('held\\n');
  for (let i = 0; i < ${lines}; i++) process.stdout.write(\`line \${JSON.stringify(await terminal.readLine())}\\n\`);
  // The command goes on to its requests after an answer: a turn of the event loop.
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (${flags}) process.stdout.write(\`nonblocking \${spawnSync('python3', ['-I', '-c', 'import fcntl, os; print(fcntl.fcntl(0, fcntl.F_GETFL) & os.O_NONBLOCK != 0)'], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' }).stdout.trim()}\\n\`);
  const rest = spawnSync('cat', { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' }).stdout;
  process.stdout.write(\`rest \${JSON.stringify(rest)}\\n\`);
});`;

  it('reads line by line, leaving what follows on the descriptor for the next reader', () => {
    const r = spawnSync(process.execPath, nodeArgs(reading(lock, 2)), { input: 'yes\nno\nthe next reader\nof it', encoding: 'utf8', timeout: 20_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('held\nline "yes"\nline "no"\nrest "the next reader\\nof it"\n');
    // Input that ends before a newline is the last line; after the end, a line is empty.
    const short = spawnSync(process.execPath, nodeArgs(reading(lock, 2)), { input: 'y', encoding: 'utf8', timeout: 20_000 });
    expect(short.stdout).toBe('held\nline "y"\nline ""\nrest ""\n');
    expect(existsSync(lock)).toBe(false);
  });

  it.skipIf(spawnSync('python3', ['-c', 'import fcntl']).status !== 0)('leaves the description it shares blocking', () => {
    const r = spawnSync(process.execPath, nodeArgs(reading(lock, 1, true)), { input: 'yes\nmore\n', encoding: 'utf8', timeout: 20_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('held\nline "yes"\nnonblocking False\nrest "more\\n"\n');
  });

  it('handles a signal at a prompt on an empty pipe at the turn of the loop after input comes, removing its lock', async () => {
    const child = spawn(process.execPath, nodeArgs(reading(lock, 1)), { stdio: ['pipe', 'pipe', 'inherit'] });
    const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once('exit', (code, sig) => resolve({ code, signal: sig })));
    try {
      await new Promise<void>((resolve) => {
        let seen = '';
        child.stdout.on('data', (chunk: Buffer) => (seen += chunk.toString()).includes('held') && resolve());
      });
      child.kill('SIGTERM');
      const early = await Promise.race([ended, new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 500))]);
      expect(early).toBe('waiting');
      expect(existsSync(lock)).toBe(true);
      child.stdin.end('no\n');
      expect(await Promise.race([ended, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still running 10 s after the input')), 10_000))])).toEqual({ code: 143, signal: null });
      expect(existsSync(lock)).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  });
});
