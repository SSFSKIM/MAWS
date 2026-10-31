// `mawsd`'s command line (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6 "The commands"): every command
// but `run` (run-args.ts, the daemon itself). Each reaches the daemon through one `machine.sock` connection
// (machine-client.ts) and never starts it; `logs` and a stopped `status` read the profile's files, so they work with the
// daemon down. Its process facts (environment, platform, home, uid, the program it is, stdio and the command runner every
// `launchctl` and `systemctl` call goes through) are injected, so a test drives fakes in a scratch profile.
//
// The profile is `--profile <dir>`, else MAWS_USER_DATA, else the platform's default; the unit's label is `--label`,
// else the wrapper's MAWS_MAWSD_LABEL for MAWS_USER_DATA's profile, else `dev.maws.mawsd` for the default profile
// (install.ts). Both options are the command line's own and are taken from any position.
//
// The secret-reading commands, `enroll` (its member code) and `endpoint provision` (a `smns-provision-v2.` code, P5 O14
// M1), read the code from a hidden prompt at a terminal, else from stdin to its end, never from argv, since it carries a
// token and a pairing secret (a provisioning code a delegation's private key too): an argument the command does not know
// is refused without being echoed. The code travels only as `daemon.endpoint`'s `secret`, over machine.sock (0600), and
// nothing here prints or logs it. Each waits for the module as long as its `--wait` lets the module wait. The commands
// that take a `<file|->` (`endpoint revoke` and `grant`, P5 O10 M10) are the daemon's to read but the caller's to name:
// `-` is read from stdin here and travels as the same `secret`, and a relative path is made absolute against the
// caller's working directory, since the daemon's is its own.
import { closeSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { daemonPaths, type DaemonPaths } from '@shared/daemon/files';
import { defaultProfileDir } from '@shared/daemon/profile';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { DaemonStatusSchema, type DaemonHost, type DaemonStatus } from '@shared/ipc/schema/daemon';
import { readTolerant } from '@shared/ipc/tolerant';
import { IDENTITY_FILE, readMachineRef } from '@shared/machine/identity-file';
import { SUPERVISOR_FILES } from '../engine-host/supervisor-files';
import { PTY_HOST_FILES } from '../pty-host/files';
import { installDaemon, resolveLabel, uninstallDaemon, unitFor, type InstallDeps } from './install';
import { reachMachine, REQUEST_TIMEOUT_MS, type MachineLink } from './machine-client';
import { releasesRoot, type InstalledRelease } from './release';
import { USAGE as RUN_USAGE } from './run-args';
import { DEFAULT_LABEL, UnitError, type CommandRunner, type UnitProgram } from './units/unit';

export const EXIT = { done: 0, failed: 1, unavailable: 2, notRunning: 3, notListed: 4 } as const;
const WAIT_DEFAULT_S = 300; // a bare `--wait`'s seconds, and `provision`'s wait when it is given none (the module's)
// `endpoint attest-history`'s deadline (P5 O14 M4): the module reads every inventory writer's events from the hub page by
// page, minutes on a machine with hundreds of writers, each read bounded by the hub client's own 30 s. The run goes on
// to its end in mawsd whether or not this command still waits for it (one at a time; its outcome in mawsd's log), so this
// bound only decides how long the caller sees the outcome itself, and ends the wait on a daemon that never answers.
const ATTEST_HISTORY_TIMEOUT_MS = 60 * 60_000;
const FOLLOW_INTERVAL_MS = 500;

export const USAGE = `usage: mawsd <command> [--profile <dir>] [--label <label>]
  status [--json]                  the daemon, its machine ref and its hosts
  restart                          a new mawsd; its hosts and their sessions keep running
  logs [--follow] [--host daemon|engine|pty]
  enroll [--name <name>] [--replace] [--wait [<seconds>]] [--json]
                                   the enrollment code is read from stdin or a prompt
  keys [--json]
  endpoint <command> [<argument>…] a command of the endpoint module (P5 O10)
  endpoint provision [--name <name>] [--wait [<seconds>]] [--json]
                                   the provisioning code is read from stdin or a prompt (P5 O14)
  endpoint revoke|grant <file|->   a signed org state or grant, from a file or on stdin
  install [--delegation-id <id>] [--runtime <node>] [--entry <mawsd.js>]
                                   on Linux the default profile's unit installs the pack it runs from (pnpm mawsd:pack)
  uninstall
  ${RUN_USAGE.replace(/^usage: mawsd /, '')}
exit codes: 0 done, 1 failed, 2 not available here, 3 not running, 4 enrolled with the hub but not yet listed in the org state`;

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  cwd: string;
  uid: number;
  user: string;
  out(text: string): void;
  err(text: string): void;
  stdin: { isTTY: boolean; read(): Promise<string>; prompt(question: string): Promise<string> };
  run: CommandRunner;
  sleep(ms: number): Promise<void>;
  now(): number;
  self: UnitProgram; // the program this command line is: a unit installed from it runs the same
  build: string; // this command line's build id, for its hello
  tmp?: string;
  follow?: { intervalMs?: number; signal?: AbortSignal }; // `logs --follow`: its poll, and what ends it
}

interface Context {
  deps: CliDeps;
  profileDir: string;
  profileFrom: 'flag' | 'env' | 'default';
  labelFlag: string | undefined;
  paths: DaemonPaths;
}

class Usage extends Error {}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  try {
    const { rest, profile, label } = globalOptions(argv);
    const [command, ...args] = rest;
    if (command === undefined) throw new Usage('mawsd needs a command');
    const envProfile = deps.env.MAWS_USER_DATA || undefined;
    const profileDir = profile !== undefined ? resolve(deps.cwd, profile) : envProfile !== undefined ? resolve(deps.cwd, envProfile) : defaultProfileDir(deps.platform, deps.env, deps.home);
    const context: Context = { deps, profileDir, profileFrom: profile !== undefined ? 'flag' : envProfile !== undefined ? 'env' : 'default', labelFlag: label, paths: daemonPaths(profileDir, deps.tmp) };
    switch (command) {
      case 'status':
        return await status(context, flags(args, ['--json']).has('--json'));
      case 'restart':
        flags(args, []);
        return await restart(context);
      case 'logs':
        return await logs(context, args);
      case 'enroll':
        return await withSecret(context, 'enroll', args);
      case 'keys':
        return await keys(context, args);
      case 'endpoint':
        return await endpoint(context, args);
      case 'install':
        return await install(context, args);
      case 'uninstall':
        flags(args, []);
        return await uninstall(context);
      default:
        throw new Usage(`mawsd has no command ${command}`);
    }
  } catch (error) {
    if (error instanceof Usage) {
      deps.err(`${error.message}\n${USAGE}\n`);
      return EXIT.failed;
    }
    if (error instanceof UnitError) {
      deps.err(`${error.message}\n`);
      return error.code;
    }
    deps.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.failed;
  }
}

// --- arguments ---------------------------------------------------------------------------------------------------------

function globalOptions(argv: readonly string[]): { rest: string[]; profile?: string; label?: string } {
  const rest: string[] = [];
  const found: { profile?: string; label?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg !== '--profile' && arg !== '--label') {
      rest.push(arg);
      continue;
    }
    const value = argv[++i];
    if (!value) throw new Usage(`${arg} needs a value`);
    found[arg === '--profile' ? 'profile' : 'label'] = value;
  }
  return { rest, ...found };
}

// The flags a command takes, none with a value; anything else is refused.
function flags(args: readonly string[], known: readonly string[]): Set<string> {
  for (const arg of args) if (!known.includes(arg)) throw new Usage(`this command does not take ${arg}`);
  return new Set(args);
}

// `--name value` pairs and bare flags, by name; anything else is refused.
function options(args: readonly string[], valued: readonly string[], bare: readonly string[]): Map<string, string | true> {
  const found = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (bare.includes(arg)) found.set(arg, true);
    else if (valued.includes(arg)) {
      const value = args[++i];
      if (value === undefined) throw new Usage(`${arg} needs a value`);
      found.set(arg, value);
    } else throw new Usage(`this command does not take ${arg}`);
  }
  return found;
}

// --- status ------------------------------------------------------------------------------------------------------------

async function status(context: Context, json: boolean): Promise<number> {
  const { deps, paths } = context;
  const unit = unitState(context);
  const reached = await reachMachine(paths, { build: deps.build });
  if (!reached.ok) {
    if (reached.state === 'incompatible') return failed(deps, reached.why);
    if (reached.state === 'refused') deps.err(`mawsd is unreachable: ${reached.why}\n`);
    const ref = profileRef(context);
    if (json) deps.out(`${JSON.stringify({ running: false, unit, logPath: paths.log, machine: ref ?? null })}\n`);
    else {
      const unitLine = unit ? `unit ${unit.label} · ${unit.installed ? (unit.loaded ? 'installed, loaded' : 'installed, not loaded') : 'not installed'}` : 'unit none';
      deps.out(['mawsd not running', unitLine, `log ${paths.log}`, `machine ${ref ?? 'none'}`, ''].join('\n'));
    }
    return EXIT.notRunning;
  }
  const { link } = reached;
  try {
    const answer = await link.request('daemon.status', undefined);
    if (!answer.ok) return failed(deps, `daemon.status failed: ${answer.error.message}`);
    const read = readTolerant(DaemonStatusSchema, answer.value);
    if (!read.ok) return failed(deps, 'daemon.status answered a status this command cannot read');
    const value = read.value;
    if (json) deps.out(`${JSON.stringify({ running: true, ...value, unit })}\n`);
    else deps.out(statusText(value, `${link.welcome.protocol}.${link.welcome.minor}`, unit?.label ?? null, deps.now()));
    return EXIT.done;
  } finally {
    link.close();
  }
}

function unitState(context: Context): { label: string; installed: boolean; loaded: boolean } | null {
  const label = labelOf(context);
  if (label === null) return null;
  try {
    return { label, ...unitFor(label, installDeps(context.deps)).state() };
  } catch (error) {
    if (error instanceof UnitError && error.code === EXIT.unavailable) return null;
    throw error;
  }
}

function statusText(status: DaemonStatus, wire: string, label: string | null, now: number): string {
  const head = ['mawsd running', `pid ${status.pid}`, status.kind === 'unit' ? `unit ${label ?? '(its label is not known here)'}` : 'private', `up ${duration(now - Date.parse(status.startedAt))}`];
  if (status.idleExitAt) head.push(`idle exit in ${duration(Date.parse(status.idleExitAt) - now)}`);
  const { engineHost, ptyHost, machine } = status.clients;
  const apps = [engineHost && 'engine-host.sock', ptyHost && 'pty-host.sock'].filter(Boolean);
  const others = machine - 1; // this command is one of machine.sock's clients
  const clients = [apps.length > 0 && `app on ${apps.join(' and ')}`, others > 0 && `${others} more on machine.sock`].filter(Boolean);
  return [
    head.join(' · '),
    `build ${status.build.version} ${status.build.commit} (built ${status.build.builtAt}) · wire ${wire}`,
    `machine ${status.machine}`,
    `profile ${status.profile ?? '(not shown)'} · role ${status.role}`,
    `engine host  ${hostText(status.hosts['engine-host'])}`,
    ...(status.sessionHosts ? [sessionHostsLine(status.sessionHosts)] : []), // P5 O16 M2
    `pty host     ${hostText(status.hosts['pty-host'])}`,
    `clients      ${clients.length > 0 ? clients.join(' · ') : 'none'}`,
    `endpoint     ${JSON.stringify(status.endpoint.detail)}`,
    '',
  ].join('\n');
}

// P5 O16 M2: the engine host's session hosts, under its line (absent while it is parked or from an older one)
export function sessionHostsLine(hosts: NonNullable<DaemonStatus['sessionHosts']>): string {
  return `session hosts  ${hosts.hosts} (adopted ${hosts.adopted}, failed ${hosts.failed})`;
}

function hostText(host: DaemonHost): string {
  if (host.state === 'parked') return 'parked';
  return [host.state, host.pid !== null && `pid ${host.pid}`, host.build !== null && `build ${host.build}`, host.liveSessions !== null && `${host.liveSessions} live`].filter(Boolean).join(' · ');
}

function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(s / 86_400)}d${Math.floor((s % 86_400) / 3600)}h`;
}

// The profile's machine ref from its identity file: null when none was minted yet; undefined (said on stderr) when the
// file is there and unreadable.
function profileRef(context: Context): string | null | undefined {
  try {
    return readMachineRef(context.profileDir);
  } catch (error) {
    context.deps.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return undefined;
  }
}

// --- restart -----------------------------------------------------------------------------------------------------------

async function restart(context: Context): Promise<number> {
  const { deps } = context;
  const label = labelOf(context);
  if (label !== null) {
    const unit = unitFor(label, installDeps(deps));
    if (unit.state().installed) {
      unit.restart();
      deps.out(`restarted ${unit.name}\n`);
      return EXIT.done;
    }
  }
  return withDaemon(context, async (link) => {
    const answer = await link.request('daemon.restart', undefined);
    if (!answer.ok) return failed(deps, `daemon.restart failed: ${answer.error.message}`);
    deps.out(`asked mawsd (pid ${link.welcome.pid}) to restart: a unit daemon is started again by its unit, a private one by the next client that needs it\n`);
    return EXIT.done;
  });
}

// --- logs --------------------------------------------------------------------------------------------------------------

const LOG_HOSTS = ['daemon', 'engine', 'pty'] as const;

async function logs(context: Context, args: readonly string[]): Promise<number> {
  const { deps, paths, profileDir } = context;
  const given = options(args, ['--host'], ['--follow']);
  const host = given.get('--host');
  if (host !== undefined && !LOG_HOSTS.includes(host as (typeof LOG_HOSTS)[number])) throw new Usage(`--host is one of ${LOG_HOSTS.join(', ')}`);
  const all = { daemon: paths.log, engine: join(profileDir, 'supervisor', SUPERVISOR_FILES.log), pty: join(paths.ptyHost, PTY_HOST_FILES.log) };
  const files = host === undefined ? Object.values(all) : [all[host as keyof typeof all]];
  const headed = files.length > 1;
  const sections: string[] = [];
  let unreadable = false;
  for (const file of files) {
    let parts: (string | null)[];
    try {
      parts = [readLog(`${file}.1`), readLog(file)];
    } catch (error) {
      deps.err(`${cannotRead(file, error)}\n`);
      unreadable = true;
      if (headed) sections.push(`==> ${file} (unreadable) <==\n`);
      continue;
    }
    const present = parts.some((part) => part !== null);
    const text = parts
      .filter((part): part is string => part !== null)
      .map((part) => (part.endsWith('\n') || part === '' ? part : `${part}\n`))
      .join('');
    if (headed) sections.push(`==> ${file}${present ? '' : ' (no log yet)'} <==\n${text}`);
    else if (present) sections.push(text);
    else deps.err(`no log yet at ${file}\n`);
  }
  deps.out(sections.join('\n'));
  if (unreadable) return EXIT.failed;
  if (given.has('--follow')) {
    try {
      await follow(files, headed, deps);
    } catch (error) {
      return failed(deps, error instanceof Error ? error.message : String(error));
    }
  }
  return EXIT.done;
}

// Prints what is appended to each file, from where the print above ended, until `follow.signal` ends it (the user's
// interrupt); a rotation (a new file at the path) is read from its start. A file that cannot be read (anything but its
// absence) ends the follow with an error naming it.
async function follow(files: readonly string[], headed: boolean, deps: CliDeps): Promise<void> {
  const at = new Map(files.map((file) => [file, position(file)]));
  let last = files.at(-1);
  const signal = deps.follow?.signal;
  while (!signal?.aborted) {
    await deps.sleep(deps.follow?.intervalMs ?? FOLLOW_INTERVAL_MS);
    for (const file of files) {
      if (signal?.aborted) return;
      const now = position(file);
      const was = at.get(file)!;
      const from = now.ino !== was.ino || now.size < was.size ? 0 : was.size;
      if (now.size > from) {
        const text = readRange(file, from, now.size);
        if (text !== '') {
          if (headed && last !== file) deps.out(`\n==> ${file} <==\n`);
          deps.out(text);
          last = file;
        }
      }
      at.set(file, now);
    }
  }
}

const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const cannotRead = (file: string, error: unknown) => `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`;

// Where a file ends: an absent one reads as empty (a rotation, or a log not written yet); any other failure throws,
// naming the file.
function position(file: string): { ino: number; size: number } {
  try {
    const stat = statSync(file);
    return { ino: stat.ino, size: stat.size };
  } catch (error) {
    if (absent(error)) return { ino: -1, size: 0 };
    throw new Error(cannotRead(file, error), { cause: error });
  }
}

function readRange(file: string, from: number, to: number): string {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch (error) {
    if (absent(error)) return ''; // rotated away between the stat and the open: the next poll reads the new file
    throw new Error(cannotRead(file, error), { cause: error });
  }
  try {
    const length = Math.min(to, fstatSync(fd).size) - from;
    if (length <= 0) return '';
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, from);
    return buffer.subarray(0, read).toString('utf8');
  } catch (error) {
    throw new Error(cannotRead(file, error), { cause: error });
  } finally {
    closeSync(fd);
  }
}

// A log's text, or null when it does not exist; any other failure throws.
function readLog(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (absent(error)) return null;
    throw error;
  }
}

// --- the endpoint's commands -------------------------------------------------------------------------------------------

async function endpoint(context: Context, args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === undefined) throw new Usage('mawsd endpoint needs a command');
  if (Object.hasOwn(SECRET_COMMANDS, command)) return withSecret(context, command as SecretCommand, rest);
  if (command === 'keys') return keys(context, rest);
  const timeoutMs = command === 'attest-history' ? ATTEST_HISTORY_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  return withDaemon(context, async (link) => answered(context.deps, await link.request('daemon.endpoint', { command, args: [...rest] }, timeoutMs)));
}

// The commands that read a secret. A code's (`code`): the flags it passes to the module and how long the module waits
// when no `--wait` is given (null: it does not wait, and the request keeps its default deadline). A source's (`source`):
// its one `<file|->`, the content `-` names read from stdin to its end.
const SECRET_COMMANDS = {
  enroll: { code: 'enrollment code', flags: ['--replace', '--json'], usage: '--name <name>, --replace, --wait [<seconds>] and --json', unwaitedS: null },
  provision: { code: 'provisioning code', flags: ['--json'], usage: '--name <name>, --wait [<seconds>] and --json', unwaitedS: WAIT_DEFAULT_S },
  revoke: { source: 'signed org state' },
  grant: { source: 'signed grant' },
} as const;
type SecretCommand = keyof typeof SECRET_COMMANDS;
type CodeCommand = { [K in SecretCommand]: (typeof SECRET_COMMANDS)[K] extends { code: string } ? K : never }[SecretCommand];

// The flags a secret-reading command passes to the module, `--wait` with its seconds made explicit, and how long the
// module may wait; anything else is refused, unechoed, since it may be the code itself.
function secretFlags(command: CodeCommand, args: readonly string[]): { args: string[]; waitS: number | null } {
  const spec = SECRET_COMMANDS[command];
  const refused = new Usage(`${command} takes ${spec.usage}; the ${spec.code} is read from stdin or a prompt, never from the command line`);
  const out: string[] = [];
  let waitS: number | null = spec.unwaitedS;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if ((spec.flags as readonly string[]).includes(arg)) out.push(arg);
    else if (arg === '--name') {
      const name = args[++i];
      if (name === undefined) throw refused;
      out.push(arg, name);
    } else if (arg === '--wait') {
      const next = args[i + 1];
      waitS = next !== undefined && /^\d+$/.test(next) ? Number(args[++i]) : WAIT_DEFAULT_S;
      out.push(arg, String(waitS));
    } else throw refused;
  }
  return { args: out, waitS };
}

async function withSecret(context: Context, command: SecretCommand, rawArgs: readonly string[]): Promise<number> {
  const { deps } = context;
  const spec = SECRET_COMMANDS[command];
  if ('source' in spec) return withSource(context, command, spec.source, rawArgs);
  const { code } = spec;
  const { args, waitS } = secretFlags(command as CodeCommand, rawArgs);
  return withDaemon(context, async (link) => {
    const question = `${code[0]!.toUpperCase()}${code.slice(1)}: `;
    const secret = (deps.stdin.isTTY ? await deps.stdin.prompt(question) : await deps.stdin.read()).trim();
    if (secret === '') return failed(deps, `no ${code} was given (pipe it on stdin, or type it at the prompt)`);
    const timeoutMs = waitS === null ? REQUEST_TIMEOUT_MS : waitS * 1000 + REQUEST_TIMEOUT_MS;
    return answered(deps, await link.request('daemon.endpoint', { command, args, secret }, timeoutMs));
  });
}

// A `<file|->` command: `-`'s content from stdin as the `secret` (a terminal's typing ends at ^D), a file by the
// caller's path. Anything else beside the one source is the module's to refuse, so a flag passes as it is.
async function withSource(context: Context, command: SecretCommand, what: string, args: readonly string[]): Promise<number> {
  const { deps } = context;
  const sources = args.filter((arg) => arg === '-' || !arg.startsWith('-'));
  if (sources.length > 1) throw new Usage(`${command} takes one <file|->: the ${what}, from a file or on stdin`);
  return withDaemon(context, async (link) => {
    if (sources[0] !== '-') {
      const named = args.map((arg) => (arg === sources[0] ? resolve(deps.cwd, arg) : arg));
      return answered(deps, await link.request('daemon.endpoint', { command, args: named }));
    }
    const content = await deps.stdin.read();
    if (content.trim() === '') return failed(deps, `no ${what} came on stdin`);
    return answered(deps, await link.request('daemon.endpoint', { command, args: [...args], secret: content }));
  });
}

async function keys(context: Context, args: readonly string[]): Promise<number> {
  return withDaemon(context, async (link) => answered(context.deps, await link.request('daemon.endpoint', { command: 'keys', args: [...args] })));
}

// The module's answer: its output (stdout for 0 and 4, else stderr) and its exit code.
function answered(deps: CliDeps, answer: HostResponse): number {
  if (!answer.ok) return failed(deps, `daemon.endpoint failed: ${answer.error.message}`);
  const { code, out } = answer.value as { code: number; out: string };
  const text = out === '' || out.endsWith('\n') ? out : `${out}\n`;
  if (code === EXIT.done || code === EXIT.notListed) deps.out(text);
  else deps.err(text);
  return code;
}

// --- install and uninstall ---------------------------------------------------------------------------------------------

async function install(context: Context, args: readonly string[]): Promise<number> {
  const { deps, profileDir } = context;
  const given = options(args, ['--delegation-id', '--runtime', '--entry'], []);
  const path = (flag: string, fallback: string) => {
    const value = given.get(flag);
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Usage(`${flag} needs an absolute path`);
    return value;
  };
  const program = { runtime: path('--runtime', deps.self.runtime), entry: path('--entry', deps.self.entry) };
  const delegation = given.get('--delegation-id');
  const label = requiredLabel(context);
  // P5 O2 M8: the default profile's Linux unit runs the release directory's `current`, with that release's own runtime
  if (deps.platform === 'linux' && label === DEFAULT_LABEL && given.has('--runtime')) throw new Usage(`${label}'s unit runs its release's own runtime; --runtime is for another --label`);
  const result = await installDaemon({ profileDir, label, program, ...(typeof delegation === 'string' && { delegationId: delegation }) }, installDeps(deps));
  const change = { loaded: 'loaded', unchanged: 'unchanged', updated: 'updated and restarted' }[result.change];
  const linked = result.linked === null ? '' : result.linked === 'other' ? ` · ${join(deps.home, '.local', 'bin', 'mawsd')} is another mawsd, left as it is` : ` · linked from ${result.linked}`;
  const release = result.release === null ? [] : [releaseLine(result.release, deps.home)];
  if (result.ignoredDelegationId !== null) deps.err(`warning: ${join(profileDir, IDENTITY_FILE)} already holds the machine ref ${result.ref}, which is never re-minted; --delegation-id ${result.ignoredDelegationId} was ignored\n`); // O14 residue 9
  deps.out([...release, `unit ${result.unit.name} ${change} (${result.unit.file})`, `wrapper ${result.wrapper}${linked}`, ...(result.ref ? [`machine ${result.ref}`] : []), ''].join('\n'));
  return EXIT.done;
}

function releaseLine({ release, previous, flipped, pruned }: InstalledRelease, home: string): string {
  const current = join(releasesRoot(home), 'current');
  const head = flipped ? `release ${release} installed as ${current}${previous === null ? '' : ` (was ${previous})`}` : `release ${release} is current (${current})`;
  return pruned.length === 0 ? head : `${head} · pruned ${pruned.join(', ')}`;
}

async function uninstall(context: Context): Promise<number> {
  const { deps, profileDir } = context;
  const result = await uninstallDaemon({ profileDir, label: requiredLabel(context) }, installDeps(deps));
  deps.out(`unit ${result.unit.name} ${result.removed ? 'removed; the hosts and their sessions keep running' : 'was not installed'}\n`);
  return EXIT.done;
}

function requiredLabel(context: Context): string {
  const label = labelOf(context);
  if (label === null) throw new UnitError(`${context.profileDir} is not the default profile, so its unit is named with --label`);
  return label;
}

// --- shared ------------------------------------------------------------------------------------------------------------

function labelOf(context: Context): string | null {
  const { deps } = context;
  return resolveLabel({ profileDir: context.profileDir, profileFrom: context.profileFrom, labelFlag: context.labelFlag, env: deps.env, platform: deps.platform, home: deps.home });
}

function installDeps(deps: CliDeps): InstallDeps {
  return { platform: deps.platform, run: deps.run, home: deps.home, env: deps.env, uid: deps.uid, user: deps.user, sleep: deps.sleep };
}

// One connection to the running daemon for `work`; exit 3 when nothing answers, 1 when another protocol does.
async function withDaemon(context: Context, work: (link: MachineLink) => Promise<number>): Promise<number> {
  const { deps } = context;
  const reached = await reachMachine(context.paths, { build: deps.build });
  if (!reached.ok) {
    if (reached.state === 'incompatible') return failed(deps, reached.why);
    deps.err(`mawsd is not running (${reached.why})\n`);
    return EXIT.notRunning;
  }
  try {
    return await work(reached.link);
  } finally {
    reached.link.close();
  }
}

function failed(deps: CliDeps, why: string): number {
  deps.err(`${why}\n`);
  return EXIT.failed;
}

