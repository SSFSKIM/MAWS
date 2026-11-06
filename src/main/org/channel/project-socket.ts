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
// Electron-free.
import { BUILD_HEADER } from '../hub-client';
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
  sig: { alg: string; kid: string; sig: string };
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

  let closed = false;
  let socket: ProjectWebSocket | null = null;
  let welcomed = false;
  let after = deps.after;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function delay(): number {
    const steps = timing.FEED_BACKOFF_MS;
    const base = steps[Math.min(attempt, steps.length - 1)];
    attempt++;
    return Math.round(base * (1 + timing.FEED_JITTER * (2 * random() - 1)));
  }

  function retry(): void {
    if (closed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay());
    (timer as { unref?: () => void }).unref?.();
  }

  /** One socket's end, told once: a terminal code ends the client, any other retries. */
  function ended(current: ProjectWebSocket, code: number): void {
    if (socket !== current || closed) return;
    socket = null;
    welcomed = false;
    if (TERMINAL.has(code)) {
      closed = true;
      log(`ended (${code})`);
    }
    deps.onClosed(code);
    retry();
  }

  function received(current: ProjectWebSocket, frame: Record<string, unknown>): void {
    switch (frame.t) {
      case 'welcome':
        welcomed = true;
        attempt = 0;
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
        deps.onCaughtUp(frame.offset);
        return;
      default: {
        const answer = answerOf(frame);
        if (answer !== null) deps.onAnswer(answer);
      }
    }
  }

  async function connect(): Promise<void> {
    if (closed || socket !== null) return;
    const hub = deps.hub();
    if (hub === null) return; // the channel opens a new client at the session's next change
    let headers: Record<string, string>;
    try {
      headers = await hub.headers();
    } catch (error) {
      log(`the hub's headers did not resolve: ${(error as Error).message}`);
      retry();
      return;
    }
    if (closed || socket !== null) return;
    const url = `${hub.url.replace(/\/+$/, '').replace(/^http/, 'ws')}${projectSocketPath(deps.project)}`;
    let current: ProjectWebSocket;
    try {
      current = makeSocket(url, headers);
    } catch (error) {
      log(`the socket could not be made: ${(error as Error).message}`);
      retry();
      return;
    }
    socket = current;
    const joiner = new PartJoiner(log);
    current.on('open', () => {});
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
    current.on('close', (code) => ended(current, code));
    current.on('refused', (status, answer) => {
      const fromWorker = answer[BUILD_HEADER] !== undefined;
      if (!fromWorker && (status === 401 || status === 403 || (status >= 300 && status < 400))) ended(current, CLOSE_CREDENTIALS);
      else if (fromWorker && status === 403) ended(current, CLOSE_REMOVED);
      else if (fromWorker && status === 404) ended(current, CLOSE_UNKNOWN_PROJECT);
      else {
        log(`the upgrade was answered ${status}`);
        ended(current, 1006);
      }
    });
    current.on('error', (error) => {
      if (socket === current) log(`socket error: ${error.message}`);
      // a socket that never opened gets no 'close' from every stack
      if (!welcomed) ended(current, 1006);
    });
  }

  void connect();

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
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const held = socket;
      socket = null;
      held?.close();
    },
  };
}
