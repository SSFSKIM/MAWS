// `mawsd enroll`'s hidden prompt at a real terminal (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6
// "endpoint, enroll and keys"): the built `out/main/mawsd.js` run under a pty (node-pty) against the daemon in this
// process (test/support/mawsd-scene.ts) with a fake endpoint module behind it. Typed characters are not echoed, the code
// reaches `daemon.endpoint` exactly, and the terminal is raw during the prompt and cooked again once it is answered,
// read with `stty -a` on the pty while the command still waits for the module's answer (Node resets a raw terminal at
// exit by itself, so a read after the exit would not show the prompt's own restore). After ^C the command exits, and
// the terminal is read cooked in the same shell. `mawsd endpoint provision` (P5 O14 M1) reads its code the same way, at
// the prompt and from a pipe, and waits for the module past the request's 10 s default as long as `--wait` lets the
// module wait (provision's own 300 s when it is given none). Skipped without a build, as process.test.ts is.
import { spawnSync } from 'node:child_process';
import { closeSync, constants, existsSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MawsdScene, until } from '../../test/support/mawsd-scene';
import type { EndpointModule } from './endpoint-seam';
import { REQUEST_TIMEOUT_MS } from './machine-client';

const MAWSD = resolve(__dirname, '../../out/main/mawsd.js');
vi.setConfig({ testTimeout: 45_000 });

let scene: MawsdScene;
beforeEach(() => {
  scene = new MawsdScene('maws-cp-');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

class FakeEndpoint implements EndpointModule {
  readonly calls: [string, readonly string[], string | undefined][] = [];
  release: () => void = () => {};
  private readonly held = new Promise<void>((done) => (this.release = done));
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  status(): unknown {
    return null;
  }
  enrollment(): null {
    return null;
  }
  async cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }> {
    this.calls.push([command, args, secret]);
    await this.held; // the command waits for this answer, its terminal readable meanwhile
    return { code: 0, out: 'enrolled' };
  }
}

// `mawsd <command>` in a fresh terminal (its stdin the terminal, or a pipe from `printf` when `piped` is given), then the
// command's exit code and `stty -a`, both read in that terminal. The shell then waits for a line, which `finish` sends
// once DONE is read, so its exit cannot drop the output's tail (Linux's pty does at a child's exit: gate-offload
// Decision Log 20).
function enrollAtTerminal(command = 'enroll', piped?: string) {
  const home = join(scene.root, 'home');
  mkdirSync(home, { recursive: true });
  const mawsd = `${JSON.stringify(process.execPath)} ${JSON.stringify(MAWSD)} ${command}`;
  const script = `${piped === undefined ? mawsd : `printf '%s\\n' ${JSON.stringify(piped)} | ${mawsd}`}; echo "EXIT=$?"; stty -a; echo DONE; read -r _`;
  const pty = spawn('/bin/sh', ['-c', script], {
    name: 'xterm',
    cols: 200,
    rows: 24,
    cwd: scene.root,
    env: { PATH: '/usr/bin:/bin', HOME: home, MAWS_USER_DATA: scene.root, TERM: 'xterm', LC_ALL: 'C', ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }) },
  });
  let output = '';
  pty.onData((data) => void (output += data));
  const exited = new Promise<void>((done) => pty.onExit(() => done()));
  const finish = async () => {
    await until(() => output.includes('DONE'), 15_000, () => `the command's end:\n${output}`);
    pty.write('\r');
    await exited;
  };
  return { pty, output: () => output, finish };
}

// The flags `stty -a` prints, as a set (`echo` or `-echo`, `icanon` or `-icanon` among them, on Linux and macOS alike).
const flagsOf = (text: string) => new Set(text.split(/[\s;]+/));
const cooked = (flags: Set<string>) => flags.has('echo') && flags.has('icanon') && !flags.has('-echo') && !flags.has('-icanon');

// The pty's modes as `stty -a` reads them now, from outside the command
function modesOf(pty: ReturnType<typeof spawn>): Set<string> {
  const fd = openSync((pty as unknown as { ptsName: string }).ptsName, constants.O_RDWR | constants.O_NOCTTY);
  try {
    return flagsOf(spawnSync('stty', ['-a'], { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8' }).stdout);
  } finally {
    closeSync(fd);
  }
}

describe.skipIf(!existsSync(MAWSD))('mawsd enroll at a terminal', () => {
  it('reads the code raw without echoing it, sends it exactly, and puts the terminal back to cooked at Enter', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const run = enrollAtTerminal();
    await until(() => run.output().includes('Enrollment code: '), 15_000, () => `the prompt:\n${run.output()}`);
    const during = modesOf(run.pty);
    expect(during.has('-echo') && during.has('-icanon'), [...during].join(' ')).toBe(true); // the prompt's raw mode
    run.pty.write('CODE-TYPED-SECRET');
    run.pty.write('\r');
    await until(() => endpoint.calls.length === 1, 15_000, () => `the code to arrive:\n${run.output()}`);
    const answered = modesOf(run.pty); // the command still runs, awaiting the module
    expect(cooked(answered), [...answered].join(' ')).toBe(true);
    endpoint.release();
    await run.finish();
    expect(run.output()).not.toContain('CODE-TYPED-SECRET');
    expect(run.output()).toContain('EXIT=0');
    expect(endpoint.calls).toEqual([['enroll', [], 'CODE-TYPED-SECRET']]);
  });

  it('abandons the enrollment at ^C, sending nothing, and leaves the terminal cooked', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const run = enrollAtTerminal();
    await until(() => run.output().includes('Enrollment code: '), 15_000, () => `the prompt:\n${run.output()}`);
    const during = modesOf(run.pty); // raw once the prompt shows, so ^C is a character to the prompt, not a signal
    expect(during.has('-echo') && during.has('-icanon') && during.has('-isig'), [...during].join(' ')).toBe(true);
    run.pty.write('CODE-PART');
    run.pty.write('\x03');
    await run.finish();
    expect(run.output()).not.toContain('CODE-PART');
    expect(run.output()).toContain('EXIT=1');
    expect(endpoint.calls).toEqual([]);
    expect(cooked(flagsOf(run.output().slice(run.output().lastIndexOf('EXIT=')))), run.output()).toBe(true);
  });
});

// Longer than the request's default deadline, so an answer only arrives if the command stretched it.
const PAST_DEFAULT_MS = REQUEST_TIMEOUT_MS + 1_500;

describe.skipIf(!existsSync(MAWSD))('mawsd endpoint provision at a terminal', () => {
  it('reads the code at a hidden prompt of its own, sends it exactly, and waits past the default deadline under --wait', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const run = enrollAtTerminal('endpoint provision --wait 30');
    await until(() => run.output().includes('Provisioning code: '), 15_000, () => `the prompt:\n${run.output()}`);
    const during = modesOf(run.pty);
    expect(during.has('-echo') && during.has('-icanon'), [...during].join(' ')).toBe(true);
    run.pty.write('smns-provision-v2.TYPED-SECRET');
    run.pty.write('\r');
    await until(() => endpoint.calls.length === 1, 15_000, () => `the code to arrive:\n${run.output()}`);
    await new Promise((done) => setTimeout(done, PAST_DEFAULT_MS));
    expect(run.output()).not.toContain('EXIT='); // still waiting for the module, past the 10 s a request gets by default
    endpoint.release();
    await run.finish();
    expect(run.output()).not.toContain('TYPED-SECRET');
    expect(run.output()).toContain('EXIT=0');
    expect(endpoint.calls).toEqual([['provision', ['--wait', '30'], 'smns-provision-v2.TYPED-SECRET']]);
  });

  it('reads the code from a pipe, and with no --wait still waits as long as the module may (300 s)', async () => {
    const endpoint = new FakeEndpoint();
    await scene.start({ endpoint });
    const run = enrollAtTerminal('endpoint provision --json', 'smns-provision-v2.PIPED-SECRET');
    await until(() => endpoint.calls.length === 1, 15_000, () => `the code to arrive:\n${run.output()}`);
    await new Promise((done) => setTimeout(done, PAST_DEFAULT_MS));
    expect(run.output()).not.toContain('EXIT=');
    endpoint.release();
    await run.finish();
    expect(run.output()).not.toContain('Provisioning code: '); // a pipe is read, not prompted for
    expect(run.output()).toContain('EXIT=0');
    expect(endpoint.calls).toEqual([['provision', ['--json'], 'smns-provision-v2.PIPED-SECRET']]);
  });
});
