// Who drives a tab's page (E4c execution document, Design §8's table; A-31, A-33; Decision Log 4, 27; since the in-app
// browser spec of 2026-10-08, the agent is cua's, through a debugger lease, cua/presence.ts): `idle`, the agent's
// (`agent`, from the agent's first acting command), or the person's (`human`, when their input conflicts with the agent's
// use). `TabStore.setControl` is the only transition (it stamps `controlSince` and emits `browser.control.changed`); E4a's
// chrome makes one of its own, Hand back (`human` to `idle`), which this module observes through the store like any
// other change.
//
// The inputs: E4a's input seam (`entry.input.on`, the classifier's `{ kind, source }`), the agent's acting command
// (`markActing`) and its end (`actionEnded`), and two timers:
//   - the hand-back timer, armed while `human` for the person's last input plus BROWSER_HANDBACK_IDLE_MS (3 s) and
//     re-armed by every further human input; held commands may resume (`whenReleased`), but `human` stays visible until
//     Hand back or the agent resumes (cua #103);
//   - the agent-idle timer, armed for BROWSER_AGENT_IDLE_MS (10 s) when an action ends, so an agent thinking between two
//     commands does not flicker the chrome; it returns the tab to `idle`.
// Human input takes the page only when it conflicts with the agent: while the agent holds the tab. A click on a page no
// agent holds leaves `idle` (E4a stamps `lastHumanAt` either way), and an acting command within 3 s of such a click
// enters `human` at the takeover gate and is held (`personHolds`). The agent's own input (CDP, attributed by E4a's
// table) never takes the page.
//
// While the agent holds the tab its view's background throttling is off (E4-0: a second un-hide path for rAF and
// timers, lost on navigation, so every action re-asserts it), and it is restored when the agent lets go.
import type { WebContentsView } from 'electron';
import { BROWSER_AGENT_IDLE_MS, BROWSER_HANDBACK_IDLE_MS, type BrowserControl } from '@shared/browser/tab';
import type { InputEmission } from '../input';
import type { TabEntry, TabStore } from '../tabs';

export interface TabControlsDeps {
  store: Pick<TabStore, 'setControl' | 'entry' | 'all' | 'onViewCreated' | 'onViewDestroying' | 'onUpdated'>;
  now?(): number;
}

interface TabControlState {
  seen: BrowserControl; // the control last observed, to tell a transition from any other patch
  handBack: ReturnType<typeof setTimeout> | null;
  agentIdle: ReturnType<typeof setTimeout> | null;
  releases: Set<() => void>; // held commands, released when the grace ends or control leaves `human`
  unsubscribe(): void; // from the tab's input seam
}

// cua #103: recent input holds off an acting command; visible human ownership outlasts that takeover grace.
// The one statement of the rule: the takeover gate, dialog route, activity navigations and resource caps.
export function personHolds(entry: TabEntry, now: number): boolean {
  const { lastHumanAt } = entry.input;
  const last = lastHumanAt ?? (entry.tab.control === 'human' ? Date.parse(entry.tab.controlSince) : null);
  return last !== null && now - last < BROWSER_HANDBACK_IDLE_MS;
}

// Told after every control transition (`from`: the state it left).
export type ControlListener = (entry: TabEntry, from: BrowserControl) => void;

export class TabControls {
  private readonly states = new WeakMap<TabEntry, TabControlState>();
  private readonly listeners = new Set<ControlListener>();
  private readonly unhook: (() => void)[];
  private readonly now: () => number;

  constructor(private readonly deps: TabControlsDeps) {
    this.now = deps.now ?? Date.now;
    const { store } = deps;
    for (const entry of store.all()) this.attach(entry);
    this.unhook = [
      store.onViewCreated((entry) => this.attach(entry)),
      store.onUpdated((entry) => this.observe(entry)),
      // a closed tab (or one whose session was deleted): nothing may fire into it; a command held on it is cancelled by
      // cua's server
      store.onViewDestroying((entry) => queueMicrotask(() => store.entry(entry.tab.tabId) !== entry && this.forget(entry))),
    ];
  }

  // `attachControl`: the tab's input seam, subscribed once per tab (the seam outlives the tab's views).
  attach(entry: TabEntry): void {
    if (this.states.has(entry) || this.deps.store.entry(entry.tab.tabId) !== entry) return;
    const unsubscribe = entry.input.on((emission) => this.input(entry, emission));
    this.states.set(entry, { seen: entry.tab.control, handBack: null, agentIdle: null, releases: new Set(), unsubscribe });
  }

  onChange(listener: ControlListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  // ---- the agent (cua/presence.ts) --------------------------------------------------------------------------------

  // Resolves when the takeover grace expires or the tab leaves `human` (Hand back); visible ownership does not time out.
  // Rejects with the signal's reason when the held command is cancelled first.
  whenReleased(entry: TabEntry, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      if (entry.tab.control !== 'human' || !this.personHolds(entry)) return resolve();
      const { releases } = this.stateOf(entry);
      const finish = (settle: () => void) => {
        releases.delete(release);
        signal.removeEventListener('abort', onAbort);
        settle();
      };
      const release = () => finish(resolve);
      const onAbort = () => finish(() => reject(signal.reason));
      releases.add(release);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  markActing(entry: TabEntry): void {
    const state = this.stateOf(entry);
    clear(state, 'agentIdle');
    if (entry.tab.control !== 'agent') this.deps.store.setControl(entry.tab.tabId, 'agent'); // observed: throttling off
    else throttle(entry.view, false); // lost on navigation: re-asserted at every action
  }

  actionEnded(entry: TabEntry): void {
    if (entry.tab.control !== 'agent' || this.deps.store.entry(entry.tab.tabId) !== entry) return; // a closed tab lapses nowhere
    const state = this.stateOf(entry);
    clear(state, 'agentIdle');
    state.agentIdle = setTimeout(() => {
      state.agentIdle = null;
      if (this.deps.store.entry(entry.tab.tabId) === entry && entry.tab.control === 'agent') this.deps.store.setControl(entry.tab.tabId, 'idle');
    }, BROWSER_AGENT_IDLE_MS);
  }

  // The person is using the tab now (the rule `personHolds` states).
  personHolds(entry: TabEntry): boolean {
    return personHolds(entry, this.now());
  }

  dispose(): void {
    for (const unhook of this.unhook.splice(0)) unhook();
    for (const entry of this.deps.store.all()) this.forget(entry);
  }

  // ---- internals ----------------------------------------------------------------------------------------------------

  private input(entry: TabEntry, { source }: InputEmission): void {
    if (source !== 'human' || this.deps.store.entry(entry.tab.tabId) !== entry) return;
    const state = this.stateOf(entry);
    if (entry.tab.control === 'human') return this.armHandBack(entry, state);
    if (entry.tab.control === 'agent') this.deps.store.setControl(entry.tab.tabId, 'human'); // observed: the timer is armed there
  }

  // Every patch of the tab passes here; a change of `control` is a transition, whoever made it.
  private observe(entry: TabEntry): void {
    const state = this.states.get(entry);
    if (!state || state.seen === entry.tab.control) return;
    const from = state.seen;
    const to = entry.tab.control;
    state.seen = to;
    if (from === 'human') {
      clear(state, 'handBack');
      for (const release of [...state.releases]) release();
    }
    if (from === 'agent') {
      clear(state, 'agentIdle');
      throttle(entry.view, true);
    }
    if (to === 'human') this.armHandBack(entry, state);
    if (to === 'agent') throttle(entry.view, false);
    this.tell(entry, from);
  }

  // The hand-back timer, for the person's last input plus the window (re-armed by each input; checked when it fires).
  private armHandBack(entry: TabEntry, state: TabControlState): void {
    clear(state, 'handBack');
    const last = entry.input.lastHumanAt ?? this.now();
    state.handBack = setTimeout(
      () => {
        state.handBack = null;
        if (this.deps.store.entry(entry.tab.tabId) !== entry || entry.tab.control !== 'human') return;
        const since = this.now() - (entry.input.lastHumanAt ?? 0);
        if (since < BROWSER_HANDBACK_IDLE_MS) return this.armHandBack(entry, state);
        for (const release of [...state.releases]) release(); // cua #103: grace ends, not visible human ownership
      },
      Math.max(0, last + BROWSER_HANDBACK_IDLE_MS - this.now()),
    );
  }

  // A tab gone (closed, or at dispose): its timers cleared and its input seam let go, so nothing holds it.
  private forget(entry: TabEntry): void {
    const state = this.states.get(entry);
    if (!state) return;
    this.states.delete(entry);
    clear(state, 'handBack');
    clear(state, 'agentIdle');
    state.unsubscribe();
  }

  private tell(entry: TabEntry, from: BrowserControl): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(entry, from);
      } catch (error) {
        console.error('[browser] a control listener failed:', error);
      }
    }
  }

  // A tab the store no longer has gets a state of its own that nothing keeps (a late call for a closed tab).
  private stateOf(entry: TabEntry): TabControlState {
    this.attach(entry);
    return this.states.get(entry) ?? { seen: entry.tab.control, handBack: null, agentIdle: null, releases: new Set(), unsubscribe: () => {} };
  }
}

function clear(state: TabControlState, timer: 'handBack' | 'agentIdle'): void {
  if (state[timer] === null) return;
  clearTimeout(state[timer]);
  state[timer] = null;
}

function throttle(view: WebContentsView | null, on: boolean): void {
  if (view && !view.webContents.isDestroyed()) view.webContents.setBackgroundThrottling(on);
}
