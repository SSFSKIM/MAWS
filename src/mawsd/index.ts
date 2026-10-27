// `mawsd`'s entry (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): `out/main/mawsd.js`, a second input of
// main's electron-vite build, so its `?modulePath` imports of the engine host and the pty host emit the very files
// main's do and one build computes one build id. Run as plain Node (the app binary with ELECTRON_RUN_AS_NODE=1 on a Mac,
// the pinned Node on Linux), spawned with `--disable-sigusr1` and holding a SIGUSR1 listener of its own, as the hosts are.
//
//     mawsd run --unit|--private --dir <profile>/mawsd        with MAWS_USER_DATA=<profile>
//
// M6 adds the command line's other commands here. Exit codes: 0 done, 1 failed, 2 not available here, 3 the lock held
// by another private daemon, 75 a requested restart.
import { format } from 'node:util';
import engineHostPath from '../engine-host/index?modulePath';
import ptyHostPath from '../pty-host/index?modulePath';
import { startDaemon, type RunningDaemon } from './daemon';
import { LOG_ROTATE_BYTES, openSupervisorLog } from '../engine-host/supervisor-log';
import { DAEMON_FILES } from '@shared/daemon/files';
import { parseRun, USAGE, type RunArgs } from './run-args';

function main(argv: readonly string[]): void {
  const [command, ...rest] = argv;
  if (command !== 'run') {
    process.stderr.write(`${command === undefined ? 'mawsd needs a command' : `mawsd has no command ${command}`}\n${USAGE}\n`);
    process.exit(command === undefined ? 1 : 2);
  }
  const args = parseRun(rest);
  if (typeof args === 'string') {
    process.stderr.write(`${args}\n${USAGE}\n`);
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

main(process.argv.slice(2));
