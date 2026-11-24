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

// P5 O2 M7: Diagnostics' machine daemon row (`mawsd`, from main's host.status)
export const DAEMON_ROW = {
  label: 'mawsd',
  unknown: 'mawsd · unknown',
  connecting: 'connecting',
  kind: { unit: 'at login', private: 'private' } as const,
  pid: (pid: number) => `pid ${pid}`,
  build: (commit: string, buildId: string) => `build ${commit} (${buildId})`,
  machine: (ref: string) => `machine ${ref}`,
  host: (name: string, state: string, pid: number | null) => `${name} ${state}${pid === null ? '' : ` pid ${pid}`}`,
};

// P5 O3-A: the spine's refusal, beside the daemon row
export const SPINE_ROW = {
  label: 'machine data',
  refused: (why: string) => `refused this launch · ${why}`,
};

// P5 O16 M3c fix wave 2 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, D63): an update of the engine host that
// waits for MAWS tool calls to finish (host.status's `handover`): the old build serves meanwhile, or its handover is
// deferred; one copy wherever the engine host's update or starting state shows (the update banner, the Diagnostics
// row, Settings' status line). The word cut (W30): the calls counted in a person's words, no tool or engine host named.
export const ENGINE_HOST_UPDATE = {
  waiting: (inFlight: number) => `Updating after ${inFlight} running ${inFlight === 1 ? 'call' : 'calls'}`,
};

// The word cut (W27, W28, W32): what the update or the crash means for the person's sessions, without the supervisor, the
// engine host or an exit code.
const CRASHED_HEAD = 'The process that runs sessions stopped unexpectedly';
export const SUPERVISOR_NOTICES = {
  updated: (live: number) => `Updated. Finishes when ${sessions(live)} ${live === 1 ? 'goes' : 'go'} idle.`,
  incompatible: (live: number) => `Updated. New sessions start once ${live === 1 ? 'the running one goes' : `${live} running ones go`} idle.`,
  restartNow: 'Restart now',
  wait: 'Wait',
  // P5 O16 M3b (D21): `adopted`, the sessions the successor re-adopted, which kept running
  crashed: (interrupted: number, adopted = 0) => {
    if (interrupted === 0) return adopted > 0 ? `${CRASHED_HEAD}; its ${sessions(adopted)} kept running.` : `${CRASHED_HEAD}; none was interrupted.`;
    const lost = `${sessions(interrupted)} ${interrupted === 1 ? 'was' : 'were'} interrupted`;
    const resume = interrupted === 1 ? 'Open it to resume.' : 'Open one to resume.';
    return adopted > 0 ? `${lost}; ${adopted} kept running. ${resume}` : `${lost}. ${resume}`;
  },
  restartFailed: (why: string) => `The supervisor was not restarted · ${why}`, // Restart now's, wherever it is (the banners, the Diagnostics row, Settings)
};
