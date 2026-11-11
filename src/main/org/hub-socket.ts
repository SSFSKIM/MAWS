// P5 O15 M2b §G (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): what the Registry feed and each Project
// socket share of §G's five rules. Rule 2, the liveness check: a WebSocket protocol ping, never an application message
// (the Registry drops one, and the Project socket refuses one with an audit row), which the hub's runtime answers itself
// without waking its object. Rule 3's wait before an open: the hub's path answering a probe of the reach, or the floor.
// Electron-free.
import { errorWords } from '@shared/host/error-words';
import { WINDOW_FLOOR_MS, type Reach } from '../net/reach';
import type { OrgTiming } from './timing';

const unref = (timer: ReturnType<typeof setTimeout>) => (timer as { unref?: () => void }).unref?.();

/** What rule 2 needs of a socket: the `ws` client's own ping and its pong event. */
export interface Pingable {
  on(event: 'pong', listener: () => void): void;
  ping(): void;
}

export interface Pings {
  /** A ping now. A ping already unanswered keeps its deadline. */
  ping(): void;
  stop(): void;
}

/**
 * Rule 2, from a socket's `open`: a ping every HUB_PING_MS, and `missed` once when a ping has no pong within
 * HUB_PONG_MS. Only a pong answers a ping.
 */
export function startPings(socket: Pingable, timing: Pick<OrgTiming, 'HUB_PING_MS' | 'HUB_PONG_MS'>, missed: () => void): Pings {
  let stopped = false;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    stopped = true;
    clearInterval(every);
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
  };
  const ping = () => {
    if (stopped) return;
    try {
      socket.ping();
    } catch {
      // a socket that cannot ping is answered by no pong: the deadline drops it
    }
    if (deadline !== null) return;
    deadline = setTimeout(() => {
      deadline = null;
      if (stopped) return;
      stop();
      missed();
    }, timing.HUB_PONG_MS);
    unref(deadline);
  };
  socket.on('pong', () => {
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
  });
  const every = setInterval(ping, timing.HUB_PING_MS);
  unref(every);
  return { ping, stop };
}

export interface HubWait {
  /** The floor's open ended with nothing from the hub: the wait goes on, and its next floor is WINDOW_FLOOR_MS from now. */
  again(): void;
  /** Ends the wait, its probing and its floor; nothing more is told. */
  cancel(): void;
}

/**
 * Rule 3's wait before an open, made while the reach's window is open: `answered` once, at the reach's answer for the
 * hub's URL (`true`, its path answered a probe; `false`, the window closed); `floor` at WINDOW_FLOOR_MS with no answer
 * yet, the wait going on behind the open it starts.
 */
export function waitForHub(reach: Reach, hub: string, on: { answered(): void; floor(): void }, log: (line: string) => void): HubWait {
  const controller = new AbortController();
  let done = false;
  let floor: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    floor = setTimeout(() => {
      floor = null;
      if (!done) on.floor();
    }, WINDOW_FLOOR_MS);
    unref(floor);
  };
  const cancel = () => {
    done = true;
    if (floor !== null) clearTimeout(floor);
    floor = null;
    controller.abort();
  };
  const answered = () => {
    if (done) return;
    cancel();
    on.answered();
  };
  arm();
  reach.reachable(hub, controller.signal).then(answered, (error: unknown) => {
    if (!done) log(`the hub's path could not be probed: ${errorWords(error)}`);
    answered();
  });
  return {
    again() {
      if (!done && floor === null) arm();
    },
    cancel,
  };
}
