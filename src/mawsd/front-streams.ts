// A services front client's session streams (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §C; D3): `session.follow` over @shared/host/stream-catchup.ts, the one module plane B streams by too.
//
// A client names the whole set of sessions it follows, each with its cursor (null for none), replacing its last: a
// stream it dropped ends, one it keeps goes on untouched, a new one opens. `live: true` also follows every other live
// session from now, and opens a stream at the first status or batch that names a session it does not follow yet (one
// just launched), from that launch's first event, so its first events reach the client. Each stream's opening sends the
// session's replace-whole parts as the engine host's own events, its latest `session.status` first (the mirror's engine
// statuses are each stream's first status, D19), then `session.queue`, `session.brokerItems` and
// `session.catalogChanged`; then the events after the cursor as `session.eventBatch`es (a `replay`), or, with no cursor
// on the current launch, live from the launch's last journaled row (`from: 'now'`: the app reads the journal on
// demand); a cursor whose range is gone answers `missing` and goes on from there too, so the client reads again. The
// answer lists each stream's mode, `live` for a stream with nothing to replay, and its launch (null while the session is
// not live: its stream opens at its first status).
//
// The streams read the engine host only while it is up: a parked host is not woken for them (a stream of it waits for
// its next launch, or the link's next streaming), and at each streaming of the engine-host link (D41) every stream
// catches up from its cursor, and a `live` client also opens the sessions it does not follow yet.
import type { SessionEvent } from '@shared/graph/events';
import { SessionStreams, STREAM_PARTS, type StreamHandle, type StreamMode, type StreamPart, type StreamPosition, type StreamRead, type StreamSink } from '@shared/host/stream-catchup';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';

/** `session.eventBatch`'s bound on its events. */
export const BATCH_EVENTS = 500;
/** The engine host's events a stream carries, through the stream's order; every other event takes the front's routes. */
export const STREAM_EVENTS: ReadonlySet<string> = new Set(['session.eventBatch', 'session.status', 'session.queue', 'session.brokerItems', 'session.catalogChanged']);

type Follow = CommandInput<'session.follow'>;
type Followed = CommandOutput<'session.follow'>;
type Answer = Followed['streams'][number];

export interface FrontStreamsOptions {
  read: StreamRead; // the engine host's reads; a refusal while it is parked
  liveSessions(): Promise<string[]>; // the sessions the engine host runs now; none while it is parked
  log(line: string): void;
}

/** One client's streams. */
export interface Follower {
  follow(input: Follow): Promise<Followed>;
  carries(appSessionId: string): boolean;
  end(): void;
}

export class FrontStreams {
  readonly #streams: SessionStreams;
  readonly #options: FrontStreamsOptions;
  readonly #followers = new Set<ClientFollower>();

  constructor(options: FrontStreamsOptions) {
    this.#options = options;
    // Availability is the link's own: a stream whose read fails waits for the next streaming (relinked).
    this.#streams = new SessionStreams({ read: options.read, log: (line) => options.log(`machine.sock: ${line}`), available: true });
  }

  /** A client's streams, posted to it with `post` (an event line, whether or not it said ready: it asked for them). */
  follower(post: (name: string, payload: unknown) => void): Follower {
    const follower = new ClientFollower(this.#streams, this.#options, post, () => this.#followers.delete(follower));
    this.#followers.add(follower);
    return follower;
  }

  /** An engine-host event a stream carries: a `live` client's new session opened first, then to every stream of it. */
  liveEvent(name: string, payload: unknown): void {
    for (const follower of this.#followers) follower.offer(name, payload);
    this.#streams.liveEvent(name, payload);
  }

  /** The engine-host link streams again: every stream catches up from its cursor, and `live` clients look for new sessions. */
  relinked(): void {
    this.#streams.relinked();
    for (const follower of this.#followers) follower.relinked();
  }

  stop(): void {
    for (const follower of [...this.#followers]) follower.end();
  }
}

class ClientFollower implements Follower {
  readonly #streams = new Map<string, ClientStream>();
  #live = false;
  #ended = false;

  constructor(
    private readonly core: SessionStreams,
    private readonly options: FrontStreamsOptions,
    private readonly post: (name: string, payload: unknown) => void,
    private readonly over: () => void,
  ) {}

  async follow(input: Follow): Promise<Followed> {
    if (this.#ended) return { streams: [] };
    const named = new Map(input.sessions.map((s) => [s.appSessionId as string, s.cursor]));
    this.#live = input.live;
    for (const [app, stream] of this.#streams) if (!named.has(app) && !(input.live && stream.auto)) this.#close(app);
    // A stream this follow opens answers its first opening, whenever that lands (the listing below may outlast it); a
    // stream it keeps answers how it goes on now.
    const opened = new Map<string, Promise<Answer>>();
    for (const [app, cursor] of named) {
      const kept = this.#streams.get(app);
      if (kept !== undefined) kept.auto = false;
      else opened.set(app, this.#open(app, cursor === null ? null : { epoch: cursor.launchId, seq: cursor.seq, idx: cursor.idx }, false, 'now').opened);
    }
    if (input.live) for (const stream of await this.#openLive('now')) opened.set(stream.app, stream.opened);
    return { streams: await Promise.all([...this.#streams.values()].map((stream) => opened.get(stream.app) ?? stream.now())) };
  }

  carries(appSessionId: string): boolean {
    return this.#streams.has(appSessionId);
  }

  /** A live event: a status or batch that names a session a `live` client does not follow yet opens its stream. */
  offer(name: string, payload: unknown): void {
    if (!this.#live || (name !== 'session.status' && name !== 'session.eventBatch')) return;
    const app = (payload as { appSessionId?: unknown } | null)?.appSessionId;
    if (typeof app === 'string' && !this.#streams.has(app)) this.#open(app, null, true, 'start');
  }

  relinked(): void {
    if (this.#live) void this.#openLive('start'); // launched while the link was down: new to this client, told by its events
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const app of [...this.#streams.keys()]) this.#close(app);
    this.over();
  }

  /** The live sessions this client does not follow yet, each opened now; the streams it opened. */
  async #openLive(from: 'start' | 'now'): Promise<ClientStream[]> {
    let live: string[];
    try {
      live = await this.options.liveSessions();
    } catch (error) {
      this.options.log(`machine.sock: the live sessions could not be listed for a follow: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    if (!this.#live || this.#ended) return [];
    return live.flatMap((app) => (this.#streams.has(app) ? [] : [this.#open(app, null, true, from)]));
  }

  #open(app: string, cursor: StreamPosition | null, auto: boolean, from: 'start' | 'now'): ClientStream {
    const stream = new ClientStream(app, auto, this.post, this.options.log);
    this.#streams.set(app, stream);
    stream.handle = this.core.openStream({ app, cursor, view: 'full', from }, stream);
    return stream;
  }

  #close(app: string): void {
    const stream = this.#streams.get(app);
    if (stream === undefined) return;
    this.#streams.delete(app);
    stream.close();
    if (stream.handle !== null) this.core.closeStream(stream.handle);
  }
}

/** One stream as its client reads it: the engine host's own events, its batches gathered per turn of the loop. */
class ClientStream implements StreamSink {
  handle: StreamHandle | null = null;
  ended = false;
  readonly backlog = 0; // a socket's own buffer is the bound: a connection that refuses a line is gone
  #epoch: string | null = null;
  #answered = false;
  #first: (answer: Answer) => void = () => {};
  /** Its first opening's answer (the mode its follow is told). */
  readonly opened = new Promise<Answer>((resolve) => (this.#first = resolve));
  #batch: SessionEvent[] = [];
  #flushing = false;

  constructor(
    readonly app: string,
    public auto: boolean,
    private readonly post: (name: string, payload: unknown) => void,
    private readonly log: (line: string) => void,
  ) {}

  /** A later follow's answer for this stream, which an earlier one opened: how it goes on now, once it opened. */
  now(): Promise<Answer> {
    return this.#answered ? Promise.resolve({ appSessionId: this.app, mode: 'live', launchId: this.#epoch } as Answer) : this.opened;
  }

  subbed(mode: StreamMode, at: StreamPosition): void {
    this.#epoch = at.epoch === '' ? null : at.epoch;
    this.#answer({ appSessionId: this.app, mode: mode === 'snapshot' ? 'live' : mode, launchId: this.#epoch } as Answer);
  }

  snap(at: StreamPosition, values: Partial<Record<StreamPart, unknown>>): void {
    if (this.ended) return;
    this.#flush();
    for (const part of STREAM_PARTS) if (values[part] !== undefined) this.post(...eventOf(this.app, part, values[part], at.epoch));
  }

  ev(_at: StreamPosition, event: SessionEvent): void {
    if (this.ended) return;
    this.#batch.push(event);
    if (this.#batch.length >= BATCH_EVENTS) return this.#flush();
    if (this.#flushing) return;
    this.#flushing = true;
    queueMicrotask(() => this.#flush());
  }

  paused(): void {}
  resumed(): void {}

  end(): void {
    // Not live (or the host away): the stream waits for its launch's first status, or the link's next streaming.
    this.log(`machine.sock: ${this.app}'s stream waits: the engine host could not be read for it`);
    this.#answer({ appSessionId: this.app, mode: 'live', launchId: null } as Answer);
  }

  close(): void {
    this.ended = true;
    this.#batch = [];
    this.#answer({ appSessionId: this.app, mode: 'live', launchId: this.#epoch } as Answer);
  }

  #answer(answer: Answer): void {
    if (this.#answered) return;
    this.#answered = true;
    this.#first(answer);
  }

  #flush(): void {
    this.#flushing = false;
    if (this.ended || this.#batch.length === 0) return;
    const events = this.#batch;
    this.#batch = [];
    for (let i = 0; i < events.length; i += BATCH_EVENTS) this.post('session.eventBatch', { appSessionId: this.app, events: events.slice(i, i + BATCH_EVENTS) });
  }
}

/** A replace-whole part as the engine-host event that carries it live. */
function eventOf(app: string, part: StreamPart, value: unknown, launchId: string): [string, unknown] {
  switch (part) {
    case 'status':
      return ['session.status', { appSessionId: app, status: value }];
    case 'queue':
      return ['session.queue', { ...(value as object), appSessionId: app }];
    case 'pendingItems':
      return ['session.brokerItems', { appSessionId: app, items: value }];
    case 'catalog':
      return ['session.catalogChanged', { appSessionId: app, launchId, catalog: value }];
  }
}
