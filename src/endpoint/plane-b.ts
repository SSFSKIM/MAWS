// Lane B's subscriptions (O10 M8; RL3): a device's subscription to a lane B session is a stream of the engine host's
// session events from the device's cursor `(launchId, seq, idx)`, whose rules (the opening's `replay`, `snapshot` or
// `missing`, the replace-whole state read under a hold of live events, the catch-up from the journal under the
// device's credit, the relaunch) live in @shared/host/stream-catchup.ts since P5 O3-D M4, which `mawsd`'s services
// front streams by too. Lane B's choice there is `from: 'start'`: a `snapshot` and a `missing` stream go on from the
// launch's first event (`seq` 0), since lane B has no other copy of the transcript a remote viewer could start from, as
// DX4's lane A snapshot carries its rows. Each answer's state is `snap {status, queue, pendingItems, catalog}`, later
// replace-whole events `snap`s of their part, the latest of each part replacing one still unsent.
//
// Live events come from `onEvent`, which delivers lane B events while they are available (none is when the endpoint
// starts, and `onAttachment` says each change): with `mawsd`'s permanent client (P5 O3-D M3) from its engine-host link's
// streaming on, app or none; with O2's recycle per attachment, only while an app is attached. While none are, a
// subscription is `paused {reason: 'no-app'}`; once they are, each catches up from its cursor and its state is read
// again, then `resumed`. Each new streaming of the engine-host link (`onUpstream {connected: true}`) has every
// subscription catch up from its cursor the same way, quietly (P5 O3-D D41: under the permanent link availability does
// not drop with the link, and what the engine host wrote to a socket that closed counts as delivered on its side).
//
// A `cards` subscription carries only the session's pending requests, hydrated, as `snap {pendingItems: [{item,
// request, context, requestDigest}]}`; it never carries an event, the queue, the catalog or the status.
import { SessionStreams, type StreamHandle, type StreamSink } from '@shared/host/stream-catchup';
import type { EndpointServices } from './services';
import type { Plane, SessionSubscription } from './subscriptions';

export { BACKLOG_BYTES, PAGE_EVENTS } from '@shared/host/stream-catchup';

export type PlaneBContext = {
  dispatch: EndpointServices['dispatch'];
  log(line: string): void;
  backlogBytes?: number;
};

/** Lane B's plane: each subscription a stream of `@shared/host/stream-catchup`, from the launch's start. */
export class PlaneB implements Plane<SessionSubscription> {
  readonly #streams: SessionStreams;
  readonly #handles = new Map<SessionSubscription, StreamHandle>();

  constructor(ctx: PlaneBContext) {
    this.#streams = new SessionStreams({
      read: (name, input) => ctx.dispatch('engine-host', name, input),
      log: (line) => ctx.log(`endpoint: ${line}`),
      backlogBytes: ctx.backlogBytes,
      available: false, // none is when the endpoint starts; `onAttachment` says each change
    });
  }

  open(sub: SessionSubscription): void {
    const handle = this.#streams.openStream({ app: sub.session.id, cursor: sub.cursor === null ? null : { epoch: sub.cursor.epoch, seq: sub.cursor.seq, ...(sub.cursor.idx === undefined ? {} : { idx: sub.cursor.idx }) }, view: sub.view, from: 'start' }, sinkOf(sub));
    this.#handles.set(sub, handle);
    // Room to send more (credit came, the device took its stream, a hold ended): the journal reads on.
    sub.onRoom = () => this.#streams.room(handle);
  }

  close(sub: SessionSubscription): void {
    const handle = this.#handles.get(sub);
    if (handle === undefined) return;
    this.#handles.delete(sub);
    sub.onRoom = null;
    this.#streams.closeStream(handle);
  }

  stop(): void {
    for (const sub of [...this.#handles.keys()]) this.close(sub);
  }

  /** Whether lane B events are available (`onAttachment`): an app's attachment, or `mawsd`'s permanent link (P5 O3-D M3). */
  attachment(attached: boolean): void {
    this.#streams.available(attached);
  }

  /** The engine-host link streams again (`onUpstream {connected: true}`; P5 O3-D D41): every stream catches up from its cursor. */
  relinked(): void {
    this.#streams.relinked();
  }

  /** A live engine-host event (`onEvent`). */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner === 'engine-host') this.#streams.liveEvent(message.name, message.payload);
  }
}

/** A subscription as the stream's reader: its messages, with `paused` and `resumed` as its control messages. */
function sinkOf(sub: SessionSubscription): StreamSink {
  return {
    get ended() {
      return sub.ended;
    },
    get backlog() {
      return sub.backlog;
    },
    subbed: (mode, at) => sub.subbed(mode, at),
    snap: (at, values, kind) => sub.snap(at, values, kind),
    ev: (at, event) => sub.ev(at, event),
    paused: () => sub.control({ t: 'paused', sub: sub.id, reason: 'no-app' }),
    resumed: () => sub.control({ t: 'resumed', sub: sub.id }),
    end: (reason) => sub.end(reason),
  };
}
