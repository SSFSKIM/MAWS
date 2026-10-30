// A profile's `mawsd` with no app (P5 O3-D M6; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, M6, acceptance 5):
// the daemon a launch's main would start for the profile (`mawsd run --private --dir <profile>/mawsd`, the built
// out/main/mawsd.js under this checkout's Electron as Node, argv0 `mawsd`), started here beside `launchMaws` for a scene
// that wants the machine without its app: e2e:machines' profile B. Its environment is the one launchMaws would give a
// private daemon (launchEnvironment's scratch over the profile: the e2e mark, the engine store `<profile>/claude-config`,
// the replay engine stub, the scratch shell and sminos homes; then the scene's own; then supervisorEnv's rewrite).
//
// - start: spawned, then ready once its log says ` serving; ` and its machine.sock answers a client (reachMachine, the
//   CLI's link) a first `session.list`, which loads the spine and, its engine host parked with no app, wakes the host
//   for its discovery pass and answers once that pass is in the index (P5 O3-D M6 fix round 1, the discovery wake,
//   src/mawsd/daemon.ts): what is on disk is listed with nobody waking the host first. `readyAt` is that answer's time:
//   what the app's window loading was for a scene that launched the profile's app, its services up.
// - request: one command over that client (a bare machine.sock client, as the CLI's), its value or a thrown error that
//   names the code and message.
// - stop: SIGTERM (the daemon's clean stop, its spine released and `spine.lock` given up), its exit's time, then every
//   process naming the profile ended (its hosts, which outlive it by design), as a launch's cleanup ends them.
// - log: `<profile>/mawsd/mawsd.log`, which a failure quotes.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { daemonPaths } from '@shared/daemon/files';
import { supervisorEnv } from '@shared/host/detached-transport';
import { reachMachine, type MachineLink } from '../../src/mawsd/machine-client';
import { writeReplayEngine } from '../../test/support/replay-engine';
import { writeScratchShellHome } from '../../test/support/shell-home';
import { REPO_ROOT } from './launch';
import { endProfileProcesses } from './processes';
import { launchEnvironment } from './scratch-env';

const MAWSD_ARGV0 = 'mawsd'; // as main's daemonStart names it (src/main/hosts/daemon.ts)
// The daemon's own start (its log's ` serving; `): a bound of O2's start, which the launch's host wait also allows
const SERVE_WITHIN_MS = 30_000;
// The first spine command's answer, the spine's cold load and the discovery wake's pass included (D24's
// launch-to-spine-ready bound)
const SPINE_WITHIN_MS = 30_000;

export interface ProfileDaemon {
  userData: string;
  claudeConfigDir: string;
  pid: number;
  readyAt: number; // when its spine first answered (Date.now())
  request<T>(name: string, input?: unknown): Promise<T>;
  log(): string;
  stop(): Promise<{ exitedAt: number; code: number | null }>;
}

export interface ProfileDaemonOptions {
  userData: string;
  env?: Record<string, string>; // the scene's own (a machine name)
  keepConfigHome?: boolean; // a relaunch keeps `<profile>/claude-config`, as launchMaws's keepConfigHome does
  prepare?: (paths: { claudeConfigDir: string }) => void; // before the daemon starts: the scene's seeded transcripts
}

// The Electron binary the daemon runs as Node (ELECTRON_RUN_AS_NODE, from supervisorEnv), as its `electron` package names it
function electronBinary(): string {
  return join(REPO_ROOT, 'node_modules', 'electron', 'dist', readFileSync(join(REPO_ROOT, 'node_modules', 'electron', 'path.txt'), 'utf8').trim());
}

export async function startProfileDaemon(opts: ProfileDaemonOptions): Promise<ProfileDaemon> {
  const { userData } = opts;
  const script = join(REPO_ROOT, 'out', 'main', 'mawsd.js');
  expect(existsSync(script), 'the build has out/main/mawsd.js (scripts/e2e-build.sh plain)').toBe(true);
  const sminosHome = mkdtempSync('/tmp/mws-'); // short, as launchMaws makes it, so a bridge's socket path fits 103 bytes
  const base: Record<string, string> = { ...launchEnvironment(process.env, userData, sminosHome) };
  const claudeConfigDir = base.CLAUDE_CONFIG_DIR!;
  if (!opts.keepConfigHome) rmSync(claudeConfigDir, { recursive: true, force: true });
  mkdirSync(claudeConfigDir, { recursive: true });
  const kept = opts.keepConfigHome && existsSync(join(userData, 'replay-engine')) ? join(userData, 'replay-engine') : null;
  base.MAWS_E2E_ENGINE_BIN = kept ?? writeReplayEngine(userData);
  Object.assign(base, writeScratchShellHome(join(userData, 'shell-home')).env, opts.env);
  opts.prepare?.({ claudeConfigDir });
  const env = supervisorEnv(base, { userData, packaged: false });

  const paths = daemonPaths(userData, env.TMPDIR);
  const logFile = join(paths.dir, 'mawsd.log');
  const log = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
  const servedBefore = log().split('\n').filter((line) => line.includes(' serving; ')).length;
  const child: ChildProcess = spawn(electronBinary(), ['--disable-sigusr1', script, 'run', '--private', '--dir', paths.dir], { env, stdio: 'ignore', argv0: MAWSD_ARGV0 });
  let exit: { exitedAt: number; code: number | null } | null = null;
  const exited = new Promise<{ exitedAt: number; code: number | null }>((resolve) => child.once('exit', (code) => resolve((exit = { exitedAt: Date.now(), code }))));
  const ended = async () => {
    await endProfileProcesses(userData);
    rmSync(sminosHome, { recursive: true, force: true });
  };

  let machine: MachineLink;
  try {
    await expect.poll(() => (exit === null ? log().split('\n').filter((line) => line.includes(' serving; ')).length : -1), { timeout: SERVE_WITHIN_MS, message: `mawsd serves:\n${log()}` }).toBeGreaterThan(servedBefore);
    const reached = await reachMachine(paths, { build: 'e2e-profile-daemon' });
    if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}\n${log()}`);
    machine = reached.link;
  } catch (error) {
    child.kill('SIGKILL');
    await ended();
    throw error;
  }
  async function request<T>(name: string, input?: unknown, timeoutMs?: number): Promise<T> {
    const answer = await machine.request(name, input, timeoutMs);
    if (!answer.ok) throw new Error(`${name}: ${answer.error.code}: ${answer.error.message}`);
    return answer.value as T;
  }
  try {
    await request('session.list', {}, SPINE_WITHIN_MS); // loads the spine, and wakes the parked engine host for its discovery pass
  } catch (error) {
    machine.close();
    child.kill('SIGKILL');
    await ended();
    throw new Error(`${(error as Error).message}\n${log()}`, { cause: error });
  }
  const readyAt = Date.now();

  return {
    userData,
    claudeConfigDir,
    pid: child.pid!,
    readyAt,
    request: (name, input) => request(name, input),
    log,
    async stop() {
      machine.close();
      if (exit === null) child.kill('SIGTERM');
      const done = await Promise.race([exited, new Promise<null>((resolve) => setTimeout(() => resolve(null), SERVE_WITHIN_MS))]);
      if (done === null) child.kill('SIGKILL');
      const result = done ?? (await exited);
      await ended();
      return result;
    },
  };
}
