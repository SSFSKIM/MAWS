// The live bench's runner (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7's "The live bench" and
// its Decision Log entries of 2026-11-02): what the live mode of e2e/remote-latency.spec.ts does on one bench machine (the
// mini's `mini-bench`, the acceptance VM's `vm-bench`) before and after it measures, every remote step through the
// machine's transport and every process through one injected command runner, so test/support/remote-bench.test.ts proves
// it with fakes and nothing here reaches a machine on its own.
//
// Per machine, from its inputs (`BenchMachine`): a scratch `mawsd` from M7's head with its own profile, label and port,
// never the default profile, the label `dev.maws.mawsd`, `mawsd install` or ~/.local/bin/mawsd:
//   0. prepare-vm (the VM, before the sitting, since it loads the VM whose production mawsd serves the sitting): this
//      checkout's source at the commit (`buildSourceArchive`, `git archive`: no clone or fetch there, whose GitHub
//      credential the scratch environment never holds) unpacked into `head`, installed from the registry, node-pty's
//      spawn-helper made executable, packed there; the commit recorded last, so a rerun at it does nothing;
//   1. stage: on the VM the prepared pack's mawsd started detached, its own pid recorded; on the mini, the runner copies
//      this Mac's head bundle (`buildHeadBundle`: the pack of this checkout at the commit, the stub and its fixtures) as
//      a tarball over the same ssh and unpacks it into `head`, once the MAWS binary's Electron is the bundle's and the
//      volume has room (`stageHead: 'present'`: mini-ops put it there); then mini-ops starts the daemon under the
//      production mawsd's runtime, the MAWS binary run as Node as production runs it (no firewall dialog for a new
//      binary), and the runner prints that command and waits until it answers;
//   2. the bench agent (test/support/remote-bench-agent.ts, bundled here and copied over): it writes the latency stub's
//      wrapper and the scratch engine store's trust first (`prepare`, before the daemon starts), then (`serve`) starts
//      the stub's session over the scratch machine.sock and, once told the owner's member, lists it through the
//      harness's fake sminos on the scratch RL10 socket (e2e:remote's pattern), streaming the stub's samples back;
//   3. enroll: the code file streamed by its descriptor into `<transport> '<mawsd> enroll --profile … --label … --name
//      <name> --json'` (mawsd reads stdin without a TTY; no `--wait`, so it returns once the machine has posted its key),
//      the code file removed whatever the outcome; the machine's key id shown as soon as `keys` reads it (its flat
//      answer's `keyId`), for the owner to compare with their terminal's before they type y; exit 4 then waited out by
//      asking `endpoint sync` (the org state read now, the listing promoted) until org-listed, within the code's TTL of
//      the key shown;
//   4. teardown, on every path: the agent ended (its stdin's end stops its session and ends its stubs; killed when it
//      outlives that, its exit waited for), then the watch; on the VM the daemon stopped by its pid once that pid is
//      shown to be the daemon's (registered before its launch: no pid recorded is unverified), on the mini mini-ops'
//      stop said and the daemon's absence waited for; then, on both, its hosts told to exit through their own sockets,
//      any process still naming the profile ended by its pid and start time, and the process check; every step
//      attempted, the first failure thrown; the profile kept until the bench is done (`removeProfile`), so a rerun
//      reuses the enrollment, and then removed only once the same end leaves no process on the machine naming it (pgrep,
//      failing closed; on the mini, once mini-ops has stopped its daemon), else refused and kept.
//
// One status client per run (M10): from the stage's start, every read of the daemon's state (whether it answers, its
// enrollment, its key, the listing) is a line to the agent's `watch`, one runtime holding one machine.sock link for the
// run, rather than a fresh ssh and a fresh MAWS runtime per poll (attempt 2's 25 machine.sock clients in five minutes).
//
// The machine's bounds (the desk track's conditions of 2026-11-02): every command writes and opens only under the
// scratch profile (normalized and strictly under the machine's scratch root, its path checked for symlinks before any
// write), the head checkout included, every program in the profile's scratch environment (home, temporary directory,
// XDG directories, stores and caches there, inherited overrides unset: `profileEnv`, `envLine`); the runtime it runs on
// (on the mini the production mawsd's) is only run, never written; no `claude` runs (the daemon's engine under MAWS_E2E
// is MAWS_E2E_ENGINE_BIN alone) and no sminos; every remote command has a timeout, and none reaches a machine inside a
// quiet window or the margin before it (the mini's 06:45 to 07:00 UTC always, a machine's own beside it), nor one that
// would run into it (an enroll's wait, a serve's span), refused before it starts; a serve that is running then is ended
// with its cleanup before the window.
//
// Secrets: a code is never read into this process, never in argv or an environment, never printed or logged: the file's
// descriptor is the child's stdin, and only the answer's parsed state, name and org are said. The transport is a
// machine's input, never hard-wired: the mini's plain non-TTY ssh, the VM's `devcloud vm ssh <vm> --` (its own key and
// host alias). SMINOS_RL10 and MAWS_USER_DATA are set only where the fake sminos and the scratch daemon run, and are
// taken out of every command the runner starts, so no real sminos it could reach reads them; the runner calls no sminos.
import { spawn } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { IDLE_RUN } from './daemon-idle';

export type Transport = { kind: 'ssh'; host: string } | { kind: 'devcloud'; vm: string };

export interface BenchMachine {
  /** the org's name for it, which the code was minted for (a name is bound to its ref for the org's life) */
  name: string;
  transport: Transport;
  /** where the scratch daemon comes from: the runner packs and starts it (the VM), or mini-ops starts it (the mini) */
  stage: 'runner' | 'mini-ops';
  /** this Mac's 0600 file holding the enrollment code */
  codeFile: string;
  /** the directory the machine's scratch profiles live under, absolute: the profile is strictly inside it */
  scratchRoot: string;
  /** the scratch profile on the machine, absolute, normal and strictly under `scratchRoot` */
  profile: string;
  label: string;
  /** the scratch endpoint's direct listener */
  port: number;
  /** M7's head checkout on the machine, and the commit it must be at */
  head: string;
  commit: string;
  /** the node runtime that runs the agent (on the mini, the production mawsd's) */
  node: string;
  /** a daily UTC window ("HH:MM", from, to) in which no call reaches the machine, besides the mini's own 06:45 to 07:00,
   * which it adds to and never replaces */
  quietUtc?: readonly [string, string];
  /** what `node` is: the production app's Electron run as Node (the mini's default: ELECTRON_RUN_AS_NODE=1,
   * --disable-sigusr1, as the production mawsd runs), or a Node (the VM's) */
  runtime?: 'electron' | 'node';
  /** the mini's head: `copy`, this Mac's head bundle sent as a tarball and unpacked into `head` (the default), or
   * `present`, put there by mini-ops */
  stageHead?: 'copy' | 'present';
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export interface Started {
  onLine(listener: (line: string) => void): void;
  write(line: string): void;
  end(): void;
  kill(): void;
  readonly exited: Promise<number | null>;
}
/** Every process the runner starts. `stdinFile`: a file whose descriptor is the child's stdin, never read here. */
export interface CommandRunner {
  run(argv: readonly string[], options?: { stdinFile?: string; timeoutMs?: number }): Promise<RunResult>;
  start(argv: readonly string[]): Started;
}

export const DEFAULT_LABEL = 'dev.maws.mawsd';
/** The mini's quiet window (its owner's, 2026-11-02): nothing on it from 06:45 to 07:00 UTC, whatever else is asked. */
export const MINI_QUIET_UTC = ['06:45', '07:00'] as const;
/** What a serve may run for, so it starts only when the quiet window is that far off. */
export const SERVE_SPAN_MS = 45 * 60_000;
/** The longest a serve runs on a machine with no quiet window ahead (the live test's own timeout). */
export const SERVE_MAX_MS = 150 * 60_000;
/** How much later than the machine's own deadline a remote command's local process is given up on. */
const REMOTE_GRACE_MS = 15_000;
/** A local command's grace between its deadline's SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 2_000;
/** The exit status a guard refuses a write with. */
export const GUARD_REFUSED = 86;
/** A remote command's timeout unless it names its own: every one ends, and its end is known before a window. */
export const REMOTE_CALL_MS = 2 * 60_000;
/** How long before a quiet window every call has ended and a running serve is ended with its cleanup. */
export const QUIET_MARGIN_MS = 2 * 60_000;
/** The agent's grace on its stdin's end before it is killed, and the wait for its exit after. */
const AGENT_END_MS = 15_000;
const AGENT_KILLED_MS = 10_000;
/** What a scratch command never names: the production profile (with its space), the production app's own mawsd entry, its unit mode. */
const PRODUCTION = [/Library\/Application Support\/MAWS\b/, /app\.asar/, /(^|\s)--unit(\s|$)/] as const;
/** Why `command` is refused as naming the production mawsd's own paths or mode; null when it doesn't. */
export const productionProblem = (command: string): string | null => {
  const hit = PRODUCTION.find((pattern) => pattern.test(command));
  return hit === undefined ? null : `it names the production mawsd's ${hit === PRODUCTION[0] ? 'profile (Library/Application Support/MAWS)' : hit === PRODUCTION[1] ? 'app.asar entry' : 'unit mode (--unit)'}`;
};
const SOCKET_PATH_MAX_BYTES = 103; // src/engine-host/supervisor-files.ts's, so a socket never falls back out of the profile
/**
 * The longest path the scratch daemon binds a socket at: RL10's, bound first as `<path>.<8 characters>` and renamed into
 * place (src/endpoint/rl10/server.ts's TEMPORARY_EXTRA), 34 bytes past the profile; every other socket it, its hosts and
 * their session hosts bind is shorter (the pty host's +24, a session host's +31). cua's per-session sockets are longer and
 * fall back past the limit, but the bench opens no browser session.
 */
const LONGEST_SOCKET = 'mawsd/endpoint/rl10.sock';
const TEMPORARY_SUFFIX_BYTES = 9;
export const ENROLL_WAIT_S = 900; // the code's TTL
/** How long the enroll's return may come before the machine's key reads back. */
const KEY_WITHIN_MS = 60_000;
const STATUS_EVERY_MS = 5_000;
const START_WITHIN_MS = 10 * 60_000; // mini-ops' start, or the VM's pack's mawsd, answering
/** How long the mini's teardown waits for its scratch mawsd's absence once mini-ops' stop is said. */
export const STOP_WITHIN_MS = 10 * 60_000;
/** The watch's own deadline for an ask (src/mawsd's: 10 s a request, 90 s a sync), and this side's grace beyond it. */
const WATCH_ASK_MS = { up: 10_000, status: 10_000, keys: 10_000, sync: 90_000 } as const;
type WatchAsk = keyof typeof WATCH_ASK_MS;
/** Variables the runner never passes on: sminos picks its endpoint from them, so they belong to the fake and the scratch daemon. */
export const WITHHELD_ENV = ['SMINOS_RL10', 'MAWS_USER_DATA'] as const;

/** One word for a POSIX shell, single-quoted. */
export const quote = (word: string): string => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

/** The argv that runs `command` (one shell line) on the machine. */
export function transportArgv(transport: Transport, command: string): string[] {
  return transport.kind === 'ssh' ? ['ssh', '-T', '-o', 'BatchMode=yes', transport.host, command] : ['devcloud', 'vm', 'ssh', transport.vm, '--', command];
}

/** Why `path` is refused as a scratch path strictly inside `root`: not absolute, not normal (a `.` or `..` component, an
 * empty one or a trailing slash, which a string prefix would let climb out), or not strictly under it. */
export function containmentProblem(what: string, path: string, root: string): string | null {
  if (!isAbsolute(path)) return `${what} ${path} is not absolute`;
  if (path === '/') return `${what} / is the filesystem's root`;
  if (posix.normalize(path) !== path || path.length > 1 && path.endsWith('/') || path.split('/').slice(1).some((part) => part === '.' || part === '..' || part === '')) return `${what} ${path} is not a normal path (a ., .., empty component or trailing slash)`;
  if (!path.startsWith(`${root}/`)) return `${what} ${path} is not strictly under ${root}`;
  return null;
}

/** What a scratch path may not hold: a quote, a space, a glob or another shell character (it is matched in a `case`). */
const SHELL_CHARACTERS = /['"\\$`\s*?[\]{}~!#&;|<>()]/;

/** Why a machine's inputs are refused, each one line; empty when they stand. */
export function machineProblems(m: BenchMachine): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(m.name)) problems.push(`name ${m.name} is not a machine name`);
  if (m.label === DEFAULT_LABEL || !/^[\w.-]+$/.test(m.label)) problems.push(`label ${m.label} is the default profile’s, or not a label`);
  for (const [what, path] of [['node', m.node], ['code file', m.codeFile]] as const) if (!isAbsolute(path)) problems.push(`${what} ${path} is not absolute`);
  const root = containmentProblem('scratch root', m.scratchRoot, '');
  if (root !== null) problems.push(root);
  if (/\/(Library\/Application Support|\.config)\/MAWS(\/|$)/.test(m.profile)) problems.push(`profile ${m.profile} is a default profile, or inside one`);
  for (const problem of [containmentProblem('profile', m.profile, m.scratchRoot), containmentProblem('head', m.head, m.profile)]) if (problem !== null) problems.push(problem);
  for (const [what, path] of [['scratch root', m.scratchRoot], ['profile', m.profile], ['head', m.head], ['node', m.node]] as const) {
    const named = productionProblem(path);
    if (named !== null && !(what === 'profile' && problems.some((p) => p.includes('is a default profile')))) problems.push(`${what} ${path}: ${named}`);
  }
  if (/\.local\/bin\/mawsd$/.test(m.node)) problems.push(`node ${m.node} is the installed mawsd`);
  if (!Number.isSafeInteger(m.port) || m.port < 1024 || m.port > 65535) problems.push(`port ${m.port} is not a free-range port`);
  if (!/^[0-9a-f]{40}$/.test(m.commit)) problems.push(`commit ${m.commit} is not a full sha`);
  if (m.stage === 'runner' && m.transport.kind !== 'devcloud') problems.push('the runner stages only a devcloud VM; the mini is mini-ops’');
  if (Buffer.byteLength(`${m.profile}/${LONGEST_SOCKET}`) + TEMPORARY_SUFFIX_BYTES > SOCKET_PATH_MAX_BYTES) problems.push(`profile ${m.profile} is too long for its sockets: RL10's, bound under its temporary name first, would pass ${SOCKET_PATH_MAX_BYTES} bytes and fall back out of it`);
  for (const [what, path] of [['scratch root', m.scratchRoot], ['profile', m.profile], ['head', m.head]] as const) if (SHELL_CHARACTERS.test(path)) problems.push(`${what} ${path} holds a quote, a space or a shell character`);
  for (const window of quietWindows(m)) if (!window.every((hm) => /^([01]\d|2[0-3]):[0-5]\d$/.test(hm))) problems.push(`quiet window ${window.join('–')} is not two UTC times HH:MM`);
  return problems;
}

/**
 * Why the bench app's profile on this Mac is refused (launchMaws writes it and empties its claude-config): it must be
 * strictly under the config's scratch root, never the production app's profile (~/Library/Application Support/MAWS), inside
 * it or above it, and no existing component of it may be a symlink (its deepest existing ancestor is its own real path).
 */
export function appProfileProblems(profile: string, scratchRoot: string, home: string, realpath: (path: string) => string = realpathSync, exists: (path: string) => boolean = existsSync): string[] {
  const problems = [containmentProblem('the app’s scratch root', scratchRoot, ''), containmentProblem('the app’s profile', profile, scratchRoot)].filter((p): p is string => p !== null);
  const production = `${home}/Library/Application Support/MAWS`;
  for (const [what, path] of [['the app’s profile', profile], ['the app’s scratch root', scratchRoot]] as const) {
    if (path === production || path.startsWith(`${production}/`) || production.startsWith(`${path}/`)) problems.push(`${what} ${path} is the production app’s profile, inside it or above it`);
  }
  if (problems.length > 0) return problems;
  let existing = profile;
  while (!exists(existing) && existing !== '/') existing = posix.dirname(existing);
  let real: string;
  try {
    real = realpath(existing);
  } catch {
    real = '';
  }
  if (real !== existing) problems.push(`the app’s profile ${profile} goes through a symlink: ${existing} is ${real || 'unreadable'} (name the real path)`);
  return problems;
}

const runtimeOf = (m: BenchMachine) => m.runtime ?? (m.stage === 'mini-ops' ? 'electron' : 'node');
const stageHeadOf = (m: BenchMachine) => m.stageHead ?? 'copy';
/** The machine's runtime as a command's first words: an Electron as production runs its mawsd (--disable-sigusr1). */
const runtimeWords = (m: BenchMachine) => `${quote(m.node)}${runtimeOf(m) === 'electron' ? ' --disable-sigusr1' : ''}`;

/** Every daily window in which nothing reaches the machine: the mini's own (on its plain ssh), never replaced, and the machine's input's beside it. */
export const quietWindows = (m: BenchMachine): (readonly [string, string])[] => [...(m.transport.kind === 'ssh' ? [MINI_QUIET_UTC] : []), ...(m.quietUtc === undefined ? [] : [m.quietUtc])];

const minuteOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
/** The starts and lengths of `window`'s occurrences around `at`: the day before, that day and the next. */
const occurrences = (window: readonly [string, string], at: number) => {
  const [from, to] = window.map(minuteOf) as [number, number];
  const length = ((to - from + 1440) % 1440) * 60_000;
  const day = Math.floor(at / 86_400_000) * 86_400_000;
  return [day - 86_400_000, day, day + 86_400_000].map((d) => ({ start: d + from * 60_000, length }));
};

/** Whether [at, at + spanMs] meets the daily UTC window [from, to) (a window past midnight wraps). */
export function meetsQuiet(window: readonly [string, string], at: number, spanMs: number): boolean {
  return occurrences(window, at).some(({ start, length }) => at < start + length && start < at + spanMs);
}

/** Milliseconds from `at` to the next start of any of `windows`; 0 inside one, Infinity with none. */
export function untilQuiet(windows: readonly (readonly [string, string])[], at: number): number {
  let soonest = Infinity;
  for (const window of windows) {
    for (const { start, length } of occurrences(window, at)) {
      if (at >= start && at < start + length) return 0;
      if (start > at) soonest = Math.min(soonest, start - at);
    }
  }
  return soonest;
}

/** The machine's bench files: the agent, the stub's wrapper and samples, the VM's pack, the daemon's output. */
export const benchDir = (m: BenchMachine) => `${m.profile}/bench`;
const packDir = (m: BenchMachine) => `${benchDir(m)}/pack`;
const packPath = (m: BenchMachine) => `${benchDir(m)}/pack-path`;
/** The VM's prep marker: the commit its head was installed and packed at, written last. */
const preparedPath = (m: BenchMachine) => `${benchDir(m)}/prepared-commit`;
const pidPath = (m: BenchMachine) => `${benchDir(m)}/mawsd.pid`;
/** The profile's own directories, made before anything runs and checked for symlinks before anything is written. */
export const SCRATCH_DIRS = ['bench', 'home', 'tmp', 'cache', 'config', 'data', 'state', 'pnpm-store', 'npm-cache', 'mawsd', 'sminos', 'shell-home', 'claude-usage', 'claude-config'] as const;
const scratchDirs = (m: BenchMachine) => [...SCRATCH_DIRS.map((d) => `${m.profile}/${d}`), packDir(m)];
/**
 * The line that makes the profile's directories 0700, an existing more open one (an earlier run's) closed: the daemon's
 * makePrivateDirectory refuses `<profile>/mawsd` otherwise, and nothing else needs them open.
 */
export function makeScratchDirs(m: BenchMachine): string {
  const dirs = scratchDirs(m).map(quote).join(' ');
  return `mkdir -p -m 700 ${dirs} && chmod 700 ${dirs}`;
}
/** The scratch daemon's program, on the VM its pack's runtime and entry (read from where the pack was recorded). */
const mawsdEntry = (m: BenchMachine) => (m.stage === 'runner' ? `"$(cat ${quote(packPath(m))})/runtime/bin/node" "$(cat ${quote(packPath(m))})/out/main/mawsd.js"` : `${runtimeWords(m)} ${quote(`${m.head}/out/main/mawsd.js`)}`);
/** A command of the scratch daemon's (status, keys, enroll), in the profile's scratch environment. */
const mawsd = (m: BenchMachine) => `${scratchEnv(m)} ${mawsdEntry(m)}`;
/** The bench agent's command, on the machine's runtime. */
const agent = (m: BenchMachine, command: 'prepare' | 'serve' | 'watch' | 'stop-hosts', engineVersion: string, deadline?: number) => `${scratchEnv(m)} ${runtimeWords(m)} ${quote(`${benchDir(m)}/bench-agent.cjs`)} ${command} ${quote(agentArgs(m, engineVersion, deadline))}`;
const scoped = (m: BenchMachine) => `--profile ${quote(m.profile)} --label ${quote(m.label)}`;

/**
 * Variables a remote shell may carry in that would point a scratch process at another profile, store, endpoint or engine:
 * unset in every program the runner runs there, unless the program's own environment sets them.
 */
export const INHERITED_OVERRIDES = ['MAWS_USER_DATA', 'MAWS_MAWSD_LABEL', 'MAWS_ENDPOINT_DIRECT', 'MAWS_ENDPOINT_PORT', 'MAWS_MACHINE_NAME', 'MAWS_DEV_ORG', 'MAWS_E2E', 'MAWS_E2E_ENGINE_BIN', 'MAWS_CLAUDE_USAGE_DIR', 'CLAUDE_CONFIG_DIR', 'SMINOS_RL10', 'SMINOS_HOME', 'DAEMON_HOME', 'ZDOTDIR', 'HISTFILE', 'NODE_OPTIONS', 'PNPM_HOME', 'npm_config_prefix', 'COREPACK_HOME'] as const;

/**
 * Every remote program's environment: a home, temporary directory, XDG directories, pnpm store, npm and Electron caches
 * of the profile's (so an install, a build, the pack's smoke check and anything reading the home write only there), no
 * Electron download (the VM runs no app: devenv/setup.sh's), and the runtime run as Node.
 */
export function profileEnv(m: BenchMachine): Record<string, string> {
  const p = m.profile;
  return {
    HOME: `${p}/home`,
    TMPDIR: `${p}/tmp`,
    XDG_CACHE_HOME: `${p}/cache`,
    XDG_CONFIG_HOME: `${p}/config`,
    XDG_DATA_HOME: `${p}/data`,
    XDG_STATE_HOME: `${p}/state`,
    npm_config_store_dir: `${p}/pnpm-store`,
    npm_config_cache: `${p}/npm-cache`,
    ELECTRON_CACHE: `${p}/cache/electron`,
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    ELECTRON_RUN_AS_NODE: '1',
  };
}

/**
 * The scratch daemon's environment: its own profile, store, label and listener, the latency stub as its engine (under
 * MAWS_E2E the engine is MAWS_E2E_ENGINE_BIN and nothing else, so no `claude` runs), and a sminos home, usage directory and
 * shell home of its own, over the profile's environment.
 */
export function daemonEnv(m: BenchMachine): Record<string, string> {
  return {
    ...profileEnv(m),
    MAWS_USER_DATA: m.profile,
    MAWS_MAWSD_LABEL: m.label,
    CLAUDE_CONFIG_DIR: `${m.profile}/claude-config`,
    MAWS_CLAUDE_USAGE_DIR: `${m.profile}/claude-usage`,
    SMINOS_HOME: `${m.profile}/sminos`,
    ZDOTDIR: `${m.profile}/shell-home`,
    HISTFILE: `${m.profile}/shell-home/.sh_history`,
    MAWS_E2E: '1',
    MAWS_E2E_ENGINE_BIN: `${benchDir(m)}/latency-engine`,
    MAWS_ENDPOINT_DIRECT: '1',
    MAWS_ENDPOINT_PORT: String(m.port),
    MAWS_MACHINE_NAME: m.name,
  };
}
const envWords = (env: Record<string, string>) => Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`).join(' ');
/** `env` with every inherited override the environment doesn't set unset, then the environment: a program's first words. */
export function envLine(env: Record<string, string>): string {
  const unset = INHERITED_OVERRIDES.filter((name) => !(name in env)).map((name) => `-u ${name}`).join(' ');
  return `env ${unset} ${envWords(env)}`;
}
const scratchEnv = (m: BenchMachine) => envLine(profileEnv(m));

/**
 * The line that starts the scratch daemon detached on the machine and records its own pid: the subshell execs it (setsid
 * where there is one, then env, then nohup, each an exec), so `$!` is the daemon's pid, not a shell's waiting on it.
 */
export function startLine(m: BenchMachine, entry: string): string {
  const out = `${benchDir(m)}/mawsd.out`;
  const daemon = `${envLine(daemonEnv(m))} nohup ${entry} run --private --dir ${quote(`${m.profile}/mawsd`)} < /dev/null > ${quote(out)} 2>&1`;
  return `${guardedLine(m, [...scratchDirs(m), out, pidPath(m)], '')}${makeScratchDirs(m)} || exit 1; cd ${quote(benchDir(m))} || exit 1; ( if command -v setsid > /dev/null 2>&1; then exec setsid ${daemon}; else exec ${daemon}; fi ) & echo $! > ${quote(pidPath(m))}`;
}

/**
 * The line that stops the scratch daemon by its recorded pid, signalling it only when that pid's command line names the
 * profile's daemon directory (a pid reused by another process is never signalled): exit 0 when it has stopped, 3 when no
 * pid is recorded (whether it runs is unknown), 4 when the pid is another process's, 5 when it outlived SIGKILL.
 */
export function stopLine(m: BenchMachine): string {
  const dir = `${m.profile}/mawsd`;
  return `pid=$(cat ${quote(pidPath(m))} 2>/dev/null) || exit 3; case "$pid" in ''|*[!0-9]*) exit 4;; esac; args=$(ps -o args= -p "$pid" 2>/dev/null) || exit 0; case "$args" in *"--dir ${dir}"*) ;; *) exit 4;; esac; kill "$pid" 2>/dev/null; for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || exit 0; sleep 1; done; kill -9 "$pid" 2>/dev/null; sleep 1; if kill -0 "$pid" 2>/dev/null; then exit 5; fi; exit 0`;
}

/** A pgrep pattern for the profile that its own command line doesn't match: `[/]…`, the rest escaped. */
const profilePattern = (m: BenchMachine) => `[${m.profile[0]}]${m.profile.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;

/** The processes naming the profile (pgrep's pids in `$pids`, exit 3 when it fails), and exit 6 when the scratch mawsd is one. */
const scratchProcesses = (m: BenchMachine) => [
  `rel=${quote(m.profile.slice(1))}; prof="/$rel"`,
  `pids=$(pgrep -f -- ${quote(profilePattern(m))}); found=$?; [ "$found" -le 1 ] || exit 3`,
  `for pid in $pids; do case "$(ps -o args= -p "$pid" 2>/dev/null)" in *" run "*"--dir $prof/mawsd"|*" run "*"--dir $prof/mawsd "*) exit 6;; esac; done`,
];
/** The line that says whether the scratch mawsd runs (exit 6), as `reapLine` reads it, signalling nothing. */
export const scratchDaemonLine = (m: BenchMachine): string => [...scratchProcesses(m), 'exit 0'].join('; ');

/**
 * The line that ends every process left whose command line names the scratch profile (its hosts, its session hosts, an
 * agent or stub that outlived its end), never the scratch mawsd itself: each is signalled only once it is identified by
 * its pid and its start time (`ps -o lstart=`, read before the signal and read again just before it) and its command line
 * names the profile's path (the path, then a `/`, a space or the end: never a profile it prefixes); SIGTERM, then
 * SIGKILL to any left after 10 s. The profile is built at run time from its path less the leading slash, so the line's own
 * shell names no profile and is never one of its targets. Exit 0 once none is left, 3 when pgrep fails, 6 when the
 * scratch mawsd still runs (nothing signalled), 7 when one outlives SIGKILL.
 */
export function reapLine(m: BenchMachine): string {
  return [
    ...scratchProcesses(m),
    `names() { case "$(ps -o args= -p "$1" 2>/dev/null)" in *"$prof/"*|*"$prof "*|*"$prof") return 0;; esac; return 1; }`,
    `for sig in TERM KILL; do for pid in $pids; do started=$(ps -o lstart= -p "$pid" 2>/dev/null) || continue; names "$pid" || continue; [ "$(ps -o lstart= -p "$pid" 2>/dev/null)" = "$started" ] && kill -$sig "$pid" 2>/dev/null; done; i=0; while [ $i -lt 10 ]; do left=; for pid in $pids; do kill -0 "$pid" 2>/dev/null && names "$pid" && left=1; done; [ -z "$left" ] && exit 0; sleep 1; i=$((i + 1)); done; done; exit 7`,
  ].join('; ');
}

/**
 * `command` behind a guard, in one shell step: every component of each target, from the target up to the scratch root
 * inclusive, is checked with `[ -L ]` (a missing one is no symlink), and a symlink, or a target outside the root, refuses
 * the step with exit GUARD_REFUSED before anything is written; only then does `command` run.
 */
export function guardedLine(m: BenchMachine, targets: readonly string[], command: string): string {
  const root = quote(m.scratchRoot);
  return `for t in ${targets.map(quote).join(' ')}; do p=$t; while :; do if [ -L "$p" ]; then printf 'refused: %s is a symlink\n' "$p" >&2; exit ${GUARD_REFUSED}; fi; [ "$p" = ${root} ] && break; case "$p" in ${root}/*) p=$(dirname "$p");; *) printf 'refused: %s is outside %s\n' "$t" ${root} >&2; exit ${GUARD_REFUSED};; esac; done; done; ${command}`;
}

/** The line that writes its stdin to `target`: a fresh name in the target's checked directory, moved into place, so no existing symlink is followed. */
export function copyLine(m: BenchMachine, target: string): string {
  const dir = posix.dirname(target);
  return guardedLine(m, [dir, target], `tmp=$(mktemp ${quote(`${dir}/.bench-copy.XXXXXX`)}) && cat > "$tmp" && mv -f "$tmp" ${quote(target)} || { rm -f "$tmp"; exit 1; }`);
}

/**
 * A process-group deadline the mini's perl keeps (macOS has no `timeout`): the command in its own group, SIGTERM to the
 * group at `seconds`, SIGKILL two seconds later, exit 124; else the command's own status.
 */
const PERL_DEADLINE = `my $t = shift; my $pid = fork; die "fork: $!" unless defined $pid; if ($pid == 0) { setpgrp(0, 0); exec @ARGV; exit 127 } $SIG{ALRM} = sub { kill 'TERM', -$pid; sleep 2; kill 'KILL', -$pid; waitpid($pid, 0); exit 124 }; alarm $t; waitpid($pid, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)`;

/** `command` with its own deadline on the machine: GNU timeout on the VM (its whole group, SIGKILL 5 s later), the perl alarm on the mini. */
export function deadlined(m: BenchMachine, seconds: number, command: string): string {
  const shell = `sh -c ${quote(command)}`;
  return m.transport.kind === 'devcloud' ? `timeout -k 5 ${seconds} ${shell}` : `perl -e ${quote(PERL_DEADLINE)} ${seconds} ${shell}`;
}

export interface BenchDeps {
  runner: CommandRunner;
  /** the version the latency stub answers `--version` with (test/support/engine-pin's FIXTURE_ENGINE_VERSION) */
  engineVersion: string;
  /** a line for the operator's terminal (never a code) */
  say(line: string): void;
  sleep?(ms: number): Promise<void>;
  now?(): number;
  /** runs `fn` once `ms` have passed (a running serve's deadline before a quiet window); answers its cancel */
  after?(ms: number, fn: () => void): () => void;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const afterFor = (ms: number, fn: () => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/** A watch's answer to one ask: its value, or the error it said (the daemon not answering it). */
type WatchReply = { answer: unknown } | { error: string };

/** The run's one status client: the agent's `watch`, its asks in flight by id. */
interface Watch {
  started: Started;
  pending: Map<number, (reply: WatchReply | 'gone') => void>;
  next: number;
  exited: boolean;
  ending: Promise<void> | null;
}

/** The bench's hold on one machine: each step, and the teardown its steps registered, last first. */
export class BenchRun {
  readonly #m: BenchMachine;
  readonly #deps: BenchDeps;
  readonly #teardown: { what: string; step: () => Promise<void> }[] = [];
  #agent: Started | null = null;
  #ending: Promise<void> | null = null;
  #watch: Watch | null = null;

  constructor(machine: BenchMachine, deps: BenchDeps) {
    const problems = machineProblems(machine);
    if (problems.length > 0) throw new Error(`the bench machine's inputs are refused:\n${problems.join('\n')}`);
    this.#m = machine;
    this.#deps = deps;
  }

  get machine(): BenchMachine {
    return this.#m;
  }

  /**
   * One command on the machine with a deadline always (its own or REMOTE_CALL_MS), kept on the machine (`deadlined`) and
   * here REMOTE_GRACE_MS later; refused when it would run into a quiet window.
   */
  #remote(command: string, options: { stdinFile?: string; timeoutMs?: number } = {}): Promise<RunResult> {
    const timeoutMs = options.timeoutMs ?? REMOTE_CALL_MS;
    this.#quiet(timeoutMs + REMOTE_GRACE_MS);
    this.#scratchOnly(command);
    return this.#deps.runner.run(transportArgv(this.#m.transport, deadlined(this.#m, Math.ceil(timeoutMs / 1000), command)), { ...options, timeoutMs: timeoutMs + REMOTE_GRACE_MS });
  }
  /** A writing or destructive command, behind the guard on its targets. */
  #write(targets: readonly string[], command: string, what: string, options?: { stdinFile?: string; timeoutMs?: number }): Promise<RunResult> {
    return this.#must(guardedLine(this.#m, targets, command), what, options);
  }
  /** Refuses a command that names the production mawsd's profile, entry or unit mode. */
  #scratchOnly(command: string): void {
    const named = productionProblem(command);
    if (named !== null) throw new Error(`${this.#m.name}: refused a command: ${named}`);
  }
  /** Refuses a call that would reach the machine inside a quiet window, or within QUIET_MARGIN_MS of one, now or within `spanMs`. */
  #quiet(spanMs: number): void {
    for (const window of quietWindows(this.#m)) {
      if (meetsQuiet(window, this.#now(), spanMs + QUIET_MARGIN_MS)) throw new Error(`${this.#m.name}: refused: nothing reaches it from ${window[0]} to ${window[1]} UTC, and this call would run into that window or the ${QUIET_MARGIN_MS / 60_000} minutes before it`);
    }
  }
  async #must(command: string, what: string, options?: { stdinFile?: string; timeoutMs?: number }): Promise<RunResult> {
    const result = await this.#remote(command, options);
    if (result.code !== 0) throw new Error(`${this.#m.name}: ${what} failed (exit ${result.code}): ${result.stderr.trim().slice(-600)}`);
    return result;
  }
  #sleep(ms: number) {
    return (this.#deps.sleep ?? sleepFor)(ms);
  }
  #after(ms: number, fn: () => void) {
    return (this.#deps.after ?? afterFor)(ms, fn);
  }
  #now() {
    return (this.#deps.now ?? Date.now)();
  }

  /** The profile's own directories made (each checked by the guard first), before anything else is written or run there. */
  async #scratchReady(): Promise<void> {
    const dirs = scratchDirs(this.#m);
    await this.#write(dirs, makeScratchDirs(this.#m), 'making the scratch profile’s directories');
  }

  /** Copies the agent's bundle (a local file) to the machine and runs its `prepare`: the stub's wrapper, the store's trust. */
  async prepare(agentBundle: string): Promise<void> {
    const m = this.#m;
    await this.#scratchReady();
    await this.#must(copyLine(m, `${benchDir(m)}/bench-agent.cjs`), 'copying the bench agent', { stdinFile: agentBundle, timeoutMs: 5 * 60_000 });
    const p = m.profile;
    await this.#write([benchDir(m), `${benchDir(m)}/checkout`, `${benchDir(m)}/latency-engine`, `${p}/claude-config`, `${p}/shell-home`, `${p}/home`, `${p}/tmp`], agent(m, 'prepare', this.#deps.engineVersion), 'the bench agent’s prepare');
    this.#deps.say(`[bench] ${m.name}: the bench agent is in place`);
  }

  /** Whether the VM's head is installed and packed at the machine's commit: its marker names it and the pack's entry and runtime are there. */
  async #prepared(): Promise<boolean> {
    const m = this.#m;
    const answer = await this.#remote(`pack=$(cat ${quote(packPath(m))} 2>/dev/null) && test "$(cat ${quote(preparedPath(m))} 2>/dev/null)" = ${m.commit} && test -f "$pack/out/main/mawsd.js" && test -x "$pack/runtime/bin/node"`);
    return answer.code === 0;
  }

  /**
   * prepare-vm, before the sitting (it loads the VM whose production mawsd serves the sitting): this checkout's source at
   * the commit (`buildSourceArchive`: `git archive`, no clone or fetch there, whose GitHub credential the scratch
   * environment never holds) unpacked into `head`, installed from the registry, node-pty's spawn-helper made executable,
   * and packed through mawsd-pack's API, all in the profile's scratch environment; the commit recorded last, so a rerun at
   * the same commit does nothing and one that failed midway starts over.
   */
  async prepareVm(source: HeadBundle): Promise<void> {
    const m = this.#m;
    if (m.stage !== 'runner') throw new Error(`${m.name}: prepare-vm builds a devcloud VM's head; the mini's head bundle is copied at its stage`);
    if (source.commit !== m.commit) throw new Error(`${m.name}: the source archive is of ${source.commit.slice(0, 9)}, not ${m.commit.slice(0, 9)}`);
    await this.#scratchReady();
    if (await this.#prepared()) {
      this.#deps.say(`[bench] ${m.name}: already prepared at ${m.commit.slice(0, 9)} (its head installed and packed); nothing to do`);
      return;
    }
    await this.#write([preparedPath(m), packPath(m)], `rm -f ${quote(preparedPath(m))} ${quote(packPath(m))}`, 'clearing the last prep’s marks');
    await this.#unpack(source, 'source');
    const builds = [m.head, `${m.head}/node_modules`, `${m.profile}/pnpm-store`, `${m.profile}/cache`, `${m.profile}/npm-cache`, `${m.profile}/home`, `${m.profile}/tmp`];
    await this.#write(builds, `cd ${quote(m.head)} && ${scratchEnv(m)} pnpm install --frozen-lockfile >&2`, 'pnpm install', { timeoutMs: 30 * 60_000 });
    await this.#spawnHelpers();
    // mawsd-pack's own API with the commit named, since the unpacked source is no git checkout for it to read
    const script = `const { pack } = await import("./scripts/mawsd-pack.mjs"); process.stdout.write((await pack({ out: ${JSON.stringify(packDir(m))}, commit: ${JSON.stringify(m.commit.slice(0, 8))} })) + "\\n");`;
    const packed = await this.#write([...builds, `${m.head}/out`, packDir(m)], `cd ${quote(m.head)} && ${scratchEnv(m)} ${quote(m.node)} --input-type=module -e ${quote(script)}`, 'the pack (scripts/mawsd-pack.mjs)', { timeoutMs: 30 * 60_000 });
    const pack = packed.stdout.trim().split('\n').at(-1) ?? '';
    if (containmentProblem('the pack', pack, packDir(m)) !== null) throw new Error(`${m.name}: the pack printed no path under ${packDir(m)}`);
    await this.#write([packPath(m)], `printf '%s' ${quote(pack)} > ${quote(packPath(m))}`, 'recording the pack');
    await this.#write([preparedPath(m)], `printf '%s\\n' ${m.commit} > ${quote(preparedPath(m))}`, 'recording the prep');
    this.#deps.say(`[bench] ${m.name}: prepared at ${m.commit.slice(0, 9)}: its head installed and packed in ${pack}`);
  }

  /**
   * The scratch daemon from M7's head: on the VM, the prepared pack's mawsd started here (prepare-vm first); on the mini,
   * its head bundle copied (`archive`, from `buildHeadBundle`, unless `stageHead: 'present'`) and mini-ops' start waited for.
   */
  async stage(archive?: HeadBundle): Promise<void> {
    const m = this.#m;
    await this.#scratchReady();
    if (m.stage === 'runner' && !(await this.#prepared())) throw new Error(`${m.name}: not prepared at ${m.commit.slice(0, 9)}: run prepare-vm before the sitting (MAWS_REMOTE_BENCH_PREPARE=1)`);
    if (m.stage === 'mini-ops' && stageHeadOf(m) === 'copy') {
      if (archive === undefined) throw new Error(`${m.name}: its head is copied (stageHead copy), and no head bundle was built`);
      await this.#copyHead(archive);
    }
    // The hosts' end, on both machines, runs after the daemon's (the last registered first), once nothing can wake them
    // again: on the mini too (M10), whose detached scratch engine host outlived mini-ops' stop in attempt 2.
    this.#teardown.push({
      what: 'the scratch hosts and every process naming the profile',
      step: async () => {
        const left = await this.#endScratchProcesses();
        if (left === 'daemon') throw new Error(`${m.name}: the scratch mawsd still runs, so its hosts are not ended`);
        if (left.length > 0) throw new Error(`${m.name}: ${left.length} process${left.length === 1 ? '' : 'es'} naming the scratch profile still run${left.length === 1 ? 's' : ''} (pid${left.length === 1 ? '' : 's'} ${left.join(', ')})`);
      },
    });
    // the VM's before the launch, so a launch whose answer is lost is still stopped, or its stop fails as unverified
    this.#teardown.push(m.stage === 'runner' ? { what: 'the scratch mawsd', step: () => this.#stopDaemon() } : { what: 'the scratch mawsd', step: () => this.#miniOpsStop() });
    // the watch after both, so it is ended before the daemon's stop and the reap (its own command line names the profile)
    this.#startWatch();
    if (m.stage === 'runner') await this.#must(startLine(m, mawsdEntry(m)), 'starting the scratch mawsd');
    else {
      this.#deps.say(`[bench] ${m.name}: mini-ops starts the scratch mawsd from ${m.head} at ${m.commit.slice(0, 9)} under the production mawsd's runtime, with:`);
      this.#deps.say(`[bench]   ${startLine(m, mawsdEntry(m))}`);
      this.#deps.say(`[bench] ${m.name}: waiting for it to answer on ${m.profile}`);
    }
    const deadline = this.#now() + START_WITHIN_MS;
    for (;;) {
      const up = (await this.#ask('up')) as { up?: unknown } | null;
      if (up?.up === true) break;
      if (this.#now() > deadline) throw new Error(`${m.name}: the scratch mawsd did not answer within ${START_WITHIN_MS / 60_000} minutes`);
      await this.#sleep(STATUS_EVERY_MS);
    }
    if (m.stage === 'runner') {
      // the pid recorded is the daemon's own, which teardown signals
      const args = await this.#must(`ps -o args= -p "$(cat ${quote(pidPath(m))})"`, 'reading the scratch mawsd’s pid');
      if (!args.stdout.includes(`--dir ${m.profile}/mawsd`)) throw new Error(`${m.name}: the recorded pid is not the scratch mawsd's (its command line names no --dir ${m.profile}/mawsd)`);
    }
    this.#deps.say(`[bench] ${m.name}: the scratch mawsd answers`);
  }

  /**
   * The mini's daemon stop: mini-ops' stop line said, then the scratch mawsd's absence waited for (`scratchDaemonLine`,
   * a pgrep, no runtime) up to STOP_WITHIN_MS, so the hosts' end that follows runs on a profile nothing can wake again.
   */
  async #miniOpsStop(): Promise<void> {
    const m = this.#m;
    this.#deps.say(`[bench] ${m.name}: mini-ops stops the scratch mawsd, with: ${stopLine(m)}`);
    this.#deps.say(`[bench] ${m.name}: waiting for it to be gone, then its hosts are ended`);
    const deadline = this.#now() + STOP_WITHIN_MS;
    for (;;) {
      const daemon = await this.#remote(scratchDaemonLine(m));
      if (daemon.code === 0) return;
      if (daemon.code !== 6) throw new Error(`${m.name}: reading whether the scratch mawsd runs failed (exit ${daemon.code}): whether it is gone is unknown`);
      if (this.#now() > deadline) throw new Error(`${m.name}: the scratch mawsd still runs ${STOP_WITHIN_MS / 60_000} minutes after mini-ops' stop was asked`);
      await this.#sleep(STATUS_EVERY_MS);
    }
  }

  /**
   * The run's one status client, the agent's `watch`, started at the stage's start and kept to the run's end: its own
   * deadline before the next quiet window (as serve's), and ended there with its link however long it has run.
   */
  #startWatch(): void {
    const m = this.#m;
    this.#quiet(REMOTE_CALL_MS);
    const until = untilQuiet(quietWindows(m), this.#now());
    const line = agent(m, 'watch', this.#deps.engineVersion, this.#now() + Math.min(SERVE_MAX_MS, until - QUIET_MARGIN_MS));
    this.#scratchOnly(line);
    const started = this.#deps.runner.start(transportArgv(m.transport, line));
    const watch: Watch = { started, pending: new Map(), next: 0, exited: false, ending: null };
    this.#watch = watch;
    started.onLine((text) => {
      let reply: { id?: unknown; answer?: unknown; error?: unknown };
      try {
        reply = JSON.parse(text) as typeof reply;
      } catch {
        return;
      }
      const settle = typeof reply.id === 'number' ? watch.pending.get(reply.id) : undefined;
      if (settle === undefined) return;
      watch.pending.delete(reply.id as number);
      settle(typeof reply.error === 'string' ? { error: reply.error } : { answer: reply.answer });
    });
    void started.exited.then(() => {
      watch.exited = true;
      for (const settle of watch.pending.values()) settle('gone');
      watch.pending.clear();
    });
    const cancel = Number.isFinite(until)
      ? this.#after(Math.max(0, until - QUIET_MARGIN_MS), () => {
          this.#deps.say(`[bench] ${m.name}: its quiet window is ${QUIET_MARGIN_MS / 60_000} minutes off: the status watch is ended now`);
          this.#endWatch().catch((error: unknown) => this.#deps.say(`[bench] ${m.name}: ending the status watch failed: ${(error as Error).message}`));
        })
      : () => undefined;
    this.#teardown.push({
      what: 'the status watch',
      step: async () => {
        cancel();
        await this.#endWatch();
      },
    });
  }

  #endWatch(): Promise<void> {
    const watch = this.#watch;
    if (watch === null) return Promise.resolve();
    watch.ending ??= this.#endStarted(watch.started, 'the status watch');
    return watch.ending;
  }

  /**
   * One ask of the watch: its answer, or null when the watch said the daemon did not answer it; throws when there is no
   * watch, it has ended or exited, or it says nothing within the ask's own deadline and REMOTE_GRACE_MS.
   */
  #ask(ask: WatchAsk): Promise<unknown> {
    const m = this.#m;
    const watch = this.#watch;
    if (watch === null) return Promise.reject(new Error(`${m.name}: no status watch runs (the stage starts it)`));
    if (watch.ending !== null || watch.exited) return Promise.reject(new Error(`${m.name}: the status watch has ended`));
    const waitMs = WATCH_ASK_MS[ask] + REMOTE_GRACE_MS;
    this.#quiet(waitMs);
    const id = ++watch.next;
    return new Promise((resolve, reject) => {
      const cancel = this.#after(waitMs, () => {
        watch.pending.delete(id);
        reject(new Error(`${m.name}: the status watch did not answer ${ask} within ${waitMs / 1000} s`));
      });
      watch.pending.set(id, (reply) => {
        cancel();
        if (reply === 'gone') reject(new Error(`${m.name}: the status watch exited before it answered ${ask}`));
        else resolve('error' in reply ? null : reply.answer);
      });
      watch.started.write(JSON.stringify({ id, ask }));
    });
  }

  /** An endpoint command's `--json` answer through the watch, parsed when its exit is one of `codes`; null otherwise. */
  async #endpointAnswer(ask: 'status' | 'keys' | 'sync', codes: readonly number[] = [0]): Promise<string | null> {
    const answer = (await this.#ask(ask)) as { code?: unknown; out?: unknown } | null;
    return answer !== null && typeof answer.code === 'number' && codes.includes(answer.code) && typeof answer.out === 'string' ? answer.out : null;
  }

  /**
   * The head bundle into `head`, after two read-only preflights: the runtime's Electron is the bundle's, and the profile's
   * volume has room for the tarball and twice what it unpacks to. Sent by `cat >` into the bench directory, unpacked under
   * `head` alone (its entries checked when it was built: none absolute, none with `..`), the tarball removed after.
   */
  async #copyHead(bundle: HeadBundle): Promise<void> {
    const m = this.#m;
    if (bundle.commit !== m.commit) throw new Error(`${m.name}: the head bundle is of ${bundle.commit.slice(0, 9)}, not ${m.commit.slice(0, 9)}`);
    const versions = await this.#must(`${scratchEnv(m)} ${quote(m.node)} -p process.versions.electron`, 'reading the runtime’s Electron version');
    const electron = versions.stdout.trim();
    if (bundle.electron === null || electron !== bundle.electron) throw new Error(`${m.name}: refused to copy the head: the runtime ${m.node} is Electron ${electron || '(none: not an Electron)'}, the head bundle's is Electron ${bundle.electron}`);
    const df = await this.#must(`df -Pk ${quote(m.profile)}`, 'reading the profile volume’s free space');
    const available = Number(df.stdout.trim().split('\n').at(-1)?.trim().split(/\s+/)[3]) * 1024;
    const needed = bundle.tarBytes + 2 * bundle.unpackedBytes;
    if (!Number.isFinite(available) || available < needed) throw new Error(`${m.name}: refused to copy the head: the profile's volume has ${mib(available)} MiB free, under the ${mib(needed)} MiB the bundle needs (its ${mib(bundle.tarBytes)} MiB tarball and twice its ${mib(bundle.unpackedBytes)} MiB unpacked)`);
    await this.#unpack(bundle, 'head');
    await this.#spawnHelpers();
    this.#deps.say(`[bench] ${m.name}: the head ${m.commit.slice(0, 9)} is unpacked in ${m.head} (Electron ${electron}, ${mib(bundle.unpackedBytes)} MiB)`);
  }

  /** A tarball sent by `cat >` into the bench directory and unpacked under `head` alone, `head` emptied first, the tarball removed. */
  async #unpack(archive: HeadBundle, name: 'head' | 'source'): Promise<void> {
    const m = this.#m;
    const tar = `${benchDir(m)}/${name}.tar`;
    await this.#must(copyLine(m, tar), `copying the ${name} archive`, { stdinFile: archive.tar, timeoutMs: 10 * 60_000 });
    await this.#write([m.head, tar], `rm -rf ${quote(m.head)} && mkdir -p ${quote(m.head)} && tar -xf ${quote(tar)} -C ${quote(m.head)} && rm -f ${quote(tar)}`, `unpacking the ${name} archive`, { timeoutMs: 10 * 60_000 });
  }

  /** node-pty's spawn-helper made executable: an install that skips its scripts (or a copy of one) leaves it 0644. */
  async #spawnHelpers(): Promise<void> {
    await this.#write([this.#m.head], `find ${quote(this.#m.head)} -path '*/node-pty/prebuilds/*/spawn-helper' -type f -exec chmod +x {} +`, 'making node-pty’s spawn-helper executable');
  }

  /**
   * The VM's scratch daemon stopped by its recorded pid, once that pid is shown to be the daemon's. No pid recorded is
   * unverified, and throws, unless `unrecorded` allows it (the removal, whose process check follows).
   */
  async #stopDaemon(unrecorded: 'unverified' | 'allowed' = 'unverified'): Promise<void> {
    const m = this.#m;
    const stopped = await this.#remote(stopLine(m), { timeoutMs: 60_000 });
    if (stopped.code === 3 && unrecorded === 'allowed') return;
    if (stopped.code === 3) throw new Error(`${m.name}: no pid of the scratch mawsd is recorded: whether it runs is unverified`);
    if (stopped.code === 4) throw new Error(`${m.name}: refused to signal the recorded pid: its command line is not the scratch mawsd's (--dir ${m.profile}/mawsd)`);
    if (stopped.code !== 0) throw new Error(`${m.name}: stopping the scratch mawsd failed (exit ${stopped.code})`);
  }

  /**
   * The endpoint's enrollment through the watch: `status`, or `sync` (the org state read now and a listing promoted,
   * exit 4 while hub-confirmed); null when unread.
   */
  async #enrollment(ask: 'status' | 'sync' = 'status'): Promise<{ enrollment: string; name?: string; org?: string } | null> {
    const out = await this.#endpointAnswer(ask, ask === 'sync' ? [0, 4] : [0]);
    if (out === null) return null;
    try {
      const { enrollment, name, org } = JSON.parse(out) as { enrollment: string; name?: string; org?: string };
      return { enrollment, ...(name === undefined ? {} : { name }), ...(org === undefined ? {} : { org }) };
    } catch {
      return null;
    }
  }

  /**
   * The machine enrolled and listed under its name: skipped when the scratch profile already is (a rerun); else the code
   * file streamed into `mawsd enroll`, which returns once the machine has posted its key (no `--wait`), the code file
   * removed whatever happened; then the machine's key shown as soon as `mawsd keys` reads it, for the owner to compare with
   * the one their terminal shows before they type y; then the listing waited for, within the code's TTL of the key shown.
   */
  async enroll(): Promise<void> {
    const m = this.#m;
    const before = await this.#enrollment();
    if (before?.enrollment === 'org-listed' && before.name === m.name) {
      // the code is not needed, and a secret is not left at rest for nothing
      rmSync(m.codeFile, { force: true });
      this.#deps.say(`[bench] ${m.name}: already enrolled and listed in ${before.org ?? 'the org'} (the profile is kept between runs); the unused code file is removed`);
      return;
    }
    // before the code is taken, the whole span: the enroll, the key's posting and the owner's y (a refused enroll leaves
    // its file for the next try)
    this.#quiet(REMOTE_CALL_MS + KEY_WITHIN_MS + ENROLL_WAIT_S * 1000);
    let code: number | null;
    let answer: { enrollment?: string; name?: string; org?: string } = {};
    try {
      this.#deps.say(`[bench] ${m.name}: enrolling with the code from its file (the machine's key is shown below as soon as it is posted; the owner compares it with their terminal's and types y)`);
      const result = await this.#remote(`${guardedLine(m, [m.profile, `${m.profile}/mawsd`], '')}${mawsd(m)} enroll ${scoped(m)} --name ${quote(m.name)} --json`, { stdinFile: m.codeFile });
      code = result.code;
      try {
        const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
        answer = { ...(typeof parsed.enrollment === 'string' && { enrollment: parsed.enrollment }), ...(typeof parsed.name === 'string' && { name: parsed.name }), ...(typeof parsed.org === 'string' && { org: parsed.org }) };
      } catch {
        // its words are not said: only the parsed state, name and org are
      }
    } finally {
      rmSync(m.codeFile, { force: true });
      this.#deps.say(`[bench] ${m.name}: the code file is removed`);
    }
    this.#deps.say(`[bench] ${m.name}: enroll exited ${code}${answer.enrollment === undefined ? '' : `: ${answer.enrollment}, ${answer.name ?? '?'} in ${answer.org ?? '?'}`}`);
    if (code !== 0 && code !== 4) throw new Error(`${m.name}: enroll failed (exit ${code}); its own output is not shown, read it with \`mawsd endpoint status\` there`);
    // the key first, as soon as the machine has posted it: nothing waits on the owner's y before they can compare it
    const keyBy = this.#now() + KEY_WITHIN_MS;
    for (;;) {
      const id = await this.#keyId();
      if (id !== null) {
        this.#deps.say(`[bench] ${m.name}: the machine's key id, to compare: ${id}`);
        break;
      }
      if (this.#now() > keyBy) throw new Error(`${m.name}: the machine posted no key to compare within ${KEY_WITHIN_MS / 1000} s, so no y is asked for`);
      await this.#sleep(STATUS_EVERY_MS);
    }
    if (code === 0) return;
    const deadline = this.#now() + ENROLL_WAIT_S * 1000; // the code's TTL, from the key shown
    for (;;) {
      // after every wait the decision is asked again, by a read of the org state now: listed, under this name
      const now = await this.#enrollment('sync');
      if (now?.enrollment === 'org-listed' && now.name === m.name) {
        this.#deps.say(`[bench] ${m.name}: listed in ${now.org ?? 'the org'}`);
        return;
      }
      if (this.#now() > deadline) throw new Error(`${m.name}: not listed in the org within the code's ${ENROLL_WAIT_S} s of its key shown (state ${now?.enrollment ?? 'unread'})`);
      await this.#sleep(STATUS_EVERY_MS);
    }
  }

  /**
   * The machine's key id from `mawsd keys --json`, null before it is posted (or unreadable). Its answer is flat
   * (`keysAnswer`, src/endpoint/answers.ts: `{enrollment, name, org, ref, delegated, keyId, heldKeys}`, `keyId` there once
   * the machine is enrolled), so the key is its top-level `keyId` (M10: attempt 1 read `{key: {keyId}}`, never there).
   */
  async #keyId(): Promise<string | null> {
    const keys = await this.#endpointAnswer('keys');
    return keys === null ? null : keyIdOf(keys);
  }

  /**
   * The mini's 1-minute load for the bench's precheck (M10): `sysctl -n vm.loadavg` through its transport, read-only,
   * with its deadline and quiet window; the reason when it is unread. Null on the VM, whose load the precheck doesn't read.
   */
  async load1(): Promise<number | string | null> {
    if (this.#m.transport.kind !== 'ssh') return null;
    const read = await this.#remote('sysctl -n vm.loadavg');
    const load = read.code === 0 ? loadOf(read.stdout) : null;
    return load ?? `its load could not be read (sysctl exit ${read.code})`;
  }

  /**
   * The agent's `serve`: the stub's session started, listed once `list` names the owners; its lines to `onLine`. Started
   * only when the quiet window is SERVE_SPAN_MS off, and ended with its cleanup QUIET_MARGIN_MS before the window however
   * long it has run.
   */
  serve(onLine: (line: string) => void): Started {
    const m = this.#m;
    this.#quiet(SERVE_SPAN_MS);
    const until = untilQuiet(quietWindows(m), this.#now());
    // the agent's own deadline, which it keeps with its cleanup done: the margin before the next window, or SERVE_MAX_MS
    const deadline = this.#now() + Math.min(SERVE_MAX_MS, until - QUIET_MARGIN_MS);
    const line = agent(m, 'serve', this.#deps.engineVersion, deadline);
    this.#scratchOnly(line);
    const serving = this.#deps.runner.start(transportArgv(m.transport, line));
    serving.onLine(onLine);
    this.#agent = serving;
    const cancel = Number.isFinite(until)
      ? (this.#deps.after ?? afterFor)(Math.max(0, until - QUIET_MARGIN_MS), () => {
          this.#deps.say(`[bench] ${m.name}: its quiet window is ${QUIET_MARGIN_MS / 60_000} minutes off: the bench agent is ended now, its session and stubs with it`);
          this.#endAgent().catch((error: unknown) => this.#deps.say(`[bench] ${m.name}: ending the bench agent failed: ${(error as Error).message}`));
        })
      : () => undefined;
    this.#teardown.push({
      what: 'the bench agent',
      step: async () => {
        cancel();
        await this.#endAgent();
      },
    });
    return serving;
  }

  /**
   * The agent ended once: its stdin's end (its session stopped, its stubs ended), killed when it outlives AGENT_END_MS,
   * and its exit waited for. Only its exit 0 shows its cleanup done on the machine: any other exit, a lost transport or a
   * kill throws, its cleanup unverified.
   */
  #endAgent(): Promise<void> {
    const serving = this.#agent;
    if (serving === null) return Promise.resolve();
    this.#ending ??= this.#endStarted(serving, 'the bench agent');
    return this.#ending;
  }

  /** A started agent process (`what`) ended: its stdin's end, killed when it outlives AGENT_END_MS, its exit waited for. */
  async #endStarted(serving: Started, what: string): Promise<void> {
    const name = this.#m.name;
    const exited = serving.exited.then((code) => ({ code }));
    serving.end();
    const first = await Promise.race([exited, this.#sleep(AGENT_END_MS).then(() => 'late' as const)]);
    if (first !== 'late') {
      if (first.code !== 0) throw new Error(`${name}: ${what} exited ${first.code ?? 'by a signal'}: its cleanup on the machine is unverified`);
      return;
    }
    serving.kill();
    if ((await Promise.race([exited, this.#sleep(AGENT_KILLED_MS).then(() => 'late' as const)])) === 'late') throw new Error(`${name}: ${what}'s transport did not exit ${AGENT_KILLED_MS / 1000} s after it was killed`);
    throw new Error(`${name}: ${what} was killed: its cleanup on the machine is unverified`);
  }

  /** Tells the agent the owner's member, so its fake sminos lists the session. */
  list(owners: readonly string[], title: string): void {
    this.#tell({ list: { owners, title } });
  }

  /** Tells the agent to send its session a turn (the live resume's, written while the app's link is held down). */
  turn(content: string): void {
    this.#tell({ turn: { content } });
  }

  #tell(message: object): void {
    if (this.#agent === null) throw new Error('the bench agent is not serving');
    if (this.#ending !== null) throw new Error(`${this.#m.name}: the bench agent is ending`);
    this.#quiet(0);
    this.#agent.write(JSON.stringify(message));
  }

  /**
   * Every resource this run holds, ended, last first: each step is attempted whatever the others did, its failure said;
   * the first failure is thrown once all have run, and "torn down" is said only when none failed.
   */
  async teardown(): Promise<void> {
    const failures: string[] = [];
    for (const { what, step } of this.#teardown.splice(0).reverse()) {
      try {
        await step();
      } catch (error) {
        failures.push(`ending ${what} failed: ${(error as Error).message}`);
        this.#deps.say(`[bench] ${this.#m.name}: ${failures.at(-1)}`);
      }
    }
    if (failures.length > 0) {
      this.#deps.say(`[bench] ${this.#m.name}: not torn down (${failures.length} step${failures.length === 1 ? '' : 's'} failed); the scratch profile ${this.#m.profile} is kept, and removed only once no bench process is left there`);
      throw new Error(`${this.#m.name}: teardown: ${failures[0]}`);
    }
    this.#deps.say(`[bench] ${this.#m.name}: torn down; the scratch profile ${this.#m.profile} is kept until the bench is done`);
  }

  /**
   * The pids of every process on the machine whose arguments name the scratch profile (the bench's: daemon, agent, stub).
   * pgrep's exit 1 is no match; any other failure (its own error, a missing pgrep, a lost transport) throws, since then
   * whether one lives is unknown.
   */
  async benchProcesses(): Promise<string[]> {
    const m = this.#m;
    // `[/]…`: the shell that runs pgrep carries the pattern in its own arguments, which the pattern then doesn't match
    const found = await this.#remote(`pgrep -f -- ${quote(profilePattern(m))}`);
    const pids = found.stdout.split('\n').map((line) => line.trim()).filter((line) => /^\d+$/.test(line));
    if (found.code === 1 && pids.length === 0) return [];
    if (found.code !== 0 || pids.length === 0) throw new Error(`${m.name}: the bench process check failed (pgrep exit ${found.code}${found.code === 0 ? ', no pid' : ''}): whether a bench process lives there is unknown`);
    return pids;
  }

  /**
   * The scratch profile's own processes ended, the scratch mawsd's never (its own stop, or mini-ops', comes first, and
   * nothing is told or signalled while it runs): its engine host and pty host told to exit through their own sockets (the agent's `stop-hosts`, whose failure is said,
   * not thrown), then any process still naming the profile ended by its pid and start time (`reapLine`), then the process
   * check. The pids left, or 'daemon' when the scratch mawsd still runs (nothing is signalled then).
   */
  async #endScratchProcesses(): Promise<string[] | 'daemon'> {
    const m = this.#m;
    const daemon = await this.#remote(scratchDaemonLine(m));
    if (daemon.code === 6) return 'daemon';
    if (daemon.code !== 0) throw new Error(`${m.name}: reading whether the scratch mawsd runs failed (exit ${daemon.code}): whether a bench process lives there is unknown`);
    const told = await this.#remote(agent(m, 'stop-hosts', this.#deps.engineVersion), { timeoutMs: 90_000 });
    if (told.code !== 0) this.#deps.say(`[bench] ${m.name}: the hosts’ own stop exited ${told.code}; any host left is ended by its pid and start time`);
    const reaped = await this.#remote(reapLine(m), { timeoutMs: 60_000 });
    if (reaped.code === 6) return 'daemon';
    if (reaped.code !== 0) throw new Error(`${m.name}: ending the processes naming the scratch profile failed (exit ${reaped.code}${reaped.code === 7 ? ': one outlived SIGKILL' : reaped.code === 3 ? ': pgrep failed' : ''})`);
    return this.benchProcesses();
  }

  /**
   * Once the bench is done: the scratch profile removed with everything the bench put in it, once its processes are
   * ended (`#endScratchProcesses`; on the VM its daemon stopped first, on the mini mini-ops stops it first and the removal
   * refuses while it runs). It refuses, saying so, and leaves the profile while a bench process still lives there; it
   * throws, removing nothing, when the profile's path goes through a symlink or the process check can't say. True when
   * the profile goes.
   */
  async removeProfile(): Promise<boolean> {
    const m = this.#m;
    if (m.stage === 'runner') await this.#stopDaemon('allowed');
    const left = await this.#endScratchProcesses();
    if (left === 'daemon') {
      this.#deps.say(`[bench] ${m.name}: refused to remove the scratch profile: its scratch mawsd still runs; ${m.stage === 'mini-ops' ? `mini-ops stops it (${stopLine(m)})` : 'it outlived its stop'}, then remove it again`);
      return false;
    }
    if (left.length > 0) {
      this.#deps.say(`[bench] ${m.name}: refused to remove the scratch profile: ${left.length} bench process${left.length === 1 ? '' : 'es'} still run${left.length === 1 ? 's' : ''} there (pids ${left.join(', ')}); end them and remove it again`);
      return false;
    }
    // the profile and all the bench put in it: the head, a tarball left by a failed unpack, the pack, the stores
    await this.#write([m.profile], `rm -rf ${quote(m.profile)}`, 'removing the scratch profile', { timeoutMs: 10 * 60_000 });
    this.#deps.say(`[bench] ${m.name}: the scratch profile is removed, its head and every bench file in it`);
    return true;
  }
}

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** The 1-minute load from macOS's `sysctl -n vm.loadavg` (`{ 1.23 1.45 1.67 }`); null when unreadable. */
export function loadOf(answer: string): number | null {
  const load = /^\{\s*(\d+(?:\.\d+)?)\s/.exec(answer.trim())?.[1];
  return load === undefined ? null : Number(load);
}

/**
 * The live bench's precheck (M10, before its local case): why it refuses to start, or null. Rule B's ceiling on a
 * 1-minute load (IDLE_RUN.maxLoad, 5) applies to this Mac, the runner, and to the mini it measures; the mini's load
 * unread (`load` a reason) refuses too. A refusal is a recorded outcome of the run, not a failure.
 */
export function loadPrecheck(loads: { mac: number; machine: { name: string; load: number | string } | null }): string | null {
  const { mac, machine } = loads;
  if (machine !== null && typeof machine.load === 'string') return `${machine.name}: ${machine.load}`;
  const over: string[] = [];
  if (mac >= IDLE_RUN.maxLoad) over.push(`this Mac’s load1 is ${mac.toFixed(2)}`);
  if (machine !== null && machine.load >= IDLE_RUN.maxLoad) over.push(`${machine.name}’s${over.length > 0 ? '' : ' load1'} is ${machine.load.toFixed(2)}`);
  return over.length === 0 ? null : `${over.join(' and ')}, at or over Rule B’s ${IDLE_RUN.maxLoad}`;
}

/** `keyId` from `mawsd keys --json`'s flat answer (`keysAnswer`); null when it is absent or the answer unreadable. */
export function keyIdOf(answer: string): string | null {
  try {
    const { keyId } = JSON.parse(answer) as { keyId?: unknown };
    return typeof keyId === 'string' && keyId !== '' ? keyId : null;
  } catch {
    return null;
  }
}

/** A tarball of M7's head from this Mac: the mini's head bundle (its Electron the pin's), or the VM's source (none). */
export interface HeadBundle {
  tar: string;
  tarBytes: number;
  unpackedBytes: number;
  electron: string | null;
  commit: string;
}

/** The VM's source: `git archive` of `commit` from `repo`, its entries checked. */
export async function buildSourceArchive(repo: string, out: string, runner: CommandRunner, commit: string): Promise<HeadBundle> {
  mkdirSync(out, { recursive: true });
  const tar = join(out, 'source.tar');
  const made = await runner.run(['git', '-C', repo, 'archive', '--format=tar', '-o', tar, commit]);
  if (made.code !== 0) throw new Error(`git archive ${commit.slice(0, 9)} failed (exit ${made.code}): ${made.stderr.trim().slice(-600)}`);
  const listed = await runner.run(['tar', '-tf', tar]);
  const problems = archiveProblems(listed.stdout.split('\n').filter(Boolean));
  if (listed.code !== 0 || problems.length > 0) throw new Error(problems.join('\n') || `tar -tf failed (exit ${listed.code})`);
  const tarBytes = statSync(tar).size;
  return { tar, tarBytes, unpackedBytes: tarBytes, electron: null, commit };
}

/** The fixtures the latency stub reads (each quoted `….jsonl` in its source), under spikes/protocol-probe/fixtures. */
export const stubFixtures = (stubSource: string): string[] => [...new Set([...stubSource.matchAll(/'([\w./-]+\.jsonl)'/g)].map((match) => match[1]!))].sort();

/** Why an archive's entries are refused: one that is absolute or climbs out with `..`. */
export const archiveProblems = (entries: readonly string[]): string[] => entries.filter((entry) => entry.startsWith('/') || entry.split('/').includes('..')).map((entry) => `the head bundle's entry ${entry} would unpack outside the head`);

const sizeOf = (dir: string): number => readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? sizeOf(join(dir, entry.name)) : entry.isFile() ? statSync(join(dir, entry.name)).size : 0), 0);

/**
 * Builds the head bundle in `out` from `repo` at `commit` (its HEAD, with no tracked change): `pnpm mawsd:pack --no-build`
 * (main's build, the externals' closure with node-pty's N-API prebuild, the session host's prebuild, no runtime on a Mac), the
 * latency stub and its fixtures beside it as the checkout lays them out, `bench-head.json` (the commit and the pinned
 * Electron, which the machine's runtime must be), and the tarball of it all, its entries checked.
 */
export async function buildHeadBundle(repo: string, out: string, runner: CommandRunner, commit: string): Promise<HeadBundle> {
  const head = await runner.run(['git', '-C', repo, 'rev-parse', 'HEAD']);
  if (head.stdout.trim() !== commit) throw new Error(`the head bundle is built from ${commit.slice(0, 9)}, and ${repo} is at ${head.stdout.trim().slice(0, 9) || '?'}`);
  if ((await runner.run(['git', '-C', repo, 'diff', '--quiet', 'HEAD'])).code !== 0) throw new Error(`${repo} has tracked changes: the head bundle is its commit's alone`);
  // --no-build: the bench's own `scripts/e2e-build.sh plain` built out/, which the bench app runs too (a main-only
  // rebuild here would change it under the app)
  const packed = await runner.run(['pnpm', '--dir', repo, '--silent', 'mawsd:pack', '--no-build', '--out', join(out, 'pack')], { timeoutMs: 20 * 60_000 });
  const pack = packed.stdout.trim().split('\n').at(-1) ?? '';
  if (packed.code !== 0 || !pack.startsWith(join(out, 'pack'))) throw new Error(`pnpm mawsd:pack failed (exit ${packed.code}): ${packed.stderr.trim().slice(-600)}`);
  const stub = 'test/support/latency-engine-stub.mjs';
  for (const file of [stub, ...stubFixtures(readFileSync(join(repo, stub), 'utf8')).map((name) => `spikes/protocol-probe/fixtures/${name}`)]) {
    mkdirSync(dirname(join(pack, file)), { recursive: true });
    cpSync(join(repo, file), join(pack, file));
  }
  const electron = (JSON.parse(readFileSync(join(repo, 'node_modules/electron/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(pack, 'bench-head.json'), `${JSON.stringify({ commit, electron })}\n`);
  const tar = join(out, 'head.tar');
  const made = await runner.run(['env', 'COPYFILE_DISABLE=1', 'tar', '-C', pack, '-cf', tar, '.']); // no AppleDouble entries
  if (made.code !== 0) throw new Error(`tar failed (exit ${made.code}): ${made.stderr.trim().slice(-600)}`);
  const listed = await runner.run(['tar', '-tf', tar]);
  const problems = archiveProblems(listed.stdout.split('\n').filter(Boolean));
  if (listed.code !== 0 || problems.length > 0) throw new Error(problems.join('\n') || `tar -tf failed (exit ${listed.code})`);
  return { tar, tarBytes: statSync(tar).size, unpackedBytes: sizeOf(pack), electron, commit };
}

/** The agent's arguments, one JSON word: what it needs of the machine, no secret. */
export function agentArgs(m: BenchMachine, engineVersion: string, deadline?: number): string {
  return JSON.stringify({ name: m.name, profile: m.profile, bench: benchDir(m), head: m.head, engineVersion, ...(deadline === undefined ? {} : { deadline }) });
}

/** Commands on this Mac's processes, every child's environment without WITHHELD_ENV. */
export function processRunner(env: NodeJS.ProcessEnv = process.env): CommandRunner {
  const childEnv = (): NodeJS.ProcessEnv => {
    const copy = { ...env };
    for (const name of WITHHELD_ENV) delete copy[name];
    return copy;
  };
  return {
    run(argv, options = {}) {
      return new Promise((resolve, reject) => {
        const fd = options.stdinFile === undefined ? null : openSync(options.stdinFile, 'r');
        let child;
        try {
          child = spawn(argv[0]!, argv.slice(1), { env: childEnv(), stdio: [fd ?? 'ignore', 'pipe', 'pipe'] });
        } finally {
          if (fd !== null) closeSync(fd); // the child holds its own copy of the descriptor
        }
        let [stdout, stderr] = ['', ''];
        child.stdout!.on('data', (chunk: Buffer) => void (stdout += chunk.toString()));
        child.stderr!.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
        // at the deadline: SIGTERM, SIGKILL after KILL_GRACE_MS, and the command answered as failed at once, whatever
        // the child does after
        let settled = false;
        const settle = (result: RunResult) => {
          if (settled) return;
          settled = true;
          if (timer !== null) clearTimeout(timer);
          resolve(result);
        };
        const timer =
          options.timeoutMs === undefined
            ? null
            : setTimeout(() => {
                child.kill('SIGTERM');
                setTimeout(() => {
                  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                }, KILL_GRACE_MS).unref();
                settle({ code: null, stdout, stderr: `${stderr}\n(timed out after ${Math.round(options.timeoutMs! / 1000)} s)` });
              }, options.timeoutMs);
        child.once('error', (error) => {
          if (timer !== null) clearTimeout(timer);
          if (!settled) reject(error);
          settled = true;
        });
        child.once('close', (code) => settle({ code, stdout, stderr }));
      });
    },
    start(argv) {
      const child = spawn(argv[0]!, argv.slice(1), { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      const listeners = new Set<(line: string) => void>();
      let buffer = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          for (const listener of listeners) listener(line);
        }
      });
      child.stderr!.on('data', () => undefined); // the agent's diagnostics stay on the machine's side
      child.stdin!.on('error', () => undefined);
      const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
      return {
        onLine: (listener) => void listeners.add(listener),
        write: (line) => void child.stdin!.write(`${line}\n`),
        end: () => void child.stdin!.end(),
        kill: () => void child.kill('SIGKILL'),
        exited,
      };
    },
  };
}
