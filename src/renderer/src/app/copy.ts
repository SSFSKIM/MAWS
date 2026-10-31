// The app frame's own words (E10 execution document, §Design 11): the Diagnostics strip's supervisor row and the
// supervisor's notices (the update and incompatibility banners, the crash toast).
const sessions = (n: number) => `${n} ${n === 1 ? 'session' : 'sessions'}`;
const idleSpan = (ms: number) => (ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`);

// The exit's cause when main knows it (only for a supervisor this app run spawned): the code, else the signal.
const exitCause = (code: number | null, signal: string | null) => (code !== null ? `exit ${code}` : signal);

// E11 §2.7: Diagnostics' app build row, which main is answering.
export const MAIN_BUILD_ROW = {
  label: 'MAWS build',
  unknown: 'MAWS · build unknown',
  line: (version: string, commit: string, builtAt: string) => `MAWS ${version} · build ${commit} · built ${builtAt}`,
};

export const SUPERVISOR_ROW = {
  label: 'supervisor',
  unknown: 'supervisor · unknown',
  starting: 'starting',
  restarting: 'restarting',
  crashed: 'not running',
  heldLock: 'not running · another supervisor holds its lock and does not answer',
  waiting: (live: number) => `waiting · the previous version's supervisor still runs ${sessions(live)}`,
  mode: (mode: 'detached' | 'utility' | 'daemon') => mode, // P5 O2 M7: daemon, the engine host behind mawsd
  pid: (pid: number) => `pid ${pid}`,
  matches: { same: 'build matches', build: 'build differs', wire: 'wire differs', protocol: 'protocol differs' },
  held: (live: number) => `${sessions(live)} held`,
  idleAfter: (ms: number) => `idle exit ${idleSpan(ms)}`,
  idleNever: 'idle exit never',
  idleWithLast: 'exits when its last session ends', // exit-when-idle armed (an update, or the incompatible wait)
  idleWithApp: 'ends with MAWS', // a utility host
  orphans: (killed: number) => `orphans killed ${killed}`,
  socket: (path: string) => `socket ${path}`,
  noExit: 'no unexpected exit',
  lastExit: (time: string, code: number | null, signal: string | null, interrupted: number) => {
    const cause = exitCause(code, signal);
    return `last unexpected exit ${time}${cause ? ` (${cause})` : ''} · ${interrupted} interrupted`;
  },
  openLog: 'Open log',
  openLogFailed: (why: string) => `The supervisor's log did not open · ${why}`,
  restartNow: 'Restart now',
};

// P5 O2 M7: Diagnostics' machine daemon row (the daemon shape's `mawsd`, from main's host.status)
export const DAEMON_ROW = {
  label: 'mawsd',
  unknown: 'mawsd · unknown',
  connecting: 'connecting',
  kind: { unit: 'at login', private: 'private' } as const,
  pid: (pid: number) => `pid ${pid}`,
  build: (commit: string, buildId: string) => `build ${commit} (${buildId})`,
  machine: (ref: string) => `machine ${ref}`,
  host: (name: string, state: string, pid: number | null) => `${name} ${state}${pid === null ? '' : ` pid ${pid}`}`,
  unavailable: (why: string) => `not in use this launch · ${why}`,
  embedded: 'not in use · MAWS runs its hosts itself',
};

// P5 O3-A: the spine's refusal, beside the daemon row
export const SPINE_ROW = {
  label: 'machine data',
  refused: (why: string) => `refused this launch · ${why}`,
};

export const SUPERVISOR_NOTICES = {
  updated: (live: number) =>
    `MAWS was updated. ${sessions(live)} ${live === 1 ? 'is' : 'are'} still running on the previous version's supervisor; MAWS moves to the new one when they become idle. Sessions started meanwhile run on it too.`,
  incompatible: (live: number) =>
    `MAWS was updated and cannot talk to the previous supervisor, which still runs ${sessions(live)}. No session can start until it exits, which it does by itself once they go idle.`,
  restartNow: 'Restart now',
  wait: 'Wait',
  // P5 O16 M3b (D21): `adopted`, the sessions the successor re-adopted; with none, E10's copy as it was
  crashed: (code: number | null, signal: string | null, interrupted: number, adopted = 0) => {
    const cause = exitCause(code, signal);
    if (adopted > 0) {
      const head = `The engine host stopped unexpectedly${cause ? ` (${cause})` : ''}`;
      const were = (n: number) => (n === 1 ? 'was' : 'were');
      if (interrupted === 0) return `${head}; its ${sessions(adopted)} ${were(adopted)} re-adopted.`;
      return `${head}; ${sessions(adopted)} ${were(adopted)} re-adopted, ${interrupted} ${were(interrupted)} interrupted. Their transcripts are on disk; open one to resume.`;
    }
    const head = `The session supervisor stopped unexpectedly${cause ? ` (${cause})` : ''}`;
    if (interrupted === 0) return `${head}; no session was interrupted.`;
    return `${head}; ${sessions(interrupted)} ${interrupted === 1 ? 'was' : 'were'} interrupted. Their transcripts are on disk; open one to resume.`;
  },
  restartFailed: (why: string) => `The supervisor was not restarted · ${why}`, // Restart now's, wherever it is (the banners, the Diagnostics row, Settings)
};
