// A source's older pages (the long-transcript window, docs/doperpowers/plans/2026-10-30-long-transcript-window.md): a
// disk-backed session or agent answers its newest window with an `earlier` cursor, and the page before it is asked of
// the host when the reader reaches the top. The pager keeps what the source has handed the store since its snapshot,
// in order, while older history remains; a page goes before all of it, and the source then rebuilds (`onRebuild`): the
// store hydrates the key again from the source's snapshot, which answers the pager's whole history without asking the
// host, so the reducer applies it in transcript order and a rewind, a compaction or an agent straddling a page edge
// lands as a full load would land it (lane A's rule for older rows, plane-transcript.ts). A page asked while the host's
// read of the transcript is still running comes back empty with the same cursor and is asked again shortly. A jump to a
// message older than what is loaded seeks it (`seek`): the pages back to the one holding it, walked with the host
// saying where the message stands, and taken in with one rebuild.
import { createStore } from 'zustand/vanilla';
import type { SessionEvent } from '@shared/graph/events';
import { ofMessage, type HistorySought } from '@shared/graph/history-window';
import type { EventId, MessageUuid, SessionId } from '@shared/graph/ids';
import { historyGapEvent } from '../model/gap';
import type { OlderPages, OlderPagesState, SeekResult } from './types';

export interface Page {
  events: SessionEvent[];
  complete: boolean;
  earlier?: EventId;
  sought?: HistorySought; // asked with a message to seek
}

// A cursor the host no longer holds (its follow started again): the source starts the key over from its newest window.
const UNKNOWN_CURSOR = 'unknown history cursor';
export const PAGE_RETRY_MS = 1_000; // a page asked while the host still reads the transcript through
export const PAGE_RETRIES = 30;
const NO_EVENTS: readonly SessionEvent[] = [];

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

// P5 O7 M2 (P5 Decision Log 77): a page `session.events` answered with part of its range gone (`historyUnavailable`)
// starts with the gap bar's event (model/gap.ts), so the transcript draws "Earlier history isn't available" where the
// page begins. Its id names the page's first event, so the same page read again draws the same one bar.
export function withHistoryGap<P extends { events: SessionEvent[]; historyUnavailable?: true }>(page: P, bareApp: string, text?: string): P {
  if (page.historyUnavailable !== true) return page;
  const first = page.events[0];
  const gap = historyGapEvent(bareApp, `start:${first?.id ?? 'none'}`, first?.at ?? new Date().toISOString(), first?.sessionId ?? (bareApp as SessionId), text);
  return { ...page, events: [gap, ...page.events] };
}

// P5 O7 M4 (acceptance 12): a budgeted page that left out items too large for the channel (`omitted`) ends with a bar
// saying so, just after its last row, where they were; its id names that row, so the same page read again draws one.
export function withOmittedBar<P extends { events: SessionEvent[]; omitted?: { events: number; bytes: number } }>(page: P, bareApp: string, words: (omitted: { events: number; bytes: number }) => string): P {
  if (page.omitted === undefined) return page;
  const last = page.events.at(-1);
  const bar = historyGapEvent(bareApp, `omitted:${last?.id ?? 'none'}`, last?.at ?? new Date().toISOString(), last?.sessionId ?? (bareApp as SessionId), words(page.omitted));
  return { ...page, events: [...page.events, bar] };
}

export class HistoryPager implements OlderPages {
  readonly state = createStore<OlderPagesState>(() => ({ more: false, loadingOlder: false, olderFailed: null, revision: 0 }));
  private held: SessionEvent[] = []; // the store's history in order, kept only while older history remains
  private earlier: EventId | null = null;
  private rebuilt: SessionEvent[] | null = null; // the history a rebuild's snapshot answers
  private readonly rebuilds = new Set<() => void>();
  private generation = 0; // a snapshot that starts over makes an older page in flight stale
  private inFlight: Promise<void> | null = null; // the older page on its way
  private seekRun = 0; // a seek started, stopped or superseded since makes a walk in flight stale
  private seeking = false; // a walk is on its way: the reader's own pages wait for it

  constructor(
    private readonly fetchPage: (before: EventId, seek?: MessageUuid) => Promise<Page>,
    private readonly place: (page: SessionEvent[], last: boolean) => SessionEvent[], // the page's place for events the source keeps aside (main's app events)
    private readonly lost: () => void, // the cursor is gone: the source resets the key
  ) {}

  // The source's snapshot answered from the host: the store starts over from `events`.
  // `cronHistory`: what the snapshot's newest window carried of its older history's cron calls (none once whole).
  started(events: SessionEvent[], earlier: EventId | null, cronHistory: readonly SessionEvent[] = NO_EVENTS): void {
    this.generation += 1;
    this.earlier = earlier;
    this.held = earlier === null ? [] : [...events];
    this.state.setState({ more: earlier !== null, loadingOlder: false, olderFailed: null, cronHistory: earlier === null ? NO_EVENTS : cronHistory });
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
  // source's snapshot, finding no history prepared, asks the host. An older page in flight read the history being
  // replaced, and one asked before the host's answer starts the pager over would too; either, finishing first, would
  // rebuild the key from it and detach the fresh snapshot. So the pager starts over empty at once: the page in flight
  // is stale, and none is asked until the answer.
  refresh(): void {
    this.started([], null);
    this.rebuilt = null;
    for (const listener of [...this.rebuilds]) listener();
  }

  loadOlder(): void {
    const { more, loadingOlder } = this.state.getState();
    if (!more || loadingOlder || this.seeking || this.earlier === null) return;
    const load = this.load(this.earlier, this.generation);
    this.inFlight = load;
    void load.finally(() => {
      if (this.inFlight === load) this.inFlight = null;
    });
  }

  // The pages back to the one holding the message `target`, asked with it so the host says where it stands (`sought`):
  // a message in none of the history ends the walk at once (`absent`), one at or after the cursor is in what the store
  // already holds or is on its way (`held`). The pages are taken in once the one holding it is in, with one rebuild, so a
  // walk across many pages hydrates the key once. `progress` hears the share walked, once the host has said how far.
  // A later seek, `stopSeek` or a snapshot starting over stops it (`stopped`); nothing it fetched is kept then.
  async seek(target: MessageUuid, progress?: (share: number) => void): Promise<SeekResult> {
    const run = ++this.seekRun;
    while (this.inFlight) await this.inFlight; // the reader's page goes first: the walk starts at its cursor
    const generation = this.generation;
    const current = () => run === this.seekRun && generation === this.generation;
    if (!current()) return { outcome: 'stopped' };
    if (this.earlier === null) return { outcome: 'held' };
    this.seeking = true;
    try {
      const pages: Page[] = [];
      let walked = 0;
      let total: number | null = null;
      for (let before: EventId = this.earlier; ; ) {
        const page = await this.read(before, current, target);
        if (!current()) return { outcome: 'stopped' };
        // A host that does not know `seek` answers no `sought`: the page itself says whether it holds the message.
        const sought: HistorySought = page.sought ?? { at: page.events.some((event) => ofMessage(event, target)) ? 'page' : page.earlier !== undefined ? 'earlier' : 'absent', behind: 0 };
        if (sought.at === 'absent') return { outcome: 'absent' };
        if (sought.at === 'newer') return { outcome: 'held' };
        pages.unshift(page);
        walked += page.events.length;
        if (sought.at === 'page') break;
        if (page.earlier === undefined) return { outcome: 'absent' };
        if (sought.behind > 0) total = walked + sought.behind;
        if (total !== null) progress?.(Math.min(1, walked / total));
        before = page.earlier;
      }
      this.take(pages[0]!.earlier ?? null, pages.flatMap((page) => page.events));
      return { outcome: 'found' };
    } catch (error) {
      if (!current()) return { outcome: 'stopped' };
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(UNKNOWN_CURSOR)) this.lost();
      return { outcome: 'failed', error: message };
    } finally {
      if (run === this.seekRun) this.seeking = false;
    }
  }

  stopSeek(): void {
    this.seekRun += 1;
    this.seeking = false;
  }

  // The page before `before`, asked again while the host still reads the transcript through.
  private async read(before: EventId, current: () => boolean, seek?: MessageUuid): Promise<Page> {
    let page = await this.fetchPage(before, seek);
    for (let tries = 0; page.events.length === 0 && !page.complete && tries < PAGE_RETRIES && current(); tries++) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_RETRY_MS));
      page = await this.fetchPage(before, seek);
    }
    if (current() && page.events.length === 0 && page.earlier !== undefined) throw new Error('the transcript is still being read');
    return page;
  }

  // Older events joined the history: they go before all of it, and the store rebuilds the key.
  private take(earlier: EventId | null, events: SessionEvent[]): void {
    this.earlier = earlier;
    const history = [...this.place(events, this.earlier === null), ...this.held];
    // With no store attached the page is let go: the next snapshot asks the host for the newest window again (the
    // batches of the time between were never held).
    this.rebuilt = this.rebuilds.size > 0 ? history : null;
    if (this.rebuilt === null) this.started([], null);
    for (const listener of [...this.rebuilds]) listener(); // the store stages the rebuild first, then the view hears the page
    this.state.setState((state) => ({ more: this.earlier !== null, loadingOlder: false, revision: state.revision + 1 }));
  }

  private async load(before: EventId, generation: number): Promise<void> {
    this.state.setState({ loadingOlder: true, olderFailed: null });
    try {
      const page = await this.read(before, () => generation === this.generation);
      if (generation !== this.generation) return;
      this.take(page.earlier ?? null, page.events);
    } catch (error) {
      if (generation !== this.generation) return;
      const message = error instanceof Error ? error.message : String(error);
      this.state.setState({ loadingOlder: false, olderFailed: message });
      if (message.includes(UNKNOWN_CURSOR)) this.lost();
    }
  }
}
