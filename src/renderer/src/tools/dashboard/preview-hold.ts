// E3 panel residual (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16 (3); R1b: a displayed
// preview is held): the hold over the snapshots a dashboard tab's displayed history preview or suggestion review names,
// so retention never takes what it shows, whatever version pinned it being pruned or thinned meanwhile.
//
// - One lease (the tab reader's `holdAll`) per set of refs. It counts as held only once it is ready; an acquisition that
//   fails (a hold cap, a ref already collected, the host unreachable) is never taken for held: it is tried again after
//   each of PREVIEW_HOLD_RETRY_MS, then the preview's hold is said unavailable (`state`, and the log); the views and the
//   source sheet over it then say their own unavailability where they read. A new set of refs asks afresh.
// - A replacement (the review's snapshots changed) leaves the lease that holds now in place until it is ready, so a ref
//   both show is never let go in between; a replacement that fails keeps it; one superseded before it answered goes.
// - A held lease the host's restart took (`invalidated`) is taken again on the same immutable refs.
// - `clear` (the preview gone with the body showing it) and `dispose` let everything go and cancel any retry, so nothing
//   is acquired again until refs are wanted again (never after `dispose`).
import type { SnapshotLease } from '@artifacts/dashboard/snapshots';

/** The waits before each new try of a preview's failed acquisition; past them it is unavailable. */
export const PREVIEW_HOLD_RETRY_MS: readonly number[] = [1_000, 5_000];

export type PreviewHoldState = 'none' | 'pending' | 'held' | 'unavailable';

interface Taken {
  key: string;
  refs: readonly string[];
  lease: SnapshotLease;
}

export class PreviewHold {
  private wanted: { key: string; refs: readonly string[] } | null = null;
  private held: Taken | null = null; // the lease that protects now (it was ready)
  private pending: Taken | null = null; // the acquisition of `wanted` in flight
  private failures = 0; // of `wanted`'s acquisition
  private retry: ReturnType<typeof setTimeout> | null = null;
  private unavailable = false;
  private disposed = false;

  constructor(
    private readonly hold: (refs: readonly string[]) => SnapshotLease,
    private readonly log: (line: string) => void,
  ) {}

  get state(): PreviewHoldState {
    if (!this.wanted) return 'none';
    if (this.held?.key === this.wanted.key) return 'held';
    return this.unavailable ? 'unavailable' : 'pending';
  }

  /** The refs the displayed preview names now (none: no preview is displayed). */
  want(refs: readonly string[]): void {
    if (this.disposed) return;
    const sorted = [...new Set(refs)].sort();
    if (sorted.length === 0) return this.clear();
    const key = sorted.join('\n');
    if (this.wanted?.key === key) return;
    this.stopTrying();
    this.wanted = { key, refs: sorted };
    if (this.held?.key !== key) this.acquire();
  }

  /** No preview is displayed: every lease goes, and any retry with it. */
  clear(): void {
    this.stopTrying();
    this.wanted = null;
    const held = this.held;
    this.held = null;
    held?.lease.release();
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  private acquire(): void {
    const wanted = this.wanted!;
    const taken: Taken = { ...wanted, lease: this.hold(wanted.refs) };
    this.pending = taken;
    taken.lease.ready.then(
      () => {
        if (this.pending !== taken) return taken.lease.release(); // superseded, cleared or disposed meanwhile
        this.pending = null;
        this.failures = 0;
        const before = this.held;
        this.held = taken;
        before?.lease.release(); // the replacement holds: only now does the earlier protection go
        void taken.lease.invalidated.then(() => this.lost(taken));
      },
      () => {
        taken.lease.release();
        if (this.pending !== taken) return;
        this.pending = null;
        const wait = PREVIEW_HOLD_RETRY_MS[this.failures];
        this.failures += 1;
        if (wait === undefined) {
          this.unavailable = true;
          this.log(`the snapshots a displayed preview shows could not be held (${wanted.refs.join(', ')}); a later reader may find them gone`);
          return;
        }
        this.retry = setTimeout(() => {
          this.retry = null;
          if (this.wanted?.key === wanted.key && !this.pending) this.acquire();
        }, wait);
      },
    );
  }

  // The host's restart took the held lease: what it held is held again (its refs are immutable), if still wanted.
  private lost(taken: Taken): void {
    if (this.held !== taken) return;
    this.held = null;
    taken.lease.release();
    if (this.wanted?.key === taken.key && !this.pending) {
      this.failures = 0;
      this.unavailable = false;
      this.acquire();
    }
  }

  // A new request, or none: the acquisition in flight and any retry go (the held lease stays until replaced or cleared).
  private stopTrying(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    const pending = this.pending;
    this.pending = null;
    pending?.lease.release();
    this.failures = 0;
    this.unavailable = false;
  }
}
