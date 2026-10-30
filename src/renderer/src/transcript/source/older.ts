// A source's older pages (the long-transcript window, docs/doperpowers/plans/2026-10-30-long-transcript-window.md): a
// disk-backed session or agent answers its newest window with an `earlier` cursor, and the page before it is asked of
// the host when the reader reaches the top. The pager keeps what the source has handed the store since its snapshot,
// in order, while older history remains; a page goes before all of it, and the source then rebuilds (`onRebuild`): the
// store hydrates the key again from the source's snapshot, which answers the pager's whole history without asking the
// host, so the reducer applies it in transcript order and a rewind, a compaction or an agent straddling a page edge
// lands as a full load would land it (lane A's rule for older rows, plane-transcript.ts). A page asked while the host's
// read of the transcript is still running comes back empty with the same cursor and is asked again shortly.
import { createStore } from 'zustand/vanilla';
import type { SessionEvent } from '@shared/graph/events';
import type { EventId } from '@shared/graph/ids';
import type { OlderPages, OlderPagesState } from './types';

export interface Page {
  events: SessionEvent[];
  complete: boolean;
  earlier?: EventId;
}

// A cursor the host no longer holds (its follow started again): the source starts the key over from its newest window.
const UNKNOWN_CURSOR = 'unknown history cursor';
export const PAGE_RETRY_MS = 1_000; // a page asked while the host still reads the transcript through
export const PAGE_RETRIES = 30;

// Batches a source held while its snapshot was on its way can carry history older than the window the snapshot
// answered: the host sends its window as a batch once it has read the transcript through, and when appends then move
// the window on, a read after that batch answers a newer window. Drained after that snapshot, the batch's oldest
// events would land after the snapshot's newest. A held disk-form event the snapshot also holds shows how far the
// snapshot reaches, so a disk-form event before the last such one that the snapshot lacks is older than its window and
// is dropped; the older page that holds it brings it back. Whatever follows that last event is newer than the
// snapshot, and an event of another form (live, or the app's own) belongs to no window. Nor does such an event show
// the window's reach: the snapshot can hold one from elsewhere (main's app events, read after the host's answer) that
// a batch carried after disk events newer than the window.
export function withoutOlderThanWindow(held: readonly SessionEvent[][], snapshot: readonly SessionEvent[], diskForm: (event: SessionEvent) => boolean): SessionEvent[][] {
  const ids = new Set(snapshot.map((event) => event.id));
  let batch = held.length - 1;
  let reach = -1; // the last held disk-form event the snapshot holds: `held[batch][reach]`
  while (batch >= 0 && (reach = held[batch]!.findLastIndex((event) => ids.has(event.id) && diskForm(event))) < 0) batch--;
  if (batch < 0) return [...held];
  return held.map((events, b) => (b > batch ? events : events.filter((event, i) => (b === batch && i >= reach) || ids.has(event.id) || !diskForm(event))));
}

export class HistoryPager implements OlderPages {
  readonly state = createStore<OlderPagesState>(() => ({ more: false, loadingOlder: false, olderFailed: null, revision: 0 }));
  private held: SessionEvent[] = []; // the store's history in order, kept only while older history remains
  private earlier: EventId | null = null;
  private rebuilt: SessionEvent[] | null = null; // the history a rebuild's snapshot answers
  private readonly rebuilds = new Set<() => void>();
  private generation = 0; // a snapshot that starts over makes an older page in flight stale

  constructor(
    private readonly fetchPage: (before: EventId) => Promise<Page>,
    private readonly place: (page: SessionEvent[], last: boolean) => SessionEvent[], // the page's place for events the source keeps aside (main's app events)
    private readonly lost: () => void, // the cursor is gone: the source resets the key
  ) {}

  // The source's snapshot answered from the host: the store starts over from `events`.
  started(events: SessionEvent[], earlier: EventId | null): void {
    this.generation += 1;
    this.earlier = earlier;
    this.held = earlier === null ? [] : [...events];
    this.state.setState({ more: earlier !== null, loadingOlder: false, olderFailed: null });
  }

  // Events the source handed the store after its snapshot.
  delivered(events: readonly SessionEvent[]): void {
    if (this.earlier !== null) this.held.push(...events);
  }

  // The history a rebuild's snapshot answers, once; null for a snapshot that asks the host.
  takeRebuilt(): SessionEvent[] | null {
    const events = this.rebuilt;
    this.rebuilt = null;
    if (events !== null) this.held = this.earlier === null ? [] : [...events];
    return events;
  }

  onRebuild(listener: () => void): () => void {
    this.rebuilds.add(listener);
    return () => this.rebuilds.delete(listener);
  }

  // The history is to be read from the host again (the source's follow was released, and the transcript may have
  // grown since): the store rebuilds the key, staged under what the reader opened as for an older page, and the
  // source's snapshot, finding no history prepared, asks the host.
  refresh(): void {
    this.rebuilt = null;
    for (const listener of [...this.rebuilds]) listener();
  }

  loadOlder(): void {
    const { more, loadingOlder } = this.state.getState();
    if (!more || loadingOlder || this.earlier === null) return;
    void this.load(this.earlier, this.generation);
  }

  private async load(before: EventId, generation: number): Promise<void> {
    this.state.setState({ loadingOlder: true, olderFailed: null });
    try {
      let page = await this.fetchPage(before);
      for (let tries = 0; page.events.length === 0 && !page.complete && tries < PAGE_RETRIES && generation === this.generation; tries++) {
        await new Promise((resolve) => setTimeout(resolve, PAGE_RETRY_MS));
        page = await this.fetchPage(before);
      }
      if (generation !== this.generation) return;
      if (page.events.length === 0 && page.earlier !== undefined) throw new Error('the transcript is still being read');
      this.earlier = page.earlier ?? null;
      const history = [...this.place(page.events, this.earlier === null), ...this.held];
      // With no store attached the page is let go: the next snapshot asks the host for the newest window again (the
      // batches of the time between were never held).
      this.rebuilt = this.rebuilds.size > 0 ? history : null;
      if (this.rebuilt === null) this.started([], null);
      for (const listener of [...this.rebuilds]) listener(); // the store stages the rebuild first, then the view hears the page
      this.state.setState((state) => ({ more: this.earlier !== null, loadingOlder: false, revision: state.revision + 1 }));
    } catch (error) {
      if (generation !== this.generation) return;
      const message = error instanceof Error ? error.message : String(error);
      this.state.setState({ loadingOlder: false, olderFailed: message });
      if (message.includes(UNKNOWN_CURSOR)) this.lost();
    }
  }
}
