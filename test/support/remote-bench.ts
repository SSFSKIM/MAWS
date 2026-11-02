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
//   2. the bench agent (e2e/support/remote-bench-agent.ts, bundled here and copied over): it writes the latency stub's
//      wrapper and the scratch engine store's trust first (`prepare`, before the daemon starts), then (`serve`) starts
//      the stub's session over the scratch machine.sock and, once told the owner's member, lists it through the
//      harness's fake sminos on the scratch RL10 socket (e2e:remote's pattern), streaming the stub's samples back;
//   3. enroll: the code file streamed by its descriptor into `<transport> '<mawsd> enroll --profile … --label … --name
//      <name> --wait 900 --json'` (mawsd reads stdin without a TTY), exit 4 waited out by polling `endpoint status` until
//      org-listed or the code's TTL; the machine's key id shown for the owner to compare; the code file removed
//      whatever the outcome;
//   4. teardown, on every path: the agent ended (its stdin's end stops its session and ends its stubs; killed when it
//      outlives that, its exit waited for), the VM's daemon stopped by its pid once that pid is shown to be the daemon's;
//      every step attempted, the first failure thrown; the profile kept until the bench is done (`removeProfile`), so a
//      rerun reuses the enrollment, and then removed only once no process on the machine names it (pgrep, failing
//      closed), else refused and kept.
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
const LONGEST_SOCKET = 'mawsd/engine-host.sock';
export const ENROLL_WAIT_S = 900; // the code's TTL
const STATUS_EVERY_MS = 5_000;
const START_WITHIN_MS = 10 * 60_000; // mini-ops' start, or the VM's pack's mawsd, answering
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
  if (Buffer.byteLength(`${m.profile}/${LONGEST_SOCKET}`) > SOCKET_PATH_MAX_BYTES) problems.push(`profile ${m.profile} is too long for its sockets, which would fall back out of it`);
  for (const [what, path] of [['profile', m.profile], ['head', m.head]] as const) if (SHELL_CHARACTERS.test(path)) problems.push(`${what} ${path} holds a quote, a space or a shell character`);
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
/** The scratch daemon's program, on the VM its pack's runtime and entry (read from where the pack was recorded). */
const mawsdEntry = (m: BenchMachine) => (m.stage === 'runner' ? `"$(cat ${quote(packPath(m))})/runtime/bin/node" "$(cat ${quote(packPath(m))})/out/main/mawsd.js"` : `${runtimeWords(m)} ${quote(`${m.head}/out/main/mawsd.js`)}`);
/** A command of the scratch daemon's (status, keys, enroll), in the profile's scratch environment. */
const mawsd = (m: BenchMachine) => `${scratchEnv(m)} ${mawsdEntry(m)}`;
/** The bench agent's command, on the machine's runtime. */
const agent = (m: BenchMachine, command: 'prepare' | 'serve', engineVersion: string) => `${scratchEnv(m)} ${runtimeWords(m)} ${quote(`${benchDir(m)}/bench-agent.cjs`)} ${command} ${quote(agentArgs(m, engineVersion))}`;
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
  return `mkdir -p ${scratchDirs(m).map(quote).join(' ')} || exit 1; cd ${quote(benchDir(m))} || exit 1; ( if command -v setsid > /dev/null 2>&1; then exec setsid ${daemon}; else exec ${daemon}; fi ) & echo $! > ${quote(pidPath(m))}`;
}

/**
 * The line that stops the scratch daemon by its recorded pid, signalling it only when that pid's command line names the
 * profile's daemon directory (a pid reused by another process is never signalled): exit 0 when it has stopped or never ran,
 * 4 when the pid is another process's, 5 when it outlived SIGKILL.
 */
export function stopLine(m: BenchMachine): string {
  const dir = `${m.profile}/mawsd`;
  return `pid=$(cat ${quote(pidPath(m))} 2>/dev/null) || exit 0; case "$pid" in ''|*[!0-9]*) exit 4;; esac; args=$(ps -o args= -p "$pid" 2>/dev/null) || exit 0; case "$args" in *"--dir ${dir}"*) ;; *) exit 4;; esac; kill "$pid" 2>/dev/null; for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || exit 0; sleep 1; done; kill -9 "$pid" 2>/dev/null; sleep 1; if kill -0 "$pid" 2>/dev/null; then exit 5; fi; exit 0`;
}

/**
 * The line that shows whether the profile's existing components are real directories: the deepest existing ancestor of the
 * profile (`lexical`) and its physical path (`physical`, through `pwd -P`), then each of the profile's own paths that is a
 * symlink. Read-only; run before anything is written.
 */
export function scratchCheckLine(m: BenchMachine): string {
  const named = [...new Set([m.profile, m.head, ...scratchDirs(m)])].map(quote).join(' ');
  return `p=${quote(m.profile)}; while [ ! -e "$p" ] && [ ! -L "$p" ]; do p=$(dirname "$p"); done; printf 'lexical %s\\n' "$p"; printf 'physical %s\\n' "$(cd "$p" 2>/dev/null && pwd -P)"; for d in ${named}; do if [ -L "$d" ]; then printf 'symlink %s\\n' "$d"; fi; done`;
}

/** Why the scratch check's answer refuses every write: an ancestor reached through a symlink, or a profile path that is one. */
export function scratchCheckProblems(m: BenchMachine, stdout: string): string[] {
  const lines = stdout.split('\n');
  const field = (name: string) => lines.find((line) => line.startsWith(`${name} `))?.slice(name.length + 1);
  const [lexical, physical] = [field('lexical'), field('physical')];
  const problems: string[] = [];
  if (lexical === undefined || physical === undefined || lexical !== physical) problems.push(`${m.name}: the profile ${m.profile} goes through a symlink or an unreadable directory: ${lexical ?? '?'} is ${physical || 'unreadable'} physically`);
  else if (!(m.profile === lexical || m.profile.startsWith(lexical === '/' ? '/' : `${lexical}/`))) problems.push(`${m.name}: the scratch check walked to ${lexical}, which is no ancestor of ${m.profile}`);
  for (const line of lines.filter((l) => l.startsWith('symlink '))) problems.push(`${m.name}: ${line.slice(8)} is a symlink, which a write would follow out of the profile`);
  return problems;
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

/** The bench's hold on one machine: each step, and the teardown its steps registered, last first. */
export class BenchRun {
  readonly #m: BenchMachine;
  readonly #deps: BenchDeps;
  readonly #teardown: { what: string; step: () => Promise<void> }[] = [];
  #agent: Started | null = null;
  #ending: Promise<void> | null = null;

  constructor(machine: BenchMachine, deps: BenchDeps) {
    const problems = machineProblems(machine);
    if (problems.length > 0) throw new Error(`the bench machine's inputs are refused:\n${problems.join('\n')}`);
    this.#m = machine;
    this.#deps = deps;
  }

  get machine(): BenchMachine {
    return this.#m;
  }

  /** One command on the machine, with a timeout always (its own or REMOTE_CALL_MS), refused when it would run into a quiet window. */
  #remote(command: string, options: { stdinFile?: string; timeoutMs?: number } = {}): Promise<RunResult> {
    const timeoutMs = options.timeoutMs ?? REMOTE_CALL_MS;
    this.#quiet(timeoutMs);
    this.#scratchOnly(command);
    return this.#deps.runner.run(transportArgv(this.#m.transport, command), { ...options, timeoutMs });
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
  #now() {
    return (this.#deps.now ?? Date.now)();
  }

  /** Refuses every write when an existing component of the profile's path, or one of its own paths, is a symlink. */
  async #scratchCheck(): Promise<void> {
    const answer = await this.#must(scratchCheckLine(this.#m), 'checking the profile’s path for symlinks');
    const problems = scratchCheckProblems(this.#m, answer.stdout);
    if (problems.length > 0) throw new Error(`refused to write under the scratch profile:\n${problems.join('\n')}`);
  }
  /** The profile checked, then its own directories made, before anything else is written or run there. */
  async #scratchReady(): Promise<void> {
    await this.#scratchCheck();
    await this.#must(`mkdir -p ${scratchDirs(this.#m).map(quote).join(' ')}`, 'making the scratch profile’s directories');
  }

  /** Copies the agent's bundle (a local file) to the machine and runs its `prepare`: the stub's wrapper, the store's trust. */
  async prepare(agentBundle: string): Promise<void> {
    const m = this.#m;
    await this.#scratchReady();
    await this.#must(`cat > ${quote(`${benchDir(m)}/bench-agent.cjs`)}`, 'copying the bench agent', { stdinFile: agentBundle, timeoutMs: 5 * 60_000 });
    await this.#must(agent(m, 'prepare', this.#deps.engineVersion), 'the bench agent’s prepare');
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
    await this.#must(`rm -f ${quote(preparedPath(m))} ${quote(packPath(m))}`, 'clearing the last prep’s marks');
    await this.#unpack(source, 'source');
    await this.#must(`cd ${quote(m.head)} && ${scratchEnv(m)} pnpm install --frozen-lockfile >&2`, 'pnpm install', { timeoutMs: 30 * 60_000 });
    await this.#spawnHelpers();
    // mawsd-pack's own API with the commit named, since the unpacked source is no git checkout for it to read
    const script = `const { pack } = await import("./scripts/mawsd-pack.mjs"); process.stdout.write((await pack({ out: ${JSON.stringify(packDir(m))}, commit: ${JSON.stringify(m.commit.slice(0, 8))} })) + "\\n");`;
    const packed = await this.#must(`cd ${quote(m.head)} && ${scratchEnv(m)} ${quote(m.node)} --input-type=module -e ${quote(script)}`, 'the pack (scripts/mawsd-pack.mjs)', { timeoutMs: 30 * 60_000 });
    const pack = packed.stdout.trim().split('\n').at(-1) ?? '';
    if (containmentProblem('the pack', pack, packDir(m)) !== null) throw new Error(`${m.name}: the pack printed no path under ${packDir(m)}`);
    await this.#must(`printf '%s' ${quote(pack)} > ${quote(packPath(m))}`, 'recording the pack');
    await this.#must(`printf '%s\\n' ${m.commit} > ${quote(preparedPath(m))}`, 'recording the prep');
    this.#deps.say(`[bench] ${m.name}: prepared at ${m.commit.slice(0, 9)}: its head installed and packed in ${pack}`);
  }

  /**
   * The scratch daemon from M7's head: on the VM, the prepared pack's mawsd started here (prepare-vm first); on the mini,
   * its head bundle copied (`archive`, from `buildHeadBundle`, unless `stageHead: 'present'`) and mini-ops' start waited for.
   */
  async stage(archive?: HeadBundle): Promise<void> {
    const m = this.#m;
    await this.#scratchReady();
    if (m.stage === 'runner') {
      if (!(await this.#prepared())) throw new Error(`${m.name}: not prepared at ${m.commit.slice(0, 9)}: run prepare-vm before the sitting (MAWS_REMOTE_BENCH_PREPARE=1)`);
      await this.#must(startLine(m, mawsdEntry(m)), 'starting the scratch mawsd');
      this.#teardown.push({ what: 'the scratch mawsd', step: () => this.#stopDaemon() });
    } else {
      if (stageHeadOf(m) === 'copy') {
        if (archive === undefined) throw new Error(`${m.name}: its head is copied (stageHead copy), and no head bundle was built`);
        await this.#copyHead(archive);
      }
      this.#deps.say(`[bench] ${m.name}: mini-ops starts the scratch mawsd from ${m.head} at ${m.commit.slice(0, 9)} under the production mawsd's runtime, with:`);
      this.#deps.say(`[bench]   ${startLine(m, mawsdEntry(m))}`);
      this.#deps.say(`[bench] ${m.name}: waiting for it to answer on ${m.profile}`);
      this.#teardown.push({ what: 'the scratch mawsd', step: async () => this.#deps.say(`[bench] ${m.name}: mini-ops stops the scratch mawsd, with: ${stopLine(m)}`) });
    }
    const deadline = this.#now() + START_WITHIN_MS;
    for (;;) {
      const status = await this.#remote(`${mawsd(m)} status ${scoped(m)} --json`);
      if (status.code === 0) break;
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
    await this.#must(`cat > ${quote(tar)}`, `copying the ${name} archive`, { stdinFile: archive.tar, timeoutMs: 10 * 60_000 });
    await this.#must(`rm -rf ${quote(m.head)} && mkdir -p ${quote(m.head)} && tar -xf ${quote(tar)} -C ${quote(m.head)} && rm -f ${quote(tar)}`, `unpacking the ${name} archive`, { timeoutMs: 10 * 60_000 });
  }

  /** node-pty's spawn-helper made executable: an install that skips its scripts (or a copy of one) leaves it 0644. */
  async #spawnHelpers(): Promise<void> {
    await this.#must(`find ${quote(this.#m.head)} -path '*/node-pty/prebuilds/*/spawn-helper' -type f -exec chmod +x {} +`, 'making node-pty’s spawn-helper executable');
  }

  /** The VM's scratch daemon stopped by its recorded pid, once that pid is shown to be the daemon's. */
  async #stopDaemon(): Promise<void> {
    const m = this.#m;
    const stopped = await this.#remote(stopLine(m), { timeoutMs: 60_000 });
    if (stopped.code === 4) throw new Error(`${m.name}: refused to signal the recorded pid: its command line is not the scratch mawsd's (--dir ${m.profile}/mawsd)`);
    if (stopped.code !== 0) throw new Error(`${m.name}: stopping the scratch mawsd failed (exit ${stopped.code})`);
  }

  async #enrollment(): Promise<{ enrollment: string; name?: string; org?: string } | null> {
    const m = this.#m;
    const status = await this.#remote(`${mawsd(m)} endpoint status ${scoped(m)} --json`);
    if (status.code !== 0) return null;
    try {
      const { enrollment, name, org } = JSON.parse(status.stdout) as { enrollment: string; name?: string; org?: string };
      return { enrollment, ...(name === undefined ? {} : { name }), ...(org === undefined ? {} : { org }) };
    } catch {
      return null;
    }
  }

  /**
   * The machine enrolled and listed under its name: skipped when the scratch profile already is (a rerun); else the code
   * file streamed into `mawsd enroll`, exit 4 waited out, the key id shown, and the code file removed whatever happened.
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
    const enrollMs = (ENROLL_WAIT_S + 60) * 1000;
    this.#quiet(enrollMs); // before the code is taken: a refused enroll leaves its file for the next try
    const started = this.#now();
    let code: number | null;
    let answer: { enrollment?: string; name?: string; org?: string } = {};
    try {
      this.#deps.say(`[bench] ${m.name}: enrolling with the code from its file (the owner compares the key below and types y)`);
      const result = await this.#remote(`${mawsd(m)} enroll ${scoped(m)} --name ${quote(m.name)} --wait ${ENROLL_WAIT_S} --json`, { stdinFile: m.codeFile, timeoutMs: enrollMs });
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
    await this.showKey();
    if (code === 0) return;
    const deadline = started + ENROLL_WAIT_S * 1000;
    for (;;) {
      // after every wait the decision is asked again: listed now, under this name
      const now = await this.#enrollment();
      if (now?.enrollment === 'org-listed' && now.name === m.name) {
        this.#deps.say(`[bench] ${m.name}: listed in ${now.org ?? 'the org'}`);
        return;
      }
      if (this.#now() > deadline) throw new Error(`${m.name}: not listed in the org within the code's ${ENROLL_WAIT_S} s (state ${now?.enrollment ?? 'unread'})`);
      await this.#sleep(STATUS_EVERY_MS);
    }
  }

  /** The machine's key id, from `mawsd keys`, for the owner to compare with what their terminal shows. */
  async showKey(): Promise<void> {
    const m = this.#m;
    const keys = await this.#remote(`${mawsd(m)} keys ${scoped(m)} --json`);
    let id: string | null;
    try {
      id = (JSON.parse(keys.stdout) as { key?: { keyId?: string } | null }).key?.keyId ?? null;
    } catch {
      id = null;
    }
    this.#deps.say(id === null ? `[bench] ${m.name}: no key id to compare yet (keys exited ${keys.code})` : `[bench] ${m.name}: the machine's key id, to compare: ${id}`);
  }

  /**
   * The agent's `serve`: the stub's session started, listed once `list` names the owners; its lines to `onLine`. Started
   * only when the quiet window is SERVE_SPAN_MS off, and ended with its cleanup QUIET_MARGIN_MS before the window however
   * long it has run.
   */
  serve(onLine: (line: string) => void): Started {
    const m = this.#m;
    this.#quiet(SERVE_SPAN_MS);
    const line = agent(m, 'serve', this.#deps.engineVersion);
    this.#scratchOnly(line);
    const serving = this.#deps.runner.start(transportArgv(m.transport, line));
    serving.onLine(onLine);
    this.#agent = serving;
    const until = untilQuiet(quietWindows(m), this.#now());
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

  /** The agent ended once: its stdin's end (its session stopped, its stubs ended), killed when it outlives AGENT_END_MS, and its exit waited for. */
  #endAgent(): Promise<void> {
    const serving = this.#agent;
    if (serving === null) return Promise.resolve();
    this.#ending ??= (async () => {
      const exited = serving.exited.then(() => 'exited' as const);
      serving.end();
      if ((await Promise.race([exited, this.#sleep(AGENT_END_MS).then(() => 'late' as const)])) === 'exited') return;
      serving.kill();
      if ((await Promise.race([exited, this.#sleep(AGENT_KILLED_MS).then(() => 'late' as const)])) === 'late') throw new Error(`${this.#m.name}: the bench agent's transport did not exit ${AGENT_KILLED_MS / 1000} s after it was killed`);
    })();
    return this.#ending;
  }

  /** Tells the agent the owner's member, so its fake sminos lists the session. */
  list(owners: readonly string[], title: string): void {
    if (this.#agent === null) throw new Error('the bench agent is not serving');
    if (this.#ending !== null) throw new Error(`${this.#m.name}: the bench agent is ending`);
    this.#quiet(0);
    this.#agent.write(JSON.stringify({ list: { owners, title } }));
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
    const pattern = `[${m.profile[0]}]${m.profile.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
    const found = await this.#remote(`pgrep -f -- ${quote(pattern)}`);
    const pids = found.stdout.split('\n').map((line) => line.trim()).filter((line) => /^\d+$/.test(line));
    if (found.code === 1 && pids.length === 0) return [];
    if (found.code !== 0 || pids.length === 0) throw new Error(`${m.name}: the bench process check failed (pgrep exit ${found.code}${found.code === 0 ? ', no pid' : ''}): whether a bench process lives there is unknown`);
    return pids;
  }

  /**
   * Once the bench is done: the scratch profile removed with everything the bench put in it, unless a bench process still
   * lives on the machine (on the mini, mini-ops stops its scratch mawsd first), when it refuses, saying so, and leaves the
   * profile; it throws, removing nothing, when the profile's path goes through a symlink or the process check can't say.
   * True when the profile goes.
   */
  async removeProfile(): Promise<boolean> {
    const m = this.#m;
    await this.#scratchCheck();
    if (m.stage === 'runner') await this.#stopDaemon();
    const left = await this.benchProcesses();
    if (left.length > 0) {
      this.#deps.say(`[bench] ${m.name}: refused to remove the scratch profile: ${left.length} bench process${left.length === 1 ? '' : 'es'} still run${left.length === 1 ? 's' : ''} there (pids ${left.join(', ')}); ${m.stage === 'mini-ops' ? `mini-ops stops them (${stopLine(m)} for the daemon)` : 'end them'} and remove it again`);
      return false;
    }
    // the profile and all the bench put in it: the head, a tarball left by a failed unpack, the pack, the stores
    await this.#must(`rm -rf ${quote(m.profile)}`, 'removing the scratch profile', { timeoutMs: 10 * 60_000 });
    this.#deps.say(`[bench] ${m.name}: the scratch profile is removed, its head and every bench file in it`);
    return true;
  }
}

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

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
export function agentArgs(m: BenchMachine, engineVersion: string): string {
  return JSON.stringify({ name: m.name, profile: m.profile, bench: benchDir(m), head: m.head, engineVersion });
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
        const timer = options.timeoutMs === undefined ? null : setTimeout(() => child.kill('SIGTERM'), options.timeoutMs);
        child.once('error', (error) => {
          if (timer !== null) clearTimeout(timer);
          reject(error);
        });
        child.once('close', (code) => {
          if (timer !== null) clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
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
