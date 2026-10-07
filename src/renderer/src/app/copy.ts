// The app frame's own words (E10 execution document, §Design 11): the Diagnostics strip's supervisor row and the
// supervisor's notices (the update and incompatibility banners, the crash toast).
const sessions = (n: number) => `${n} ${n === 1 ? 'session' : 'sessions'}`;
const idleSpan = (ms: number) => (ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`);

// The exit's cause when main knows it (only for a supervisor this app run spawned): the code, else the signal.
const exitCause = (code: number | null, signal: string | null) => (code !== null ? `exit ${code}` : signal);

export const SUPERVISOR_ROW = {
  label: 'supervisor',
  unknown: 'supervisor · unknown',
  starting: 'starting',
  restarting: 'restarting',
  crashed: 'not running',
  heldLock: 'not running · another supervisor holds its lock and does not answer',
  waiting: (live: number) => `waiting · the previous version's supervisor still runs ${sessions(live)}`,
  mode: (mode: 'detached' | 'utility') => mode,
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

export const SUPERVISOR_NOTICES = {
  updated: (live: number) =>
    `MAWS was updated. ${sessions(live)} ${live === 1 ? 'is' : 'are'} still running on the previous version's supervisor; MAWS moves to the new one when they become idle. Sessions started meanwhile run on it too.`,
  incompatible: (live: number) =>
    `MAWS was updated and cannot talk to the previous supervisor, which still runs ${sessions(live)}. No session can start until it exits, which it does by itself once they go idle.`,
  restartNow: 'Restart now',
  wait: 'Wait',
  crashed: (code: number | null, signal: string | null, interrupted: number) => {
    const cause = exitCause(code, signal);
    const head = `The session supervisor stopped unexpectedly${cause ? ` (${cause})` : ''}`;
    if (interrupted === 0) return `${head}; no session was interrupted.`;
    return `${head}; ${sessions(interrupted)} ${interrupted === 1 ? 'was' : 'were'} interrupted. Their transcripts are on disk; open one to resume.`;
  },
  restartFailed: (why: string) => `The supervisor was not restarted · ${why}`, // the banners' and the row's Restart now
};
