// A transcript's life while views hold it (DC6's rules, lifted out of the pane's hook so the per-session owner runs
// them once for every view it serves): subscribed from `start` until `stop`, which closes the subscription and drops
// the store key (reopening draws a fresh snapshot); the session's liveness told to MAWS's store (DX8's `setLive`: a
// working turn ticks from the wall clock only while the process is live); and the subscription taken up again after an
// `end` other than a discontinuity, which the hub client recovers from itself:
// - at once when the session becomes reachable again (it was unreachable at some moment since its last snapshot and is
//   reachable now);
// - while it stays reachable, after a backoff of 1 s doubling to 60 s, so a machine replaced while its lease was fresh
//   (its old subscriptions ended `machine-offline`, no offline presence between) is taken up, and repeated failures (an
//   agent's transcript the machine cannot serve) are spaced retries, never a tight loop;
// - a snapshot resets the backoff; while the session is unreachable nothing is retried.
// Liveness is the session's presence (DX8: a live record and the machine's lease holding), never the subscription's: an
// ended session's subscription stays open and pageable while a view holds it.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DeskSession } from '../../shell/sessions';
import type { DeskTranscript, DepthTranscriptState, TranscriptStoreApi } from './desk-transcript';

/** A transcript is live while its session has a live process and its machine's lease holds (DX8). */
export const reachable = (session: DeskSession) => session.presence?.record != null && session.machineOnline !== false;

/** The first retry after an end while the session stays reachable, doubling up to the cap. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 60_000;

export class TranscriptKeeper {
  /** When the next retry after an end is due, in ms from when it was scheduled; null when none is. */
  readonly retry: StoreApi<{ retryIn: number | null }> = createStore(() => ({ retryIn: null as number | null }));
  private live: boolean | null = null;
  private phase: DepthTranscriptState['phase'] | null = null;
  private unreachableSince = false;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
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
    this.controller.close();
    this.store.getState().drop(this.controller.key);
    this.store.getState().setLive(this.controller.key, null);
    this.live = null;
    this.phase = null;
  }

  /** The session's liveness as its presence says it now. */
  reachable(live: boolean): void {
    if (live === this.live) return;
    if (this.live === null) this.unreachableSince = !live;
    else if (!live) this.unreachableSince = true;
    this.live = live;
    this.store.getState().setLive(this.controller.key, live);
    this.evaluate();
  }

  private evaluate(): void {
    const { phase } = this.controller.state.getState();
    this.phase = phase;
    if (this.live === null) return;
    if (phase === 'live') {
      this.unreachableSince = !this.live;
      this.attempts = 0;
    }
    if (phase !== 'ended' || !this.live) return this.cancel();
    if (this.unreachableSince) {
      this.cancel();
      this.unreachableSince = false;
      this.controller.resubscribe();
      return;
    }
    if (this.timer !== null) return;
    const delay = Math.min(RETRY_FIRST_MS * 2 ** this.attempts, RETRY_MAX_MS);
    this.attempts += 1;
    this.retry.setState({ retryIn: delay });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.retry.setState({ retryIn: null });
      this.controller.resubscribe();
    }, delay);
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.retry.getState().retryIn !== null) this.retry.setState({ retryIn: null });
  }
}
