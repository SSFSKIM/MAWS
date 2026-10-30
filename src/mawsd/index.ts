// `mawsd`'s entry (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): `out/main/mawsd.js`, a second input of
// main's electron-vite build, so its `?modulePath` imports of the engine host and the pty host emit the very files
// main's do and one build computes one build id. Run as plain Node (the app binary with ELECTRON_RUN_AS_NODE=1 on a Mac,
// the pinned Node on Linux), spawned with `--disable-sigusr1` and holding a SIGUSR1 listener of its own, as the hosts are.
//
//     mawsd run --unit|--private --dir <profile>/mawsd        with MAWS_USER_DATA=<profile>
//
// Every other command is the command line's (cli.ts, P5 O2 M6), given this process's facts here. The daemon's exit
// codes: 0 done, 1 failed, 3 the lock held by another private daemon, 75 a requested restart; the command line's: 0
// done, 1 failed, 2 not available here, 3 not running, 4 enrolled with the hub but not yet listed in the org state.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { format } from 'node:util';
import engineHostPath from '../engine-host/index?modulePath';
import ptyHostPath from '../pty-host/index?modulePath';
import { startDaemon, type RunningDaemon } from './daemon';
import { LOG_ROTATE_BYTES, openSupervisorLog } from '../engine-host/supervisor-log';
import { DAEMON_FILES } from '@shared/daemon/files';
import { buildIdOf } from '../engine-host/supervisor-files';
import { nodeFloorProblem } from './node-floor';
import { parseRun, USAGE, type RunArgs } from './run-args';

function main(argv: readonly string[]): void {
  const [command, ...rest] = argv;
  if (command !== 'run') return void commandLine(argv);
  const args = parseRun(rest);
  if (typeof args === 'string') {
    process.stderr.write(`${args}\n${USAGE}\n`);
    process.exit(1);
  }
  // P5 O2 M8: a unit's runtime is named by a file that outlives the build that wrote it; a private daemon runs the app's
  // own binary as Node, whose Node the app's build pins
  const belowFloor = args.kind === 'unit' ? nodeFloorProblem(process.versions.node) : null;
  if (belowFloor) {
    process.stderr.write(`${belowFloor} (${process.execPath})\n`);
    process.exit(1);
  }
  const profileDir = process.env.MAWS_USER_DATA;
  if (!profileDir) {
    process.stderr.write(`mawsd needs MAWS_USER_DATA, the profile it serves\n${USAGE}\n`);
    process.exit(1);
  }
  run(args, profileDir);
}

function run({ kind, dir }: RunArgs, profileDir: string): void {
  // Socket peer authentication (cua spec 2026-10-09-maws-socket-peer-auth-design.md): a same-user SIGUSR1 would open a
  // Node inspector in a process that reaches every session and terminal; a listener of its own keeps Node from it.
  process.on('SIGUSR1', () => {});
  let daemon: RunningDaemon | null = null;
  let log: (line: string) => void = (line) => void process.stderr.write(`${line}\n`);
  let signalled = false;
  const fatal = (error: unknown) => {
    log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    if (daemon) void daemon.stop('fatal', 1);
    else process.exit(1);
  };
  process.on('uncaughtException', fatal);
  // A stray rejection is logged, not fatal: the daemon outlives a bug in one request.
  process.on('unhandledRejection', (reason) => log(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`));
  process.on('SIGTERM', () => {
    signalled = true;
    if (daemon) void daemon.stop('signal', 0);
  });
  startDaemon({
    kind,
    dir,
    profileDir,
    modules: { self: process.argv[1], engineHost: engineHostPath, ptyHost: ptyHostPath },
    build: { version: __MAWS_VERSION__, ...__MAWS_BUILD__ },
    env: process.env,
    exit: (code) => process.exit(code),
    // P5 O3-D M5b (D34, D41(1), D47): the cutover, four switches in one step with the app's `machine.spine`
    // (PEER_CAPABILITIES.app): the engine host's permanent client, the spine's event trigger, and the refusal of an app
    // that runs a spine of its own with the yield to one from before O3-A
    permanentClient: true,
    spine: { wakeOnEvents: true },
    claimSpine: true,
    openLog: (at) => {
      const opened = openSupervisorLog(at, LOG_ROTATE_BYTES, DAEMON_FILES.log);
      log = opened;
      routeConsole(opened); // the supervisor core's lines (and any stray one) go to the log, which rotates
      return opened;
    },
  }).then((started) => {
    daemon = started;
    if (started && signalled) void started.stop('signal', 0); // the signal landed during the start
  }, fatal);
}

function routeConsole(log: (line: string) => void): void {
  const to =
    (prefix: string) =>
    (...args: unknown[]) =>
      log(`${prefix}${format(...args)}`);
  console.log = to('');
  console.info = to('');
  console.debug = to('debug: ');
  console.warn = to('warn: ');
  console.error = to('error: ');
}

function commandLine(argv: readonly string[]): void {
  const stop = new AbortController(); // an interrupt ends a `logs --follow` as done; any other command it ends at once
  if (argv.includes('logs') && argv.includes('--follow')) for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());
  const self = process.argv[1]!;
  // The command line is loaded at its first use: a daemon (`run`) never needs it, so its graph (cli.ts, install.ts,
  // release.ts, machine-client.ts, units/) stays out of the daemon's heap
  void import('./cli').then(({ runCli }) => runCli(argv, {
    env: process.env,
    platform: process.platform,
    home: homedir(),
    cwd: process.cwd(),
    uid: process.getuid?.() ?? -1,
    user: userInfo().username,
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    stdin: { isTTY: process.stdin.isTTY === true, read: readStdin, prompt: hiddenPrompt },
    run: (command, args) => {
      const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
      return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? (result.error ? String(result.error) : '') };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    self: { runtime: process.execPath, entry: realpathSync(self) },
    build: buildIdOf(self),
    follow: { signal: stop.signal },
  })).then((code) => {
    process.exitCode = code;
    setTimeout(() => process.exit(code), 2_000).unref(); // should a handle outlive the command
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.once('error', reject);
  });
}

// A line read from the terminal with nothing echoed (the enrollment code); ^C abandons it.
function hiddenPrompt(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    const finish = (then: () => void) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      then();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') return finish(() => resolve(value));
        if (char === '\u0003') return finish(() => reject(new Error('the enrollment was abandoned')));
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char;
      }
    };
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
  });
}

main(process.argv.slice(2));
