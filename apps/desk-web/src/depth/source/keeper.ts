// A transcript's life while views hold it (DC6's rules, lifted out of the pane's hook so the per-session owner runs
// them once for every view it serves): subscribed from `start` until `stop`, which closes the subscription and drops
// the store key (reopening draws a fresh snapshot); the session's liveness told to MAWS's store (DX8's `setLive`: a
// working turn ticks from the wall clock only while the process is live); and the subscription taken up again after an
// `end` other than a discontinuity, which the hub client recovers from itself:
// - at once when the session becomes reachable again (it was unreachable at some moment since its last snapshot and is
//   reachable now);
// - at once after an `end {machine-offline}` while the session stays reachable: the machine's stream to the hub was
//   replaced or closed while its presence held, and the hub serves a subscribe that arrives while the machine is
//   between streams at its next stream's hello (or the new stream is up already);
// - otherwise, while it stays reachable, after a backoff of 1 s doubling to 60 s (a second `machine-offline` in a row
//   included), so repeated failures (an agent's transcript the machine cannot serve) are spaced retries, never a tight
//   loop;
// - a snapshot resets the backoff and the immediate retry; while the session is unreachable nothing is retried.
// Liveness is the session's presence (DX8: a live record and the machine's lease holding), never the subscription's: an
// ended session's subscription stays open and pageable while a view holds it.
//
// What the views say of a disruption (`notice`). A transcript that holds rows keeps drawing them through an interruption
// and through an `end {machine-offline}` (`desk-transcript.ts`), and for `QUIET_MS` the views say nothing of it — no
// "Reconnecting…", no ended line, no "Unavailable" — since a machine's or the browser's reconnect of a second or two is
// the common case (desk ticket #57), and saying so would only flicker. Past it they say what is true now. The span is
// the hub's: it holds a closed machine stream's presence for one 15 s heartbeat, so a gap longer than that is an outage.
// A transcript with no rows (a first open) says so at once; so does a disruption once its session is known unreachable
// or its subscription ends for any reason but the machine's stream, and from then until the next snapshot.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DeskSession } from '../../shell/sessions';
import type { DeskTranscript, DepthTranscriptState, TranscriptStoreApi } from './desk-transcript';

/**
 * What the session's presence says now (DX8): reachable — a live process, its machine's lease holding — and so its
 * transcript live; unreachable — no process, or the machine offline; or unknown — no presence since the project socket's
 * last welcome, which clears what was known (`project/connection.ts`) until the hub sends it again, as after every
 * reconnect.
 */
export type Reach = 'reachable' | 'unreachable' | 'unknown';
export const reachOf = (session: DeskSession): Reach =>
  session.machineOnline === false ? 'unreachable' : session.presence == null ? 'unknown' : session.presence.record != null ? 'reachable' : 'unreachable';

/** The first retry after an end while the session stays reachable, doubling up to the cap. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 60_000;
/** How long a disruption of a transcript that holds rows goes unsaid: the hub's grace for a closed machine stream. */
export const QUIET_MS = 15_000;

/** What the views say of the transcript beyond its own state. */
export type KeeperNotice = {
  /** When the next retry after an end is due, in ms from when it was scheduled; null when none is. */
  retryIn: number | null;
  /** A disruption is under way that the views do not mention yet. */
  quiet: boolean;
};

/** An interruption, or the machine's stream ending under the transcript: what a reconnect looks like from here. */
const disrupted = ({ phase, ended }: Pick<DepthTranscriptState, 'phase' | 'ended'>) => phase === 'reconnecting' || (phase === 'ended' && ended?.reason === 'machine-offline');

export class TranscriptKeeper {
  readonly notice: StoreApi<KeeperNotice> = createStore<KeeperNotice>(() => ({ retryIn: null, quiet: false }));
  private live: boolean | null = null;
  private reach: Reach | null = null;
  private phase: DepthTranscriptState['phase'] | null = null;
  private unreachableSince = false;
  private attempts = 0;
  /** The immediate retry after an `end {machine-offline}` has been taken since the last snapshot. */
  private retriedAtOnce = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** A disruption began since the last snapshot. */
  private disruption = false;
  /** Runs while that disruption is quiet: younger than `QUIET_MS`, and not said early. */
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private off: (() => void) | null = null;

  constructor(
    readonly controller: DeskTranscript,
    private readonly store: TranscriptStoreApi,
  ) {}

  start(): void {
    this.controller.open();
    this.off ??= this.controller.state.subscribe((state) => {
      if (state.phase !== this.phase) this.evaluate();
    });
    this.evaluate();
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.cancel();
    this.disruption = false;
    this.unquiet();
    this.controller.close();
    this.store.getState().drop(this.controller.key);
    this.store.getState().setLive(this.controller.key, null);
    this.live = null;
    this.reach = null;
    this.phase = null;
  }

  /** The session's reach as its presence says it now: live only while reachable; not known is not live. */
  reachable(reach: Reach): void {
    const known = this.reach;
    this.reach = reach;
    const live = reach === 'reachable';
    if (live === this.live) {
      if (reach !== known) this.quietFor(this.controller.state.getState());
      return;
    }
    if (this.live === null) this.unreachableSince = !live;
    else if (!live) this.unreachableSince = true;
    this.live = live;
    this.store.getState().setLive(this.controller.key, live);
    this.evaluate();
  }

  private evaluate(): void {
    const state = this.controller.state.getState();
    const { phase, ended } = state;
    this.phase = phase;
    this.quietFor(state);
    if (this.live === null) return;
    if (phase === 'live') {
      this.unreachableSince = !this.live;
      this.attempts = 0;
      this.retriedAtOnce = false;
    }
    if (phase !== 'ended' || !this.live) return this.cancel();
    const atOnce = !this.unreachableSince && ended?.reason === 'machine-offline' && !this.retriedAtOnce;
    if (this.unreachableSince || atOnce) {
      this.cancel();
      this.unreachableSince = false;
      if (atOnce) this.retriedAtOnce = true;
      this.controller.resubscribe();
      return;
    }
    if (this.timer !== null) return;
    const delay = Math.min(RETRY_FIRST_MS * 2 ** this.attempts, RETRY_MAX_MS);
    this.attempts += 1;
    this.notice.setState({ retryIn: delay });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.notice.setState({ retryIn: null });
      this.controller.resubscribe();
    }, delay);
  }

  /**
   * The quiet window: opened by the first disruption since the last snapshot of a transcript that holds rows, and closed
   * by the next snapshot, by `QUIET_MS` passing, or early, for good until that snapshot, once the session is known
   * unreachable or the transcript is no longer in a disruption (it ended for another reason). Presence not known is no
   * reason: a socket's reconnect clears it until the hub sends it again, and that is the gap the window hides.
   */
  private quietFor(state: DepthTranscriptState): void {
    if (state.phase === 'live') {
      this.disruption = false;
      this.unquiet();
    } else if (!this.disruption && disrupted(state)) {
      this.disruption = true;
      if (this.controller.heldRows().length > 0) this.quietTimer = setTimeout(() => this.unquiet(), QUIET_MS);
    }
    if (!disrupted(state) || this.reach === 'unreachable') this.unquiet();
    if (this.quietTimer !== null && !this.notice.getState().quiet) this.notice.setState({ quiet: true });
  }

  private unquiet(): void {
    if (this.quietTimer !== null) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    if (this.notice.getState().quiet) this.notice.setState({ quiet: false });
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.notice.getState().retryIn !== null) this.notice.setState({ retryIn: null });
  }
}
