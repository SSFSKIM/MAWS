// P5 O17 M10 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M10; Interfaces §K, "The app's bridge"): one window's
// viewer of the agent's tabs on another machine's session, over main's `browser.remote.*`. Framework-free, so the canvas
// (./View.tsx) only draws what it holds.
//
// - The view is opened for the session's address and closed at the end (a hidden or collapsed Browser tool ends it, so
//   its feed closes and B's tab goes on); an open answered after the end is closed at once. Its states are main's
//   `view` (`RemoteViewState`), which the copy words by kind; nothing here reads prose.
// - This viewer's tab is its own (`show`), never the agent's selection or another person's: `select` replaces only this
//   view's stream. Shown, the agent's browser follows its tab across the machine's epochs (an engine change, B's app
//   arriving): the same tab where the new inventory lists it, else the agent's selected tab, else its first.
// - A frame is acknowledged only once drawn or deliberately dropped (M9's Decisions: frame credit spans the whole path).
//   While nothing draws (the person shows their own tab), the frame is held unacknowledged, so the producer waits on it
//   and sends nothing more; the canvas draws it when it comes.
// - A stream that closes is opened again at a word that may pass (at most three times with no frame drawn between, then
//   it stops for the person's Retry), or waits for the inventory at a closed tab, an engine change or the carrier's loss.
//   A close heard while this view's own `select` is on its way may be of the stream that select replaced or of the one
//   it opened, so it is read once the select is answered, and a frame of the new stream reads live whatever it said.
// - Control is the person's gesture (`takeControl`, the act and a controlling stream main opens under the grant), never
//   assumed: held from an answer that says so until it is given back, revoked (`control-revoked`), refused at a reopen
//   or its epoch has passed (the grant dies with its epoch, §K's pin 3). Input goes only while it is held, in order, each
//   with the view's next sequence; a move waits for the one on its way and only the newest is kept (§G: moves may
//   coalesce, keys and buttons never drop).
import type { BrowserFrame, BrowserInventory } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { RemoteViewState } from '@shared/ipc/schema/browser';
import type { RemoteInput } from './input';

export type RemoteStream = 'none' | 'opening' | 'live' | 'waiting' | 'stopped';
export type RemoteControl = 'none' | 'taking' | 'held';
export interface RemoteFrameMeta {
  tabId: string;
  epoch: string;
  seq: number;
  width: number;
  height: number;
  viewport: { width: number; height: number };
}
export interface RemoteBrowserState {
  viewId: string | null;
  view: RemoteViewState;
  inventory: BrowserInventory | null;
  showing: boolean; // the person shows the agent's browser (else their own tabs on this Mac)
  shown: { tabId: string; epoch: string } | null; // this viewer's tab
  stream: RemoteStream;
  frame: RemoteFrameMeta | null; // the last drawn, of the shown tab
  control: RemoteControl;
  notice: { kind: 'refused'; reason: string } | { kind: 'revoked' } | null;
}

/** Draws one frame on the canvas; a rejection is a frame dropped. */
export type FrameDrawer = (frame: BrowserFrame) => Promise<void>;

const RESUMES = 3; // reopenings of a closed stream with no frame drawn between
// a stream closed with these waits for the inventory (the tab or the engine is gone, or the channel is down)
const WAITS = new Set(['tab-closed', 'engine-changed', 'carrier', 'removed', 'closed', 'not-offered']);
// a controlling stream refused at its reopen: control is given back, the next stream read-only
const CONTROL_REFUSED = new Set(['control-busy', 'grade', 'unknown', 'read-only']);
const CONNECTING: RemoteViewState = { kind: 'connecting' };

export class RemoteBrowserClient {
  #state: RemoteBrowserState = { viewId: null, view: CONNECTING, inventory: null, showing: false, shown: null, stream: 'none', frame: null, control: 'none', notice: null };
  readonly #listeners = new Set<() => void>();
  #offs: (() => void)[] = [];
  #ended = false; // closed by its window
  #generation = 0; // an open's, so an older open's answer is told apart
  #drawer: FrameDrawer | null = null;
  #held: BrowserFrame | null = null; // a frame of the shown tab no canvas has drawn yet, unacknowledged
  #drawing = false;
  #resumes = 0;
  #selecting = 0; // selects on their way
  #deferred: string | null = null; // a close heard while a select was on its way
  #seq = 0;
  #moving = false; // a move on its way
  #nextMove: RemoteInput | null = null;

  constructor(
    readonly appSessionId: AppSessionId,
    private readonly bridge: MawsBridge,
  ) {}

  getState = (): RemoteBrowserState => this.#state;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #set(patch: Partial<RemoteBrowserState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  // ---- the view ------------------------------------------------------------------------------------------------------

  open(): void {
    const generation = ++this.#generation;
    this.#ended = false;
    const ours = (viewId: string) => generation === this.#generation && viewId === this.#state.viewId;
    this.#offs.push(
      this.bridge.on('browser.remote.inventory', ({ viewId, inventory, view }) => ours(viewId) && this.#inventory(inventory, view)),
      this.bridge.on('browser.remote.frame', ({ viewId, frame }) => ours(viewId) && this.#frame(frame)),
      this.bridge.on('browser.remote.closed', ({ viewId, reason }) => ours(viewId) && this.#closedOrDeferred(reason)),
    );
    void this.bridge.invoke('browser.remote.open', { appSessionId: this.appSessionId }).then((result) => {
      if (generation !== this.#generation) {
        if (result.ok) void this.bridge.invoke('browser.remote.close', { viewId: result.value.viewId });
        return;
      }
      if (!result.ok) {
        console.warn(`[browser] the agent’s browser of ${this.appSessionId} could not be opened: ${result.error.message}`);
        return this.#set({ view: { kind: 'ended', end: 'failed' } });
      }
      this.#set({ viewId: result.value.viewId });
      this.#inventory(result.value.inventory, result.value.view);
    });
  }

  /** The window lets the view go: its feed and stream close. */
  close(): void {
    this.#generation += 1;
    this.#ended = true;
    for (const off of this.#offs.splice(0)) off();
    const { viewId } = this.#state;
    if (viewId !== null) void this.bridge.invoke('browser.remote.close', { viewId });
    this.#held = null;
    this.#set({ viewId: null, stream: 'none', control: 'none' });
  }

  /** A view that ended, opened anew. */
  reopen(): void {
    const { showing } = this.#state;
    this.close();
    this.#state = { viewId: null, view: CONNECTING, inventory: null, showing, shown: null, stream: 'none', frame: null, control: 'none', notice: null };
    this.#resumes = 0;
    this.#set({});
    this.open();
  }

  #inventory(inventory: BrowserInventory, view: RemoteViewState): void {
    const before = this.#state;
    const moved = before.inventory !== null && inventory.state === 'ready' && before.inventory.epoch !== inventory.epoch;
    this.#set({ inventory, view, ...(moved && before.control !== 'none' && { control: 'none' }) });
    if (!before.showing || view.kind !== 'live') return;
    const shown = before.shown;
    if (shown === null) return this.#showDefault();
    const listed = inventory.tabs.some((tab) => tab.tabId === shown.tabId);
    if (listed && inventory.epoch === shown.epoch) {
      if (before.stream === 'waiting') this.#select(shown.tabId);
      return;
    }
    if (listed) return this.#select(shown.tabId);
    this.#showDefault();
  }

  // ---- this viewer's tab ---------------------------------------------------------------------------------------------

  /** Shows the agent's browser at its own selected tab (or its first). */
  showAgent(): void {
    this.#set({ showing: true });
    if (this.#state.shown === null) this.#showDefault();
  }

  /** Shows the agent's tab `tabId` in this viewer (the one it shows already goes on as it is). */
  show(tabId: string): void {
    const { showing, shown, stream } = this.#state;
    this.#set({ showing: true });
    if (showing && shown?.tabId === tabId && stream !== 'stopped') return;
    this.#resumes = 0;
    this.#select(tabId);
  }

  /** The person shows their own tabs: the agent's stream waits (its frame held, nothing acknowledged). */
  hide(): void {
    this.#set({ showing: false });
  }

  /** The stream stopped: open it again at the person's ask. */
  retry(): void {
    const shown = this.#state.shown;
    this.#resumes = 0;
    if (shown) this.#select(shown.tabId);
  }

  #showDefault(): void {
    const inventory = this.#state.inventory;
    const tabs = inventory?.state === 'ready' ? inventory.tabs : [];
    const pick = tabs.find((tab) => tab.tabId === inventory?.selected) ?? tabs[0];
    if (pick) return this.#select(pick.tabId);
    this.#held = null;
    this.#set({ shown: null, stream: 'none', frame: null });
  }

  #select(tabId: string): void {
    const { viewId, inventory, frame } = this.#state;
    if (viewId === null || inventory === null || this.#ended) return;
    const epoch = inventory.epoch;
    this.#held = null;
    this.#selecting += 1;
    this.#set({ shown: { tabId, epoch }, stream: 'opening', frame: frame?.tabId === tabId ? frame : null });
    void this.bridge.invoke('browser.remote.select', { viewId, epoch, tabId }).then((result) => {
      this.#selecting -= 1;
      if (!result.ok) {
        console.warn(`[browser] the agent’s tab ${tabId} could not be shown: ${result.error.message}`);
        if (this.#selecting === 0) this.#set({ stream: 'stopped' });
        return;
      }
      const deferred = this.#deferred;
      if (this.#selecting > 0 || deferred === null) return;
      this.#deferred = null;
      this.#closed(deferred);
    });
  }

  // ---- frames --------------------------------------------------------------------------------------------------------

  setDrawer(drawer: FrameDrawer | null): void {
    this.#drawer = drawer;
    if (drawer && this.#held) this.#draw();
  }

  #frame(frame: BrowserFrame): void {
    const shown = this.#state.shown;
    if (shown === null || frame.tabId !== shown.tabId || frame.epoch !== shown.epoch) return this.#ack(frame.seq); // dropped
    this.#held = frame; // one in flight: the producer waits for its acknowledgement
    if (this.#drawer && !this.#drawing) this.#draw();
  }

  #draw(): void {
    const frame = this.#held;
    const drawer = this.#drawer;
    if (!frame || !drawer) return;
    this.#held = null;
    this.#drawing = true;
    void drawer(frame)
      .then(
        () => {
          const shown = this.#state.shown;
          if (shown?.tabId !== frame.tabId || shown.epoch !== frame.epoch) return;
          this.#resumes = 0;
          this.#deferred = null;
          const { tabId, epoch, seq, width, height, viewport } = frame;
          this.#set({ stream: 'live', frame: { tabId, epoch, seq, width, height, viewport } });
        },
        (error: unknown) => console.warn(`[browser] a frame of the agent’s tab ${frame.tabId} was dropped: ${error instanceof Error ? error.message : String(error)}`),
      )
      .finally(() => {
        this.#drawing = false;
        this.#ack(frame.seq);
        if (this.#held) this.#draw();
      });
  }

  #ack(seq: number): void {
    const { viewId } = this.#state;
    if (viewId !== null) void this.bridge.invoke('browser.remote.ack', { viewId, seq });
  }

  // ---- a closed stream -----------------------------------------------------------------------------------------------

  #closedOrDeferred(reason: string): void {
    if (this.#selecting > 0) this.#deferred = reason;
    else this.#closed(reason);
  }

  #closed(reason: string): void {
    const { control, shown, view, inventory } = this.#state;
    if (reason === 'control-revoked' && control !== 'none') this.#set({ control: 'none', notice: { kind: 'revoked' } });
    else if (CONTROL_REFUSED.has(reason) && control === 'held') {
      const { viewId } = this.#state;
      if (viewId !== null) void this.bridge.invoke('browser.remote.releaseControl', { viewId });
      this.#set({ control: 'none', notice: { kind: 'refused', reason } });
    }
    if (shown === null) return this.#set({ stream: 'none' });
    if (WAITS.has(reason)) return this.#set({ stream: 'waiting' });
    const listed = inventory?.tabs.some((tab) => tab.tabId === shown.tabId) === true;
    if (view.kind !== 'live' || !listed) return this.#set({ stream: 'waiting' });
    if (this.#resumes >= RESUMES) return this.#set({ stream: 'stopped' });
    this.#resumes += 1;
    this.#select(shown.tabId);
  }

  // ---- control and input ---------------------------------------------------------------------------------------------

  async takeControl(): Promise<void> {
    const { viewId, shown, control } = this.#state;
    if (viewId === null || shown === null || control !== 'none') return;
    const generation = this.#generation;
    this.#set({ control: 'taking', notice: null });
    const result = await this.bridge.invoke('browser.remote.takeControl', { viewId });
    if (generation !== this.#generation || this.#state.control !== 'taking') return;
    if (!result.ok) return this.#set({ control: 'none', notice: { kind: 'refused', reason: result.error.message } });
    if (result.value.control) return this.#set({ control: 'held' });
    this.#set({ control: 'none', notice: { kind: 'refused', reason: result.value.reason ?? '' } });
  }

  releaseControl(): void {
    const { viewId, control } = this.#state;
    if (control === 'none') return;
    this.#nextMove = null;
    this.#set({ control: 'none', notice: null });
    if (viewId !== null) void this.bridge.invoke('browser.remote.releaseControl', { viewId });
  }

  dismissNotice(): void {
    this.#set({ notice: null });
  }

  /** One input to the page, while control is held. */
  input(event: RemoteInput): void {
    if (this.#state.control !== 'held' || this.#state.viewId === null) return;
    const isMove = event.kind === 'pointer' && event.type === 'move';
    if (isMove && this.#moving) {
      this.#nextMove = event;
      return;
    }
    if (!isMove && this.#nextMove) {
      const move = this.#nextMove;
      this.#nextMove = null;
      this.#send(move, true);
    }
    this.#send(event, isMove);
  }

  #send(event: RemoteInput, isMove: boolean): void {
    const { viewId } = this.#state;
    if (viewId === null) return;
    if (isMove) this.#moving = true;
    const sent = this.bridge.invoke('browser.remote.input', { viewId, seq: ++this.#seq, event });
    if (!isMove) return void sent;
    void sent.finally(() => {
      this.#moving = false;
      const next = this.#nextMove;
      this.#nextMove = null;
      if (next) this.input(next);
    });
  }
}
