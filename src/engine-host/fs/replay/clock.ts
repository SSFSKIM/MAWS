// The replay clock (C4 execution document, Interfaces "Replay engine", residue *Replay clock and speed*): fires scheduled
// rows in order, each at an absolute deadline derived from the recorded times, so a run neither drifts nor accumulates
// timer lateness: a row's deadline is the previous row's deadline plus its recorded gap, with a gap longer than
// `maxGapMs` of real time (a fixture that sat waiting for a human) shortened to that, `min(Δt, maxGap·speed) / speed`.
// A speed change or a resume re-bases at the current row: the part of its gap already played stays played and the rest
// runs at the new speed from now. `'instant'` bypasses the timers: one row per turn of the event loop.
import type { Speed } from '@shared/ipc/schema/session';

export type { Speed };
export type ClockState = 'running' | 'paused' | 'stopped';

export const DEFAULT_MAX_GAP_MS = 2000;

interface Row {
  at: number; // recorded time, ms
  fn: () => void;
}

export class ReplayClock {
  private rate: Speed;
  private readonly maxGapMs: number;
  private current: ClockState = 'running';
  private readonly queue: Row[] = [];
  private prevAt: number | null = null; // recorded time of the last row fired
  private lastDeadline = 0; // real time at which the last row was due
  // The head row's gap, once it is the head: the real time its remaining gap counts from, and the recorded ms left.
  private head: { startReal: number; remaining: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private immediate: ReturnType<typeof setImmediate> | null = null;
  private firing = false;

  constructor(opts: { speed: Speed; maxGapMs?: number }) {
    this.rate = opts.speed;
    this.maxGapMs = opts.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  }

  get state(): ClockState {
    return this.current;
  }

  get speed(): Speed {
    return this.rate;
  }

  schedule(recordedAt: number, fn: () => void): void {
    if (this.current === 'stopped') return;
    this.queue.push({ at: recordedAt, fn });
    this.arm();
  }

  setSpeed(speed: Speed): void {
    if (this.current === 'stopped') return;
    if (this.current === 'running') this.consume();
    this.rate = speed;
    if (this.current === 'running') this.rearm();
  }

  pause(): void {
    if (this.current !== 'running') return;
    this.consume();
    this.disarm();
    this.current = 'paused';
  }

  resume(): void {
    if (this.current !== 'paused') return;
    this.current = 'running';
    if (this.head) this.head.startReal = Date.now();
    this.arm();
  }

  stop(): void {
    this.current = 'stopped';
    this.disarm();
    this.queue.length = 0;
    this.head = null;
  }

  // The head's gap played so far at the current speed leaves it; what is left counts from now.
  private consume(): void {
    if (this.queue.length === 0) return;
    const head = this.prepareHead();
    const now = Date.now();
    if (this.rate !== 'instant') {
      const played = (now - head.startReal) * this.rate;
      head.remaining = Math.max(0, this.capped(head.remaining, this.rate) - played);
    }
    head.startReal = now;
  }

  private capped(gap: number, speed: number): number {
    return Math.min(gap, this.maxGapMs * speed);
  }

  private rearm(): void {
    this.disarm();
    this.arm();
  }

  // Arms a timer for the head row; nothing while paused, firing or already armed.
  private arm(): void {
    if (this.current !== 'running' || this.firing || this.timer !== null || this.immediate !== null || this.queue.length === 0) return;
    if (this.rate === 'instant') {
      this.prepareHead();
      this.immediate = setImmediate(() => this.fire(Date.now()));
      return;
    }
    const deadline = this.headDeadline(this.rate);
    this.timer = setTimeout(() => this.fire(deadline), Math.max(0, deadline - Date.now()));
  }

  // The head row's gap, fixed when it becomes the head: the first row is due now, every later one counts from the
  // deadline of the row before it (drift-free).
  private prepareHead(): { startReal: number; remaining: number } {
    this.head ??= this.prevAt === null ? { startReal: Date.now(), remaining: 0 } : { startReal: this.lastDeadline, remaining: Math.max(0, this.queue[0].at - this.prevAt) };
    return this.head;
  }

  private headDeadline(speed: number): number {
    const head = this.prepareHead();
    return head.startReal + this.capped(head.remaining, speed) / speed;
  }

  private disarm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.immediate !== null) clearImmediate(this.immediate);
    this.timer = null;
    this.immediate = null;
  }

  // Fires the head, then every row already due behind it (rows recorded in the same millisecond, or a late timer)
  // without waiting for another timer; at 'instant', one row per turn.
  private fire(deadline: number): void {
    this.timer = null;
    this.immediate = null;
    this.firing = true;
    try {
      for (;;) {
        const row = this.queue.shift();
        if (!row) break;
        this.head = null;
        this.prevAt = row.at;
        this.lastDeadline = deadline;
        row.fn();
        if (this.current !== 'running' || this.rate === 'instant' || this.queue.length === 0) break;
        const next = this.headDeadline(this.rate);
        if (next > Date.now()) break;
        deadline = next;
      }
    } finally {
      this.firing = false;
    }
    this.arm();
  }
}
