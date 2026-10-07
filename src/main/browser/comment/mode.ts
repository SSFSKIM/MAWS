// Comment mode's state and gate in main (E4d execution document, Design §1, §2, §8, §9; A-33): which tab is armed,
// what turns it off, and whether a message on the preload's channel is the person's pick.
//
// One tab is armed at a time. Arming sends the tab's preload a fresh epoch and inserts the crosshair; an Esc in the
// page (native keys only: `before-input-event` never hears a CDP key), a navigation to another document, a crash, the
// view going, or the agent taking the page (`setControl`, through the store's synchronous `onUpdated`) disarms it. The
// context menu's `pickAt` asks for one report at a point without arming.
//
// The gate: a message counts only when it comes from a tab's own webContents, carries the tab's current epoch, and
// answers the arm (once) or the pending `pickAt` (once, within PICK_AT_MS); anything else is dropped and counted, never
// logged with its payload, and disarms nothing. A message that does answer is then checked whole (the strict schema,
// the css grammar, the page URL main reads itself, X10's and E4c's schemas through `browserElementAnchor`); failing any
// of it is a refusal, which ends the mode on the tab with `refused` so the toggle never stays pressed after a pick.
// An accepted pick is cropped, and sent to the window whose pane owns the tab only if nothing ended the mode meanwhile.
import { randomBytes } from 'node:crypto';
import type { Event, Input, WebContents, WebContentsView } from 'electron';
import type { Anchor } from '@shared/anchor/anchor';
import { browserElementAnchor, PreloadMessageSchema, type CommentDisarmReason } from '@shared/browser/comment';
import { COMMENT_CHANNEL, PICK_AT_MS, type PickRect, type ToPreload } from '@shared/browser/comment-protocol';
import type { BrowserCommentSetResult } from '@shared/ipc/schema/browser';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import type { Crop } from './crop';
import { ownerAlive, pickedPayload, sendPicked } from './send';

const CURSOR_CSS = '* { cursor: crosshair !important }';

export interface CommentModeDeps {
  store: Pick<TabStore, 'entry' | 'entryOf' | 'onViewCreated' | 'onViewDestroying' | 'onUpdated'>;
  emit: BrowserEmit;
  // The pick's picture (crop.ts `captureCrop` over the entry's view), and a written crop let go when its pick is not sent.
  capture(entry: TabEntry, rect: PickRect): Promise<Crop>;
  discard(path: string): void;
  now?(): number;
  requestId?(): string;
}

export interface CommentTabState {
  armed: boolean;
  epoch: number;
  dropped: number;
}

interface TabState extends CommentTabState {
  taken: boolean; // the arm's one report was accepted
  view: WebContentsView | null; // the view armed, while armed
  css: Promise<string | null> | null; // the inserted crosshair's key
  pending: { requestId: string; at: number } | null; // the context menu's pick, awaiting its one report
}

type Via = 'arm' | 'pickAt';
type Refusal = Exclude<BrowserCommentSetResult['reason'], 'ok'>;

export class CommentMode {
  private readonly states = new Map<string, TabState>();
  private armedTab: string | null = null;
  private foreign = 0;
  private disposed = false;
  private readonly unhook: (() => void)[];
  private readonly now: () => number;
  private readonly newRequestId: () => string;

  constructor(private readonly deps: CommentModeDeps) {
    this.now = deps.now ?? Date.now;
    this.newRequestId = deps.requestId ?? (() => randomBytes(8).toString('hex'));
    const { store } = deps;
    this.unhook = [
      store.onViewCreated((entry) => this.attach(entry)),
      store.onViewDestroying((entry) => this.end(entry.tab.tabId, 'closed')),
      // E4a's `setControl` is the one `control` transition and calls this before it returns, so the mode is off and
      // the gate closed before E4c's action is dispatched (Decision Log 26(a)).
      store.onUpdated((entry) => {
        if (entry.tab.control === 'agent') this.end(entry.tab.tabId, 'agent');
      }),
    ];
  }

  // ---- the toggle ------------------------------------------------------------------------------------------------------

  set(tabId: string, on: boolean): BrowserCommentSetResult {
    const entry = this.deps.store.entry(tabId);
    if (!entry) return { on: false, reason: 'unknownTab' };
    if (!on) {
      this.disarm(tabId, 'toggle');
      return { on: false, reason: 'ok' };
    }
    const refusal = this.refusal(entry, { placed: true });
    if (refusal !== null) return { on: false, reason: refusal };
    const state = this.stateOf(tabId);
    if (state.armed) return { on: true, reason: 'ok' };
    if (this.armedTab !== null) this.disarm(this.armedTab, 'other'); // one picker at a time (Decision Log 17)
    const view = entry.view!;
    state.epoch += 1;
    state.armed = true;
    state.taken = false;
    state.view = view;
    state.css = view.webContents.insertCSS(CURSOR_CSS).catch(() => null);
    this.armedTab = tabId;
    this.toPreload(view, { type: 'arm', epoch: state.epoch });
    this.deps.emit('browser.comment.changed', { tabId, on: true, reason: 'armed' });
    return { on: true, reason: 'ok' };
  }

  // ---- the context menu's one-shot pick (CSS px of the viewport) -------------------------------------------------------

  pickAt(tabId: string, x: number, y: number): boolean {
    const entry = this.deps.store.entry(tabId);
    if (!entry || this.refusal(entry, { placed: false }) !== null) return false;
    const state = this.stateOf(tabId);
    const requestId = this.newRequestId();
    state.pending = { requestId, at: this.now() };
    this.toPreload(entry.view!, { type: 'pickAt', x, y, requestId, epoch: state.epoch });
    return true;
  }

  // ---- the gate ----------------------------------------------------------------------------------------------------------

  // A message on the preload's channel; resolves once a pick it accepted has been sent or dropped.
  async receive(sender: WebContents, message: unknown): Promise<void> {
    const entry = this.deps.store.entryOf(sender);
    if (!entry) {
      this.foreign += 1;
      return;
    }
    const { tabId } = entry.tab;
    const state = this.stateOf(tabId);
    const via = this.claim(entry, state, message);
    if (via === null) {
      state.dropped += 1;
      return;
    }
    const parsed = PreloadMessageSchema.safeParse(message);
    const report = parsed.success && parsed.data.type === 'picked' ? parsed.data : null;
    const view = entry.view!;
    const pageUrl = view.webContents.getURL(); // main's, never the page's
    const bare = report && browserElementAnchor({ report, pageUrl, screenshot: null });
    if (!report || !bare) return this.refuse(tabId, state, via);

    const epoch = state.epoch;
    const crop = await this.deps.capture(entry, report.rect);
    const screenshot = crop.crop === 'attached' ? crop.screenshot : null;
    const current =
      !this.disposed &&
      this.states.get(tabId) === state &&
      this.deps.store.entry(tabId) === entry &&
      entry.view === view &&
      state.epoch === epoch &&
      entry.tab.control !== 'agent' &&
      (via === 'pickAt' || (state.armed && state.taken));
    if (!current) {
      if (screenshot) this.deps.discard(screenshot.path);
      return; // whatever ended the mode meanwhile has told the renderer
    }
    let anchor: Anchor = bare;
    let outcome = crop.crop;
    if (screenshot) {
      const pictured = browserElementAnchor({ report, pageUrl, screenshot });
      if (pictured) anchor = pictured;
      else {
        this.deps.discard(screenshot.path);
        outcome = 'failed';
      }
    }
    // checked against the X2 registry before the mode ends, so a payload it refuses ends as a refusal the renderer
    // toasts rather than as a silent pick
    const payload = pickedPayload({ tabId, appSessionId: entry.tab.appSessionId, anchor, crop: outcome });
    if (payload === null) {
      if (screenshot && outcome === 'attached') this.deps.discard(screenshot.path);
      return this.refuse(tabId, state, via);
    }
    const owner = entry.placement?.window ?? null;
    if (!ownerAlive(owner)) {
      // no window to open the sheet in; never broadcast, which would make a thread per window (Decision Log 14)
      if (screenshot && outcome === 'attached') this.deps.discard(screenshot.path);
      if (via === 'arm') this.disarm(tabId, 'closed');
      return;
    }
    if (via === 'arm') this.disarm(tabId, 'picked');
    sendPicked(owner, payload);
  }

  // ---- reads (the e2e seam) ----------------------------------------------------------------------------------------------

  state(tabId: string): CommentTabState | null {
    if (!this.deps.store.entry(tabId) && !this.states.has(tabId)) return null;
    const { armed, epoch, dropped } = this.stateOf(tabId);
    return { armed, epoch, dropped };
  }

  // Messages from a webContents that is no tab's.
  foreignDropped(): number {
    return this.foreign;
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.unhook) off();
    this.states.clear(); // the pages are closed next; nothing is told after the quit began
    this.armedTab = null;
  }

  // ---- internals ---------------------------------------------------------------------------------------------------------

  // Why the tab cannot be picked on now, or null. A page is a committed document of the tab's own in a live view.
  private refusal(entry: TabEntry, { placed }: { placed: boolean }): Refusal | null {
    const { tab, view } = entry;
    if (tab.suspended) return 'suspended';
    if (view === null || view.webContents.isDestroyed() || !entry.committed || tab.loadError !== null || tab.crashed !== null) return 'noPage';
    if (tab.control === 'agent') return 'agent';
    if (placed && entry.placement === null) return 'notPlaced';
    return null;
  }

  // Which request a message answers: the arm's one report (no request id), or the pending pickAt's; null when neither.
  // Claiming spends the request, so a second answer is dropped whatever it carries.
  private claim(entry: TabEntry, state: TabState, message: unknown): Via | null {
    if (typeof message !== 'object' || message === null || entry.view === null || entry.tab.control === 'agent') return null;
    const { epoch, requestId } = message as { epoch?: unknown; requestId?: unknown };
    if (epoch !== state.epoch) return null;
    if (state.pending !== null && requestId === state.pending.requestId) {
      const late = this.now() - state.pending.at > PICK_AT_MS;
      state.pending = null;
      return late ? null : 'pickAt';
    }
    if (state.armed && !state.taken && requestId === null) {
      state.taken = true;
      return 'arm';
    }
    return null;
  }

  // A pick main cannot build an anchor from: the mode ends with `refused`, which the renderer toasts.
  private refuse(tabId: string, state: TabState, via: Via): void {
    if (via === 'arm' || state.armed) this.disarm(tabId, 'refused');
    else this.deps.emit('browser.comment.changed', { tabId, on: false, reason: 'refused' });
  }

  // A report from the document leaving is stale from here.
  private navigated(tabId: string): void {
    const state = this.states.get(tabId);
    if (!state) return;
    state.epoch += 1;
    this.end(tabId, 'navigated');
  }

  // The tab's page went (`closed`, `crashed`) or the agent took it (`agent`): the pending pick dropped, the arm ended.
  private end(tabId: string, reason: CommentDisarmReason): void {
    const state = this.states.get(tabId);
    if (!state) return;
    state.pending = null;
    this.disarm(tabId, reason);
  }

  private disarm(tabId: string, reason: CommentDisarmReason): void {
    const state = this.states.get(tabId);
    if (!state?.armed) return;
    const { view, css } = state;
    state.armed = false;
    state.taken = false;
    state.view = null;
    state.css = null;
    if (this.armedTab === tabId) this.armedTab = null;
    if (view !== null && !view.webContents.isDestroyed()) {
      this.toPreload(view, { type: 'disarm' });
      const contents = view.webContents;
      void css?.then((key) => (key === null || contents.isDestroyed() ? undefined : contents.removeInsertedCSS(key))).catch(() => {});
    }
    this.deps.emit('browser.comment.changed', { tabId, on: false, reason });
  }

  private toPreload(view: WebContentsView, message: ToPreload): void {
    if (!view.webContents.isDestroyed()) view.webContents.send(COMMENT_CHANNEL.toPreload, message);
  }

  private stateOf(tabId: string): TabState {
    let state = this.states.get(tabId);
    if (!state) this.states.set(tabId, (state = { armed: false, epoch: 0, dropped: 0, taken: false, view: null, css: null, pending: null }));
    return state;
  }

  // The page's own events, for the view's life; each acts only on the tab's current state.
  private attach(entry: TabEntry): void {
    const view = entry.view!;
    const wc = view.webContents;
    const { tabId } = entry.tab;
    const live = () => !this.disposed && this.deps.store.entry(tabId) === entry && entry.view === view;
    let escapeTaken = false; // the Esc keyDown that disarmed: its keyUp is the mode's too, so the page sees no half key
    wc.on('before-input-event', (event: Event, input: Input) => {
      if (!live()) return;
      if (input.type === 'keyUp') {
        if (escapeTaken && input.key === 'Escape') {
          escapeTaken = false;
          event.preventDefault();
        }
        return;
      }
      if (input.type !== 'keyDown' || input.key !== 'Escape' || input.meta || input.control || input.alt || input.shift) return;
      if (!this.states.get(tabId)?.armed) return;
      event.preventDefault();
      escapeTaken = true;
      this.disarm(tabId, 'escape');
    });
    wc.on('did-start-navigation', (details) => {
      if (!live() || !details.isMainFrame || details.isSameDocument) return;
      this.navigated(tabId);
    });
    // The commit too (main frame, another document): an arm or a pickAt made while that navigation was in flight went
    // to the document leaving, and the one arriving starts with a disarmed preload.
    wc.on('did-navigate', () => {
      if (live()) this.navigated(tabId);
    });
    wc.on('render-process-gone', () => {
      if (live()) this.end(tabId, 'crashed');
    });
    wc.once('destroyed', () => {
      if (this.states.get(tabId)?.view === view) this.end(tabId, 'closed');
      if (!this.deps.store.entry(tabId)) this.states.delete(tabId); // the tab is gone, not only its page
    });
  }
}
