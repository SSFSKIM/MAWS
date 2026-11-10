// The hub's Project socket as the app reads it (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Interfaces §N; OX8): `/api/projects/<smnsId>/socket`, the project's log plane. At each `welcome` the client resumes
// after the last offset it holds (at first the cache's), follows `more` page by page until `caught-up`, and from then
// on the hub sends the log live. A device's own words go out as `{t: 'human', event}` and are answered by `human-ack`
// or `refused`, naming the words' nonce. Every other frame (`machines`, `session`, `pending`, audit rows) is ignored,
// and nothing the hub sends is trusted: the channel verifies every event (verify.ts). A frame over 1 MiB arrives as
// numbered parts and is joined here, as the Registry feed joins them.
//
// The socket's headers are the session hub's (`hub.headers()`), read at each attempt. A socket that ends is opened again
// on M1's backoff (FEED_BACKOFF_MS, jittered), and a welcome resets the waits. Three ends wait for the session's next
// change, when the channel opens a new client: a `4403` close or the Worker refusing the upgrade 403 (the hub no longer
// admits the member, `CLOSE_REMOVED`), an upgrade answered by Access rather than the Worker (the hub sign-in has ended,
// `CLOSE_CREDENTIALS`), and the Worker's 404 (no such project, `CLOSE_UNKNOWN_PROJECT`). Each close is told to
// `onClosed` with its code, a refused upgrade's as one of those three.
//
// P5 O15 M2b §G (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): the Registry feed's five rules
// (registry-feed.ts). A wake of WAKE_DROP_MS or more opens the reach's window and drops the socket, told `onClosed(1006)`
// in the same turn so the tab reads as catching up; a shorter one pings an open socket. A protocol ping every
// HUB_PING_MS from the open, a socket with no pong within HUB_PONG_MS dropped. Each open waits on the reach for the
// hub's path, WINDOW_FLOOR_MS at most (hub-socket.ts). Every end the client decides is a terminate.
//
// Electron-free.
import type { Sig } from '../../../../apps/org-protocol/src/index.ts';
import { NO_REACH, type Reach } from '../../net/reach';
import { WAKE_DROP_MS, type WakeNotice, type WakeSource } from '../../net/wake';
import { BUILD_HEADER } from '../hub-client';
import { startPings, waitForHub, type HubWait, type Pings } from '../hub-socket';
import { PartJoiner, wsSocket, type WebSocketLike } from '../registry-feed';
import type { HubAccess } from '../session';
import { orgTiming, type OrgTiming } from '../timing';

export const projectSocketPath = (project: string): string => `/api/projects/${project}/socket`;
/** The hub's close for a member a new state removed; also a Worker's 403 on the upgrade. */
export const CLOSE_REMOVED = 4403;
/** The client's own code for an upgrade Access answered: the hub sign-in has ended. */
export const CLOSE_CREDENTIALS = 4401;
/** The client's own code for the Worker's 404 on the upgrade: the hub holds no such project. */
export const CLOSE_UNKNOWN_PROJECT = 4404;
const TERMINAL: ReadonlySet<number> = new Set([CLOSE_REMOVED, CLOSE_CREDENTIALS, CLOSE_UNKNOWN_PROJECT]);

/** A device's `human` (RL8) before the hub positions it: signed by the device's channel key, carrying its nonce. */
export type DeviceHuman = {
  kind: 'human';
  from: 'human';
  member: string;
  to: '*' | Array<{ session: string; alias: string }>;
  text: string;
  created: string;
  nonce: string;
  sig: Sig;
};
export type HumanAck = { t: 'human-ack'; nonce: string; offset: number; writer: string; seq: number };
export type HumanRefused = { t: 'refused'; refusal: { reason: string; nonce: string } };
/** One stored event at its log offset, as the hub serves it: a writer and a seq, the rest unread here. */
export type LoggedEvent = { offset: number; event: Record<string, unknown> & { writer: string; seq: number } };

export type ProjectWebSocket = WebSocketLike & { send(text: string): void };

export interface ProjectSocketDeps {
  /** The session's hub, read at each attempt; null opens nothing. */
  hub(): HubAccess | null;
  project: string;
  /** The offset to resume after at the first welcome: the cache's. */
  after: number;
  /** Each welcome: the project is readable, and words not yet answered may be sent again. */
  onWelcome?(): void;
  onLog(events: LoggedEvent[]): void;
  onCaughtUp(offset: number): void;
  onAnswer(answer: HumanAck | HumanRefused): void;
  onClosed(code: number): void;
  socket?: (url: string, headers: Record<string, string>) => ProjectWebSocket;
  /** None: no wake is heard. */
  wake?: WakeSource;
  /** NO_REACH by default: no window opens, and every open is today's. */
  reach?: Reach;
  timing?: Partial<OrgTiming>;
  random?(): number;
  log(line: string): void;
}

export interface ProjectSocket {
  /** Sends the words now; false while no welcomed socket is open (they wait for the next welcome). */
  send(human: DeviceHuman): boolean;
  close(): void;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isOffset = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isSeq = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

function loggedEvents(value: unknown): LoggedEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is LoggedEvent => isObject(item) && isOffset(item.offset) && isObject(item.event) && typeof item.event.writer === 'string' && isSeq(item.event.seq));
}

function answerOf(frame: Record<string, unknown>): HumanAck | HumanRefused | null {
  if (frame.t === 'human-ack' && typeof frame.nonce === 'string' && isOffset(frame.offset) && typeof frame.writer === 'string' && isSeq(frame.seq)) {
    return { t: 'human-ack', nonce: frame.nonce, offset: frame.offset, writer: frame.writer, seq: frame.seq };
  }
  const refusal = frame.refusal;
  if (frame.t === 'refused' && isObject(refusal) && typeof refusal.reason === 'string' && typeof refusal.nonce === 'string') {
    return { t: 'refused', refusal: { reason: refusal.reason, nonce: refusal.nonce } };
  }
  return null;
}

export function openProjectSocket(deps: ProjectSocketDeps): ProjectSocket {
  const timing = orgTiming(deps.timing);
  const random = deps.random ?? Math.random;
  const log = (line: string) => deps.log(`[org-channel] ${deps.project.slice(0, 8)}: ${line}`);
  const makeSocket = deps.socket ?? wsSocket;
  const reach = deps.reach ?? NO_REACH;

  let closed = false;
  let socket: ProjectWebSocket | null = null;
  let welcomed = false;
  let after = deps.after;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** §G rule 3: the wait on the hub's path before the next open; it outlives the open the floor starts until that opens. */
  let waiting: HubWait | null = null;
  /** §G rule 2, while a socket is open. */
  let pings: Pings | null = null;
  /**
   * Each open begun, and each drop: a header read whose turn is no longer this count opens nothing, so a read begun
   * before a later open, a drop or `close()` cannot open a socket once the reason it was begun for is gone.
   */
  let opens = 0;
  /** A header read is out for the open of turn `opens`: that open is in flight, though no socket exists yet. */
  let reading = false;

  function delay(): number {
    const steps = timing.FEED_BACKOFF_MS;
    const base = steps[Math.min(attempt, steps.length - 1)];
    attempt++;
    return Math.round(base * (1 + timing.FEED_JITTER * (2 * random() - 1)));
  }

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function retry(): void {
    if (closed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      reopen();
    }, delay());
    (timer as { unref?: () => void }).unref?.();
  }

  function stopWaiting(): void {
    waiting?.cancel();
    waiting = null;
  }

  /** One open ended with nothing from the hub: a floor's open goes back to its wait, unpaced; any other backs off. */
  function failed(): void {
    if (waiting !== null) waiting.again();
    else retry();
  }

  /** One socket's end, told once: a terminal code ends the client, any other opens again. */
  function ended(current: ProjectWebSocket, code: number): void {
    if (socket !== current || closed) return;
    socket = null;
    welcomed = false;
    pings?.stop();
    pings = null;
    if (TERMINAL.has(code)) {
      closed = true;
      stopWaiting();
      offWake?.();
      log(`ended (${code})`);
    }
    deps.onClosed(code);
    failed();
  }

  /** §G: the socket dropped by the client's decision, terminated and told 1006 in the same turn; any wait for one ended. */
  function drop(): void {
    clearTimer();
    stopWaiting();
    opens++; // a header read still out opens nothing
    reading = false;
    pings?.stop();
    pings = null;
    const held = socket;
    if (held === null) return;
    socket = null;
    welcomed = false;
    held.terminate();
    deps.onClosed(1006);
  }

  function received(current: ProjectWebSocket, frame: Record<string, unknown>): void {
    switch (frame.t) {
      case 'welcome':
        welcomed = true;
        attempt = 0;
        log(`welcomed, resuming after ${after}`);
        current.send(JSON.stringify({ t: 'resume', after }));
        deps.onWelcome?.();
        return;
      case 'log': {
        const events = loggedEvents(frame.events);
        if (events.length === 0) return;
        for (const e of events) after = Math.max(after, e.offset);
        deps.onLog(events);
        return;
      }
      case 'more':
        if (!isOffset(frame.offset)) return;
        after = Math.max(after, frame.offset);
        current.send(JSON.stringify({ t: 'resume', after: frame.offset }));
        return;
      case 'caught-up':
        if (!isOffset(frame.offset)) return;
        after = Math.max(after, frame.offset);
        log(`caught up at ${frame.offset}`);
        deps.onCaughtUp(frame.offset);
        return;
      default: {
        const answer = answerOf(frame);
        if (answer !== null) deps.onAnswer(answer);
      }
    }
  }

  /** §G rule 3: an open now when no window is open, else behind the reach's answer for the hub or its floor. */
  function reopen(): void {
    if (closed || socket !== null || waiting !== null || reading) return;
    const hub = deps.hub();
    if (hub === null) return; // the channel opens a new client at the session's next change
    if (!reach.windowOpen()) return void connect();
    const wait: HubWait = waitForHub(
      reach,
      hub.url,
      {
        answered: () => {
          if (waiting !== wait) return;
          waiting = null;
          // the floor's open, not opened yet: the hub's answer ends it for an open of its own
          const floorOpen = socket;
          socket = null;
          floorOpen?.terminate();
          void connect();
        },
        floor: () => {
          if (waiting === wait && socket === null) void connect();
        },
      },
      log,
    );
    waiting = wait;
  }

  async function connect(): Promise<void> {
    if (closed || socket !== null) return;
    const turn = ++opens;
    const hub = deps.hub();
    if (hub === null) return stopWaiting(); // the channel opens a new client at the session's next change
    let headers: Record<string, string>;
    reading = true;
    try {
      headers = await hub.headers();
    } catch (error) {
      if (turn !== opens) return;
      log(`the hub's headers did not resolve: ${(error as Error).message}`);
      failed();
      return;
    } finally {
      if (turn === opens) reading = false;
    }
    if (closed || socket !== null || turn !== opens) return;
    const url = `${hub.url.replace(/\/+$/, '').replace(/^http/, 'ws')}${projectSocketPath(deps.project)}`;
    let current: ProjectWebSocket;
    try {
      current = makeSocket(url, headers);
    } catch (error) {
      log(`the socket could not be made: ${(error as Error).message}`);
      failed();
      return;
    }
    socket = current;
    const joiner = new PartJoiner(log);
    // an open made in the window is given HUB_WINDOW_OPEN_MS, so a hub whose upgrade hangs frees the socket
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const clearDeadline = () => {
      if (deadline !== null) clearTimeout(deadline);
      deadline = null;
    };
    if (reach.windowOpen()) {
      deadline = setTimeout(() => {
        deadline = null;
        if (socket !== current || closed || pings !== null) return;
        log(`the open had no answer within ${timing.HUB_WINDOW_OPEN_MS} ms`);
        current.terminate();
        ended(current, 1006);
      }, timing.HUB_WINDOW_OPEN_MS);
      (deadline as { unref?: () => void }).unref?.();
    }
    /** The hub answered the upgrade: a wait still standing behind this open (the floor's) is over. */
    const heard = () => {
      clearDeadline();
      if (socket === current) stopWaiting();
    };
    const end = (code: number) => {
      clearDeadline();
      ended(current, code);
    };
    current.on('open', () => {
      if (socket !== current || closed) return;
      heard();
      pings = startPings(current, timing, () => {
        if (socket !== current || closed) return;
        log(`no pong within ${timing.HUB_PONG_MS} ms: dropped the socket`);
        drop();
        reopen();
      });
    });
    current.on('message', (text) => {
      if (socket !== current || closed) return;
      let frame: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = JSON.parse(text);
        frame = isObject(parsed) ? joiner.add(parsed) : undefined;
      } catch {
        return;
      }
      if (frame !== undefined) received(current, frame);
    });
    current.on('close', (code) => end(code));
    current.on('refused', (status, answer) => {
      heard();
      const fromWorker = answer[BUILD_HEADER] !== undefined;
      if (!fromWorker && (status === 401 || status === 403 || (status >= 300 && status < 400))) end(CLOSE_CREDENTIALS);
      else if (fromWorker && status === 403) end(CLOSE_REMOVED);
      else if (fromWorker && status === 404) end(CLOSE_UNKNOWN_PROJECT);
      else {
        log(`the upgrade was answered ${status}`);
        end(1006);
      }
    });
    current.on('error', (error) => {
      if (socket === current) log(`socket error: ${error.message}`);
      // a socket that never opened gets no 'close' from every stack
      if (!welcomed) end(1006);
    });
  }

  /** §G rule 1: at WAKE_DROP_MS or more, the window opened and the socket dropped, then opened again from the first step; under it, an open socket pinged. */
  function woke({ sleptMs }: WakeNotice): void {
    if (closed) return;
    if (sleptMs < WAKE_DROP_MS) {
      if (pings !== null) {
        log(`wake after ${sleptMs} ms: ping sent`);
        pings.ping();
      } else if (socket !== null || waiting !== null || reading) {
        log(`wake after ${sleptMs} ms: opening`);
      } else {
        log(`wake after ${sleptMs} ms: no socket`);
        attempt = 0;
        clearTimer();
        reopen();
      }
      return;
    }
    reach.openWindow('wake');
    log(`wake after ${sleptMs} ms: ${socket !== null ? 'dropped the socket' : 'no socket'}`);
    drop();
    attempt = 0;
    reopen();
  }

  const offWake = deps.wake?.onWake(woke);
  reopen();

  return {
    send(human) {
      if (closed || socket === null || !welcomed) return false;
      try {
        socket.send(JSON.stringify({ t: 'human', event: human }));
        return true;
      } catch (error) {
        log(`the words could not be sent: ${(error as Error).message}`);
        return false;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      opens++; // a header read still out opens nothing
      reading = false;
      offWake?.();
      clearTimer();
      stopWaiting();
      pings?.stop();
      pings = null;
      const held = socket;
      socket = null;
      held?.terminate();
    },
  };
}
