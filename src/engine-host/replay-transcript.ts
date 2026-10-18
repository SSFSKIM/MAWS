// The transcript a replayed session leaves (P3-F L242). The engine writes a session's transcript when it accepts the
// session's first prompt, and main reads that file as the conversation's existence: a side thread or a fork of a
// session with none is refused (`sideThreadRefusal`, main/sessions/start-guards.ts), since `--resume <id>
// --fork-session` has nothing to copy. A replay spawns no engine, so without this every replayed conversation would
// read as a blank chat. When the replay takes the first prompt (`onFirstUser`, ./replay-transport.ts), the launcher
// writes the record the engine writes then, in the shape a recorded CLI stream-json transcript holds
// (test/fixtures/transcripts/sdk-unended.jsonl, engine 2.1.283, `entrypoint: "sdk-cli"`, MAWS's launch mode), at the
// path main reads (`transcriptPathOf`): the store's projects, the slug of the working directory's real path, the
// session's id. Created only if absent (`wx`), so a transcript a test seeded or a resumed conversation's stands.
//
// Only for the app's replay launches under C10's seam (MAWS_E2E=1 with a MAWS_E2E_REPLAY_FIXTURES list), and only into
// a config home that canonically lies under the OS temporary directory, the e2e's scratch store, proved as the OAuth
// custody guard proves its profile (main/connectors/oauth-root.ts): never ~/.claude, whatever the environment names.
// The proof names the config home by its real path, and the seed keeps every write on it: before it creates or writes
// anything, the config home must still be its own real path, and the projects and project directories it goes through
// must be directories, never symlinks (a link there would carry the write out of the scratch store); the transcript
// itself is created exclusively, so a link at its name is never followed either.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { normalizePath } from '@shared/sessions/trust';
import type { StdinFrame } from '@shared/wire/frames';
import { slugOf } from './fs/paths';

const canonical = (path: string): string | null => {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
};

// The scratch store's projects directory a replay seeds into, named by the config home's real path, or null where it
// must not write.
export function replayTranscriptProjects(env: NodeJS.ProcessEnv, tmp: string = tmpdir()): string | null {
  if (env.MAWS_E2E !== '1' || !env.MAWS_E2E_REPLAY_FIXTURES || !env.CLAUDE_CONFIG_DIR) return null;
  const config = canonical(env.CLAUDE_CONFIG_DIR);
  const root = canonical(tmp);
  if (config === null || root === null || !config.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  return join(config, 'projects'); // as resolveStorePaths (./fs/paths.ts) names it, from the real path
}

export interface ReplayTranscriptSession {
  cwd: string; // the launch's working directory
  sessionId: string; // the engine session id the launch runs under (pinned or resumed)
  engineVersion: string;
  permissionMode: string | null; // the launch's `--permission-mode`; null leaves the engine's default
}

// Writes the first prompt's record under `projects` (replayTranscriptProjects's); answers its path, or null when a
// transcript was already there. Throws, writing nothing, where the store's directories would lead out of it.
export async function seedReplayTranscript(projects: string, session: ReplayTranscriptSession, first: StdinFrame, now: Date = new Date()): Promise<string | null> {
  const cwd = normalizePath(await realpath(session.cwd).catch(() => session.cwd)); // as main's `realOrSelf`
  const name = `${session.sessionId}.jsonl`;
  if (basename(name) !== name) throw new Error(`${name} is not a transcript name`);
  const project = join(projects, slugOf(cwd)); // a slug is letters, digits and dashes: one level under projects
  const path = join(project, name);
  const prompt = first as unknown as { uuid?: unknown; message?: unknown };
  const record = {
    parentUuid: null,
    isSidechain: false,
    promptId: randomUUID(),
    type: 'user',
    message: prompt.message,
    uuid: typeof prompt.uuid === 'string' ? prompt.uuid : randomUUID(),
    timestamp: now.toISOString(),
    permissionMode: session.permissionMode ?? 'default',
    promptSource: 'sdk',
    turnOrigin: 'sdk',
    userType: 'external',
    entrypoint: 'sdk-cli',
    cwd,
    sessionId: session.sessionId,
    version: session.engineVersion,
    gitBranch: await branchOf(cwd),
  };
  const home = dirname(projects);
  if ((await realpath(home)) !== home) throw new Error(`${home} is not a directory of the scratch store`);
  await storeDirectory(projects);
  await storeDirectory(project);
  try {
    await writeFile(path, `${JSON.stringify(record)}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
  return path;
}

// One directory of the store, under one already kept: made if absent, and refused when what stands there is not a
// directory (`mkdir` never follows a link at its own name; `lstat` sees the link).
async function storeDirectory(dir: string): Promise<void> {
  await mkdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  if (!(await lstat(dir)).isDirectory()) throw new Error(`${dir} is not a directory of the scratch store`);
}

// The replay's first-prompt hook (`onFirstUser`): seeds the session's transcript and settles once it is written, there
// already, or failed (logged, never thrown), so the replay plays the prompt's reply only after it (./replay-transport.ts).
export function seedOnFirstUser(projects: string, session: ReplayTranscriptSession, log: (message: string) => void): (first: StdinFrame) => Promise<void> {
  return (first) =>
    seedReplayTranscript(projects, session, first).then(
      () => undefined,
      (error: unknown) => log(`the replay's transcript was not written: ${error instanceof Error ? error.message : String(error)}`),
    );
}

// The branch the engine records: the checkout's, `HEAD` when detached or outside a repository.
function branchOf(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5_000 }, (error, stdout) => resolve(error ? 'HEAD' : stdout.trim() || 'HEAD'));
  });
}
