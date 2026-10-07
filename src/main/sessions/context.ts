// What the session service's parts share (C10 execution document, Interfaces "Session service"): the dependencies the
// service is built over, the engine host called as a function that throws its refusal, and small path facts. Kept
// free of Electron: the IPC registration (`service-register.ts`) and the Trash (`shell.trashItem`) come in from main.
import type { UserEngineDefaults } from '@shared/ipc/schema/settings'; // W3
import { access, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { CommandInput, CommandName, CommandOutput, EventName, EventPayload } from '@shared/ipc/schema';
import type { SetupIntent } from '@shared/sessions/intent';
import type { TakeOverDeps } from './take-over'; // W7
import { normalizePath } from '@shared/sessions/trust';
import { resolveStorePaths, slugOf } from '../../engine-host/fs/paths';
import type { GitRun } from '../git/runner';
import type { WorktreeService } from '../git/worktrees';
import type { ProjectStore } from '../index/projects';
import type { SessionStore } from '../index/sessions';
import type { SideThreadStore } from '../index/side-threads'; // E3
import type { HostDispatch } from '../ipc/router';
import type { C10Settings } from './launch-mapping';
import type { BootstrapNotes, IntentStore } from './intents';
import type { ReplaySeam } from './replay-seam';

// C12: main's launch gate (C12 execution document, Interfaces "Engine custody"; W13: custody retired): null, or the
// refusal the setup fails with (a host that does not hold the configured binary, or a bounded wait's)
export type LaunchGate = () => Promise<{ reason: string; message: string } | null>;

export type Emit = <N extends EventName>(name: N, payload: EventPayload<N>) => boolean;
export type HostEvents = <N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void) => () => void;

export interface SessionServiceDeps {
  index: { sessions: SessionStore; projects: Pick<ProjectStore, 'list'>; sideThreads?: SideThreadStore }; // E3: sideThreads
  // ready: the engine host answers (E10: streams, or has crashed); onReady: each later time it streams again (E10: the
  // start-time recovery deferred while `engine.sessions` could not be answered runs then)
  host: { dispatch: HostDispatch; onEvent: HostEvents; ready?: () => Promise<void>; onReady?: (listener: () => void) => () => void };
  git: GitRun;
  worktrees: WorktreeService;
  intents: IntentStore & { load(): Promise<void> };
  bootstraps: BootstrapNotes;
  userData: string; // <userData>/sessions/deletions/ lives here
  env: NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>; // the environment the engine receives (C3's login-shell capture)
  emit: Emit;
  trash: (path: string) => Promise<void>; // shell.trashItem
  reveal: (path: string) => void; // shell.showItemInFolder
  replay?: ReplaySeam | null; // the e2e seam (MAWS_E2E_REPLAY_FIXTURES)
  settings?: () => C10Settings;
  userDefaults?: () => Promise<UserEngineDefaults>; // W3: the user's own settings.json (read only); absent, none
  launchGate?: LaunchGate; // C12: consulted when a setup or a resume begins; absent, every launch may go
  takeOver?: Pick<TakeOverDeps, 'signal' | 'runStop' | 'waitMs' | 'pollMs'>; // W7: the tests' seams
  timing?: { watchdogMs?: number; stopWaitMs?: number };
  now?: () => string;
  log?: (message: string) => void;
}

export const WATCHDOG_MS = 150_000; // a launch with no status for this long fails (C3's own initialize deadline is 120 s, and 30 s for an engine that writes nothing at all)
export const STOP_WAIT_MS = 10_000; // a bootstrap stop answered { exited: false } waits this long for the exit

// A refusal the engine host answered (`{ ok: false }`), thrown with its code and message.
export class HostError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HostError';
  }
}

export async function hostCall<N extends CommandName>(dispatch: HostDispatch, name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
  const result = await dispatch('engine-host', name, input);
  if (!result.ok) throw new HostError(result.error.code, result.error.message);
  return result.value as CommandOutput<N>;
}

// C3's documented answer for an id with neither a reservation nor a store file.
export function isUnknownSession(error: unknown): boolean {
  return error instanceof HostError && /^unknown session /.test(error.message);
}

// The live reservation under an app id: a process-table entry whose process the OS has not reported exited.
export async function reservationOf(dispatch: HostDispatch, appSessionId: AppSessionId): Promise<EngineSessionStatus | null> {
  const table = await hostCall(dispatch, 'engine.sessions', undefined);
  return table.find((s) => s.appSessionId === appSessionId && s.process !== 'exited') ?? null;
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function realOrSelf(path: string): Promise<string> {
  try {
    return normalizePath(await realpath(path));
  } catch {
    return normalizePath(path);
  }
}

// The transcript a launch in `cwd` pinned to `sessionId` writes: `<projects>/<slug of the realpath>/<id>.jsonl`, under
// the config home of the engine's own environment.
export async function transcriptPathOf(env: NodeJS.ProcessEnv, cwd: string, sessionId: SessionId): Promise<string> {
  return join(resolveStorePaths(env).projects, slugOf(await realOrSelf(cwd)), `${sessionId}.jsonl`);
}

export function emptyProgress(): SetupIntent['progress'] {
  return { engineSessionId: null, worktree: null, trustRecorded: false, bootstrap: null, launch: null, send: null, lastFailure: null };
}
