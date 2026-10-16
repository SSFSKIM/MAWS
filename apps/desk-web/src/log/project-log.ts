// One project's log in the browser: the entries the hub sent, by offset, kept in the browser's record so the next
// connection — or the next page load — resumes after the last one held. Nothing is drawable until it verifies under
// the org key (§6); without a key the log is locked and draws nothing, and an entry whose code fails is never drawn
// and is reported instead.
//
// The record only ever holds a prefix of what the hub sent: a page load resumes after the highest offset recorded, so
// an entry missing below it would never come again. Each write therefore carries every entry not yet recorded, in one
// transaction, and a write that fails leaves its entries for the next one.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { LogEvent, OrgKey } from 'desk-hub/protocol';
import type { LogEntry, LogRecord } from './record';
import { verifyLogEvent } from './verify';

export type Verdict = 'pending' | 'ok' | 'bad-code' | 'malformed';
export type HeldEntry = LogEntry & { verdict: Verdict };

export type ProjectLogState = {
  /** Every entry held, in offset order. */
  entries: HeldEntry[];
  /** The browser holds no org key: nothing from the log is drawn. */
  locked: boolean;
  /** The record has been read; until then the project's socket does not resume. */
  loaded: boolean;
};

export class ProjectLog {
  readonly store: StoreApi<ProjectLogState> = createStore<ProjectLogState>(() => ({ entries: [], locked: true, loaded: false }));
  private key: OrgKey | null = null;
  private last = 0;
  /** Counts the log's replacements and key changes: a verification reached under an older generation is discarded. */
  private generation = 0;
  private work: Promise<void> = Promise.resolve();
  /** Entries held but not yet in the record, oldest first: the next write carries them all. */
  private unrecorded: LogEntry[] = [];
  /** Counts the record's replacements: a write asked for before one carries nothing of the new log. */
  private recordEpoch = 0;

  constructor(
    readonly project: string,
    private readonly record: LogRecord,
  ) {}

  async load(): Promise<void> {
    const entries = await this.record.load(this.project);
    this.last = entries.at(-1)?.offset ?? 0;
    this.store.setState({ entries: entries.map((e) => ({ ...e, verdict: 'pending' })), loaded: true });
    this.verify();
  }

  /** The offset of the last entry held: the project's socket resumes after it. */
  held(): number {
    return this.last;
  }

  /**
   * A verdict holds only under the key that reached it: on any change every entry is checked again, and a pass still
   * running under the old key commits nothing.
   */
  setKey(key: OrgKey | null): void {
    if (key === this.key) return;
    this.key = key;
    this.generation++;
    this.store.setState((s) => ({ locked: key === null, entries: s.entries.map((e) => (e.verdict === 'pending' ? e : { ...e, verdict: 'pending' as const })) }));
    this.verify();
  }

  /** Entries from the hub; offsets at or below the last held are already here. */
  receive(entries: LogEntry[]): void {
    const fresh = entries.filter((e) => e.offset > this.last).sort((a, b) => a.offset - b.offset);
    if (fresh.length === 0) return;
    this.last = fresh.at(-1)!.offset;
    this.store.setState((s) => ({ entries: [...s.entries, ...fresh.map((e) => ({ ...e, verdict: 'pending' as const }))] }));
    this.unrecorded.push(...fresh);
    this.recordUnrecorded();
    this.verify();
  }

  /**
   * The hub's latest offset, from its `welcome`. Offsets only grow, so a hub holding less than this record holds a log
   * that is not the one recorded (a local hub started afresh): the record is dropped and the log taken again from 0.
   * True when it was.
   */
  welcome(head: number): boolean {
    if (head >= this.last) return false;
    this.last = 0;
    this.generation++;
    this.recordEpoch++;
    this.unrecorded = [];
    this.store.setState({ entries: [] });
    this.queue(() => this.record.clear(this.project));
    return true;
  }

  /**
   * The offset of the last entry held whose time is at or before `time`: where something that happened then belongs in
   * the stream. Each event's `ts` is its writer's clock, so this is as close as their clocks are; 0 when none is.
   */
  offsetAt(time: string): number {
    const at = Date.parse(time);
    let offset = 0;
    for (const { offset: o, event } of this.store.getState().entries) if (typeof event.ts === 'string' && Date.parse(event.ts) <= at) offset = Math.max(offset, o);
    return offset;
  }

  /** Verified entries, in offset order: the only ones a view draws. */
  drawable(): Array<HeldEntry & { event: LogEvent }> {
    return drawable(this.store.getState());
  }

  /** Entries whose code or shape failed: reported in the view, never drawn. */
  refused(): HeldEntry[] {
    return refused(this.store.getState());
  }

  /** Resolves once every recorded write and verification asked for so far is done. */
  settled(): Promise<void> {
    return this.work;
  }

  /** Writes every entry not yet recorded, after every write asked for before; on failure they wait for the next. */
  private recordUnrecorded(): void {
    const epoch = this.recordEpoch;
    this.queue(async () => {
      if (epoch !== this.recordEpoch || this.unrecorded.length === 0) return;
      const batch = this.unrecorded.slice();
      await this.record.append(this.project, batch);
      if (epoch === this.recordEpoch) this.unrecorded = this.unrecorded.slice(batch.length);
    });
  }

  private queue(task: () => Promise<void>): void {
    this.work = this.work.then(task).catch((error: unknown) => console.error('desk: the log record', error));
  }

  private verify(): void {
    this.queue(async () => {
      const key = this.key;
      if (!key) return;
      const generation = this.generation;
      const pending = this.store.getState().entries.filter((e) => e.verdict === 'pending');
      if (pending.length === 0) return;
      // Each verdict belongs to the exact entry it was reached on (the object held), never to an offset alone.
      const verdicts = new Map<HeldEntry, Verdict>();
      for (const entry of pending) {
        const verdict = await verifyLogEvent(key, this.project, entry.event);
        verdicts.set(entry, verdict.ok ? 'ok' : verdict.reason);
      }
      if (generation !== this.generation) return; // the log was replaced or the key changed: that pass decides
      this.store.setState((s) => ({ entries: s.entries.map((e) => (verdicts.has(e) ? { ...e, verdict: verdicts.get(e)! } : e)) }));
    });
  }
}

export const drawable = (state: ProjectLogState): Array<HeldEntry & { event: LogEvent }> => (state.locked ? [] : state.entries.filter((e) => e.verdict === 'ok'));
export const refused = (state: ProjectLogState): HeldEntry[] => state.entries.filter((e) => e.verdict === 'bad-code' || e.verdict === 'malformed');
