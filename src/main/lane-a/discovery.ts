// Where a terminal session's bridge listens (P5 O9 M2, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, "Discovery").
// Every `claude` that loads sminos runs the bridge mod, whose child serves the session on
// `$SMINOS_HOME/bridge/<engine session id>.sock` and inherits the `claude` process's environment, so the home is found by
// sminos's own rule (`sminos.py` `root`): `SMINOS_HOME`, else `DAEMON_HOME`, else `~/.claude/sminos`. MAWS reads them
// from its own environment first (a dev run, a test, the sitting) and then from the login shell X6 captures (a
// Dock-launched app has no shell exports). A session whose `claude` ran under another home is not found, and stays
// read-only.
//
// Under a test runner (vitest, or an e2e launch) a home under the real `~/.claude` is refused, so no test's MAWS ever
// reaches the owner's sminos (acceptance 10): the real home is the account's, read from the user database, which a
// scratch `HOME` does not move.
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';

type Env = Record<string, string | undefined>;

export const SOCKET_PATH_MAX = 103; // sun_path on macOS (104 with the NUL): the bridge refuses to bind past it

const set = (value: string | undefined): string | undefined => (value === undefined || value === '' ? undefined : value);

const underTestRunner = (): boolean => Boolean(process.env.VITEST) || process.env.MAWS_E2E === '1';

export function sminosHome(env: Env, shell: Env | null, { underTest = underTestRunner(), realHome = userInfo().homedir }: { underTest?: boolean; realHome?: string } = {}): string {
  const home =
    set(env.SMINOS_HOME) ??
    set(shell?.SMINOS_HOME) ??
    set(env.DAEMON_HOME) ??
    set(shell?.DAEMON_HOME) ??
    join(set(env.HOME) ?? homedir(), '.claude', 'sminos');
  if (underTest) {
    const fromReal = relative(join(realHome, '.claude'), home);
    if (fromReal === '' || (!fromReal.startsWith('..') && !isAbsolute(fromReal))) {
      throw new Error(`lane A under a test runner resolved the sminos home ${home}, under the real ~/.claude: set SMINOS_HOME and HOME to scratch directories`);
    }
  }
  return home;
}

export function bridgeSocket(home: string, engineSessionId: string): { path: string; fits: boolean } {
  const path = join(home, 'bridge', `${engineSessionId}.sock`);
  return { path, fits: Buffer.byteLength(path) <= SOCKET_PATH_MAX };
}

export interface BridgeDirWatch {
  close(): void;
}

// Calls `onChange` with the name of each entry that changes in `<home>/bridge` (null when the platform names none, or
// when the directory itself appears). While the directory does not exist it is looked for every `pollMs`.
export function watchBridgeDir(home: string, onChange: (name: string | null) => void, { pollMs = 2000 }: { pollMs?: number } = {}): BridgeDirWatch {
  const dir = join(home, 'bridge');
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const isDir = () => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  };
  const poll = () => {
    if (closed) return;
    timer = setTimeout(() => {
      timer = null;
      if (closed) return;
      if (isDir()) {
        arm();
        onChange(null); // whatever is in it now
      } else poll();
    }, pollMs);
    timer.unref();
  };
  const arm = () => {
    try {
      watcher = watch(dir, { persistent: false }, (_event, name) => onChange(typeof name === 'string' ? name : null));
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
        poll();
      });
    } catch {
      watcher = null;
      poll();
    }
  };

  if (existsSync(dir)) arm();
  else poll();
  return {
    close() {
      closed = true;
      watcher?.close();
      if (timer) clearTimeout(timer);
    },
  };
}
