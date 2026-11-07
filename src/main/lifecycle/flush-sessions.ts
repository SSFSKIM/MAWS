// A shutdown step (tracker 2026-11-06, the quit reaper): what each browser session holds in memory written to disk
// before the exit, so a reap after it (reaper.ts) loses only what Chromium itself had left: DOM storage handed to its
// writer at once, the cookie store as its flush answers. A session that fails is logged and the rest still flush.
import type { Session } from 'electron';

export type FlushableSession = Pick<Session, 'flushStorageData'> & { cookies: Pick<Session['cookies'], 'flushStore'> };

export function flushSessions(sessions: Iterable<FlushableSession>): Promise<void> {
  const flushes: Promise<void>[] = [];
  for (const ses of new Set(sessions)) {
    try {
      ses.flushStorageData();
    } catch (error) {
      console.error('[shutdown] a session’s storage did not flush; going on', error);
    }
    flushes.push(
      Promise.resolve()
        .then(() => ses.cookies.flushStore())
        .catch((error: unknown) => console.error('[shutdown] a session’s cookies did not flush; going on', error)),
    );
  }
  return Promise.all(flushes).then(() => undefined);
}
