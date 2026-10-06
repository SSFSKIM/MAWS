// The project's durable cron file, `<root>/.claude/scheduled_tasks.json` (E7 execution document, Design §7): read
// through the agent-work client's `files.read` with `hash: true` (a missing file is no jobs; a refusal, a read error or
// text the engine could not load says why), and kept current through `files.watch` on `<root>/.claude` when that
// directory exists, else on the root until it appears, the choice made again on each change event that could alter it
// and on an `invalidated` watch; the watch is given back on dispose. MAWS never writes the file. The engine rewrites it
// on every resume and keeps its lock beside it, so a change whose bytes hash as before changes nothing here.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { basename, dirname, joinPath, sameFile } from '../../code/files/tree';
import { agentWorkClient, type AgentWorkClient } from '../client';
import { parseScheduledFile, projectRootOf, SCHEDULED_DIR, SCHEDULED_FILE, type DurableJob } from '../model/scheduled';

export type ScheduledFileState = { status: 'loading' } | { status: 'ok'; jobs: DurableJob[] } | { status: 'error'; message: string };

const isNotFound = (message: string) => message.startsWith('not found:'); // main's leak rule (the viewer's test)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Starts reading and watching; `onState` hears `loading`, then each read that changed what the file says. Returns the
// dispose.
export function watchScheduledFile(client: AgentWorkClient, appSessionId: AppSessionId, root: string, onState: (state: ScheduledFileState) => void): () => void {
  const dir = joinPath(root, SCHEDULED_DIR);
  const file = joinPath(dir, SCHEDULED_FILE);
  let disposed = false;
  let held: string | null = null; // the directory whose watch this holds
  let reads = 0;
  let lastHash: string | null | undefined; // the last read's hash; undefined before the first answer

  const read = async () => {
    const n = (reads += 1);
    let state: ScheduledFileState;
    try {
      const answer = await client.readFile({ appSessionId, path: file, hash: true });
      if (disposed || n !== reads) return;
      if (answer.hash !== null && answer.hash === lastHash) return;
      lastHash = answer.hash;
      const parsed = answer.encoding === 'utf8' && !answer.truncated ? parseScheduledFile(answer.content) : { ok: false as const, message: `not a text file: ${file}` };
      state = parsed.ok ? { status: 'ok', jobs: parsed.jobs } : { status: 'error', message: parsed.message };
    } catch (error) {
      if (disposed || n !== reads) return;
      lastHash = null;
      const message = messageOf(error);
      state = isNotFound(message) ? { status: 'ok', jobs: [] } : { status: 'error', message };
    }
    onState(state);
  };

  // A watch of `path`, or false when main refused it; one that answers after dispose is given back.
  const hold = async (path: string): Promise<boolean> => {
    try {
      await client.watchDir(appSessionId, path);
    } catch {
      return false;
    }
    if (!disposed) return true;
    release(path);
    return false;
  };
  const release = (path: string) => void client.unwatchDir(appSessionId, path).catch(() => {});

  // `.claude` when it exists (the root's watch then given back), else the root; neither when both are refused.
  const settle = async () => {
    if (held === dir) return;
    if (await hold(dir)) {
      if (held !== null) release(held);
      held = dir;
      return;
    }
    if (disposed || held === root) return;
    if (await hold(root)) held = root;
  };
  let settling = false;
  let again = false;
  const settleWatch = () => {
    if (settling) return void (again = true);
    settling = true;
    void (async () => {
      do {
        again = false;
        await settle();
      } while (again && !disposed);
      settling = false;
    })();
  };

  const off = client.onFilesChanged((event) => {
    if (disposed || event.appSessionId !== appSessionId || held === null) return;
    if (event.kind === 'invalidated') {
      if (!sameFile(event.path, held)) return;
      held = null; // main dropped it
      settleWatch();
      void read();
    } else if (held === dir) {
      if (sameFile(dirname(event.path), dir) || sameFile(event.path, dir)) void read();
    } else if (sameFile(dirname(event.path), root) && basename(event.path) === SCHEDULED_DIR) {
      settleWatch();
      void read();
    }
  });

  onState({ status: 'loading' });
  settleWatch();
  void read();

  return () => {
    disposed = true;
    off();
    if (held !== null) release(held);
    held = null;
  };
}

// The file of the session's project while mounted; null without a record (no project to read).
export function useScheduledFile(appSessionId: AppSessionId, record: Pick<SessionRecord, 'directory' | 'worktree'> | null): ScheduledFileState | null {
  const root = record === null ? null : projectRootOf(record);
  const [state, setState] = useState<{ key: string; value: ScheduledFileState } | null>(null);
  const key = `${appSessionId}\n${root ?? ''}`;
  useEffect(() => {
    if (root === null) return;
    return watchScheduledFile(agentWorkClient(), appSessionId, root, (value) => setState({ key, value }));
  }, [appSessionId, root, key]);
  if (root === null) return null;
  return state?.key === key ? state.value : { status: 'loading' };
}
