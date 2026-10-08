// What the person sees and keeps while an agent drives a tab through cua (the in-app browser spec of 2026-10-08, "Who
// drives the tab", "Takeover", "Cursor"): the agent's actions no longer arrive as tool calls, so control's transitions
// (agent/control.ts) follow the lease. A tab enters `agent` on the first *acting* command sent through a lease
// (filter.ts `commandClass`) and every such command re-arms the agent-idle timer; it returns to `idle` when the timer
// lapses or the lease is released. Reading commands never change control, so a permitted read during `human` cannot
// revoke the person's hold.
//
// Takeover: before an acting command is marked and dispatched, control's `personHolds` is asked (the tab is `human`, or
// the person touched it within the 3 s hand-back window while `idle`); a recent touch of an idle tab promotes it to
// `human` first, as E4c's tools' pause point did. While `human`, the command waits for the hand-back for at most
// min(BROWSER_TAKEOVER_HOLD_MS, deadline - TAKEOVER_MARGIN_MS), then is refused with PERSON_USING_TAB; a command whose
// deadline is already under TAKEOVER_MIN_DEADLINE_MS is refused at once. The vendor caps locator actions at 3 s and the
// host detaches a tab on its own timeout, so a longer hold would turn the person's touch into a lost tab.
//
// The cursor: AgentCursor already draws what the agent's mouse commands do while the tab is `agent`; `cursor.move` (the
// vendor's moveMouse) adds a `move` so the pointer shows where the agent aims before a locator click, and the cursor is
// hidden when the lease is released.
import type { AgentCursor } from '../agent/cursor';
import type { TabControls } from '../agent/control';
import type { TabEntry, TabStore } from '../tabs';

export const BROWSER_TAKEOVER_HOLD_MS = 1_500;
export const TAKEOVER_MARGIN_MS = 100; // a held command answers this long before its own deadline
export const TAKEOVER_MIN_DEADLINE_MS = 200; // a deadline under this is refused at once while the person holds the tab
export const PERSON_USING_TAB = 'A person is using this tab; wait and retry';

export interface PresenceDeps {
  controls: Pick<TabControls, 'personHolds' | 'markActing' | 'actionEnded' | 'whenReleased'>;
  cursor: Pick<AgentCursor, 'move' | 'hide'>;
  store: Pick<TabStore, 'entry' | 'setControl'>;
}

export class PersonUsingTab extends Error {
  constructor() {
    super(PERSON_USING_TAB);
  }
}

export class AgentPresence {
  constructor(private readonly deps: PresenceDeps) {}

  // The takeover gate, then the tab is the agent's (throttling off, the agent-idle timer cleared until `acted`). Rejects
  // with PersonUsingTab when the person keeps the tab, or with the signal's reason when the command is cancelled first.
  async beforeActing(entry: TabEntry, deadlineMs: number, signal: AbortSignal): Promise<void> {
    const { controls, store } = this.deps;
    if (controls.personHolds(entry)) {
      if (entry.tab.control !== 'human') store.setControl(entry.tab.tabId, 'human'); // the hand-back timer arms there
      if (deadlineMs < TAKEOVER_MIN_DEADLINE_MS) throw new PersonUsingTab();
      const released = await waitAtMost((bounded) => controls.whenReleased(entry, bounded), signal, Math.min(BROWSER_TAKEOVER_HOLD_MS, deadlineMs - TAKEOVER_MARGIN_MS));
      if (!released) throw new PersonUsingTab();
    }
    signal.throwIfAborted();
    if (this.live(entry)) controls.markActing(entry);
  }

  // An acting command settled: the agent-idle timer re-armed (a model thinking between two cells keeps the chrome still).
  acted(entry: TabEntry): void {
    if (this.live(entry)) this.deps.controls.actionEnded(entry);
  }

  // `cursor.move`: the pointer where the agent aims, unless the person holds the tab.
  cursorMove(entry: TabEntry, x: number, y: number): void {
    if (this.live(entry) && entry.tab.control !== 'human') this.deps.cursor.move(entry, x, y);
  }

  // The lease is released (detach, the host's timeout, turn end, disconnect) or lost: the tab is no longer the agent's.
  released(entry: TabEntry): void {
    if (!this.live(entry)) return;
    if (entry.tab.control === 'agent') this.deps.store.setControl(entry.tab.tabId, 'idle'); // the cursor hides with it
    this.deps.cursor.hide(entry);
  }

  private live(entry: TabEntry): boolean {
    return this.deps.store.entry(entry.tab.tabId) === entry;
  }
}

// Whether the wait settled within `ms`. The wait gets its own signal, aborted when the bound lapses (nothing is left
// waiting on the person) or when the command's own is (its rejection then propagates).
async function waitAtMost(wait: (signal: AbortSignal) => Promise<void>, signal: AbortSignal, ms: number): Promise<boolean> {
  const bounded = new AbortController();
  const follow = () => bounded.abort(signal.reason);
  signal.addEventListener('abort', follow, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lapse = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), Math.max(0, ms))));
  try {
    const waited = wait(bounded.signal).then(() => true as const);
    waited.catch(() => {}); // aborted after the bound lapsed: nobody awaits it any more
    return await Promise.race([waited, lapse]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', follow);
    if (!bounded.signal.aborted) bounded.abort(new Error('the takeover hold lapsed'));
  }
}
