// The state a deck tab owns (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Shell"; M4): what L's registry
// makes with `createState` when a surface starts showing a presentation and ends with `dispose` when it stops (X32's
// lifetime rule: the header's close guard and the editor's undo stack read the tab, never a body that may have
// unmounted on a tab switch). It opens and keeps the replica (`ArtifactHost.open`), follows its saved state, and holds
// the deck session (the one undo stack, the slide shown, the zoom). A restore of a version (A's frame 101) clears the
// undo stack: what it refers to was replaced. The replica closes once the host has acknowledged every edit it holds.
// M7: the open threads the header counts, and what still writes into the replica (`hold`: the comment card's overlay
// withdrawing an unsent draft, a sent comment recorded in its thread), which the close waits for (B's rule).
// M8: the deck's history api (B's `createHistoryApi` on A's IPC, D11), with the owner's last view as the artifact's row
// held it before this showing (the "See N new changes" pill compares against it) and the rail's own view waiting until
// the deck is first on screen, as B's tab does.
// Final fix wave (B4): the close guard waits for the session's awaited edits too (an upload, an asset copy, whose write
// has not happened yet), and the session reads the replica's read-only state before such an edit writes.
// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; X36's draft rule, as the document's tab): the
// comment card host's id is this state's, the same for every body over it, and the close guard asks first about an
// unsent comment typed in this tab's compose card.
// P4-A2 G2.3 (X35; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G2.3): the replica's provisional layers,
// one store per handle held here, so a layer a commit has not yet swapped outlives a body unmounting on a tab switch.
import type { HistoryApi } from '@artifacts/document/editor/history/api';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { ProvisionalLayers } from '@artifacts/provisional';
import { DeckSession } from '@artifacts/slides/editor/session';
import { deckCommentCounts } from '@artifacts/slides/comment-counts';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactEditorTarget } from '../../artifacts/registry';
import type { CloseAsk } from '../../panel/editor-host'; // P4-B2
import { commentDraftEntry } from '../document/comment-drafts'; // P4-B2
import { forgetCardActivation } from '../document/comments'; // P4-B2
import { createHistoryApi } from '../document/history-api'; // M8: B's, reused

const SAVE_WAIT_MS = 3_000; // how long the close guard waits for edits in flight before it asks (B's rule)
// Edits wait this long for the host's acknowledgement before the header says "Saving…", so a drag's frames, each
// acknowledged in milliseconds, never flicker the saved word (S7b's bound 3; B's M9).
const SAVING_SHOWN_MS = 500;

export interface DeckTabDeps {
  host: ArtifactHost;
  log(line: string): void;
  /** Asks the owner whether to close with edits the host has not acknowledged; P4-B2: or (`comment`) with an unsent comment. */
  confirmDiscard(title: string, about?: 'comment'): Promise<boolean>;
  savingShownMs?: number;
  /** How long the close guard waits for edits in flight before it asks (3 s). */
  saveWaitMs?: number;
  /** M8: A's IPC, for the deck's history (without it, no history). */
  ipc?: Pick<MawsBridge, 'invoke' | 'on'>;
  /** M8: a session's title for the history's author chips. */
  sessionTitle?(appSessionId: string): string | undefined;
}

export interface DeckTabSnapshot {
  failed: string | null;
  handle: DocumentHandle | null;
  session: DeckSession | null;
  /** The replica's state as of its last change of phase, sync or read-only. */
  document: DocumentState | null;
  saving: boolean;
  /** M7, WR 49: the deck's live-target open threads (the header's count). */
  unresolved: number;
  /** P4-A2 G2.3: the replica's provisional layers (an agent's publish as it streams), listening while the tab holds it. */
  provisional: ProvisionalLayers | null;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Every open deck tab, for the e2e seam's timings.
const open = new Set<DeckTabState>();
export const openDeckTabs = (): readonly DeckTabState[] => [...open];
let commentHosts = 0; // P4-B2

export class DeckTabState {
  readonly artifactId: string;
  // The surface whose tab holds it: the one it was made for, then (P4-B3) the one a move handed it to (`moveTo`).
  surface: ArtifactEditorTarget['surface'];
  readonly host: ArtifactHost;
  /** M8: the deck's version history on A's IPC; null without the IPC. */
  readonly history: HistoryApi | null;
  /** M8: a session's title for the history's author chips. */
  readonly sessionTitle: ((appSessionId: string) => string | undefined) | undefined;
  /** P4-B2: the comment card host's id, the same for every body over this state (its draft is this tab's). */
  readonly commentHostId = `deck:tab-${++commentHosts}`;
  private viewedBefore: number | null = null; // M8: the owner's last view before this showing
  private resolveShown: () => void = () => {};
  private readonly whenShown = new Promise<void>((resolve) => (this.resolveShown = resolve));
  private current: DeckTabSnapshot = { failed: null, handle: null, session: null, document: null, saving: false, unresolved: 0, provisional: null };
  private readonly listeners = new Set<() => void>();
  private readonly stops: (() => void)[] = [];
  private disposed = false;
  private closing = false;
  private holders = 0; // M7: what still writes into the replica (`hold`)
  private wasShown = false;
  private title = '';
  private savingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly openedAt = performance.now();

  constructor(
    target: ArtifactEditorTarget,
    private readonly deps: DeckTabDeps,
  ) {
    this.artifactId = target.artifactId;
    this.surface = target.surface;
    this.host = deps.host;
    const ipc = deps.ipc;
    this.sessionTitle = deps.sessionTitle;
    this.history = ipc
      ? createHistoryApi({
          artifactId: this.artifactId,
          ipc,
          host: deps.host,
          viewedAt: { get: () => this.viewedBefore, set: (at) => (this.viewedBefore = at) },
          whenShown: () => this.whenShown,
          ...(deps.sessionTitle ? { sessionTitle: deps.sessionTitle } : {}),
          log: deps.log,
        })
      : null;
    open.add(this);
    void this.open();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): DeckTabSnapshot => this.current;

  private set(patch: Partial<DeckTabSnapshot>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private async open(): Promise<void> {
    if (this.deps.ipc) await this.readViewed(this.deps.ipc);
    let handle: DocumentHandle;
    try {
      handle = await this.deps.host.open(this.artifactId);
    } catch (error) {
      if (!this.disposed) this.set({ failed: messageOf(error) });
      return;
    }
    if (this.disposed) return void handle.close();
    // M5: the text box's composition hold; fix wave 1: the selection published to other replicas beside who this is
    const { name, color } = this.deps.host.identity();
    const session = new DeckSession(handle.doc, this.openedAt, { holdRemote: (on) => handle.holdRemote(on), presence: { awareness: handle.awareness, name, color }, readOnly: () => handle.state().readOnly });
    session.timings.syncedAt = performance.now();
    const provisional = new ProvisionalLayers(handle); // P4-A2 G2.3
    const comments = deckCommentCounts(handle.doc);
    this.stops.push(
      provisional.attach(),
      handle.subscribe((document) => this.follow(handle, document)),
      handle.onRestored(() => session.undo.clear()),
      () => this.stopSavingTimer(),
      comments.subscribe(() => {
        const unresolved = comments.getSnapshot().total;
        if (unresolved !== this.current.unresolved) this.set({ unresolved });
      }), // M7
    );
    this.set({ handle, session, document: handle.state(), unresolved: comments.getSnapshot().total, provisional });
  }

  // M8: the owner's last view as the artifact's row holds it before this showing records its own (L's `onShown`, after
  // the first slide is drawn, which the replica's open precedes).
  private async readViewed(ipc: Pick<MawsBridge, 'invoke'>): Promise<void> {
    try {
      const result = await ipc.invoke('artifacts.get', { artifactId: this.artifactId });
      if (!result.ok) throw new Error(result.error.message);
      this.viewedBefore = result.value.artifact?.lastViewedAt ?? null;
    } catch (error) {
      this.deps.log(`presentation ${this.artifactId}: its row could not be read: ${messageOf(error)}`);
    }
  }

  // What the header reads of the replica: its phase, sync and read-only as they change, and edits left waiting for the
  // host past the delay (an edit acknowledged sooner publishes nothing).
  private follow(handle: DocumentHandle, document: DocumentState): void {
    if (document.unsaved === 0) this.stopSavingTimer();
    else if (this.savingTimer === null && !this.current.saving) {
      this.savingTimer = setTimeout(() => {
        this.savingTimer = null;
        if (!this.disposed && handle.state().unsaved > 0) this.set({ document: handle.state(), saving: true });
      }, this.deps.savingShownMs ?? SAVING_SHOWN_MS);
    }
    const shown = this.current.document;
    const saving = this.current.saving && document.unsaved > 0;
    if (shown && shown.phase === document.phase && shown.synced === document.synced && shown.readOnly === document.readOnly && saving === this.current.saving) return;
    this.set({ document, saving });
  }
  private stopSavingTimer(): void {
    if (this.savingTimer !== null) clearTimeout(this.savingTimer);
    this.savingTimer = null;
  }

  /** The deck's title as the body last read it (the close guard's question names it). */
  setTitle(title: string): void {
    this.title = title;
  }

  /** P4-B3: a move handed this state to a tab on another surface (the registry's `moved`). */
  moveTo(surface: ArtifactEditorTarget['surface']): void {
    this.surface = surface;
    forgetCardActivation(this.commentHostId); // P4-B2: the editor the move gives draws the card's thread active again
  }

  /** The content is on screen: true the first time (the surface records the owner's view then), false after. */
  markShown = (): boolean => {
    if (this.wasShown) return false;
    this.wasShown = true;
    this.resolveShown(); // M8: the rail's view waits for it
    return true;
  };

  /**
   * X32's close guard: nothing is lost once the host has every edit and no awaited edit (B4: an upload, an asset copy)
   * is still to write; those in flight are waited for, then asked about. P3-F (L203): speaker notes the session keeps
   * unwritten (refused for their length, or within it only since a change made elsewhere) go with the tab, read-only or
   * not: only the owner writes them, so waiting cannot save them; once what is in flight settled, they are asked about.
   * P4-B2 (X36's draft rule): an unsent comment typed in this tab's compose card is asked about first; not on a move,
   * whose card goes with the state to the view the move keeps.
   */
  closeGuard = async (ask?: CloseAsk): Promise<boolean> => {
    const draft = ask?.moving ? null : commentDraftEntry(this.artifactId); // P4-B2
    if (draft?.hostId === this.commentHostId && draft.text.trim() && !(await this.deps.confirmDiscard(this.title, 'comment'))) return false;
    const handle = this.current.handle;
    if (!handle) return true;
    const session = this.current.session;
    const settled = () => handle.state().readOnly || (handle.state().unsaved === 0 && (session?.snapshot().pending ?? 0) === 0);
    const unwritten = () => session?.hasUnwrittenNotes() ?? false; // L203
    if (settled()) return !unwritten() || this.deps.confirmDiscard(this.title);
    const saved = await new Promise<boolean>((resolve) => {
      const stops: (() => void)[] = [];
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        for (const stop of stops.splice(0)) stop();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), this.deps.saveWaitMs ?? SAVE_WAIT_MS);
      const check = () => settled() && finish(true);
      stops.push(handle.subscribe(check));
      if (session) stops.push(session.subscribe(check));
    });
    return ((saved || settled()) && !unwritten()) || this.deps.confirmDiscard(this.title);
  };

  /**
   * M7: holds the replica open until the returned release (B's `hold`): the comment card's overlay takes it while it is
   * mounted and until its withdrawal of an unsent draft is written, and each send until it settled.
   */
  hold = (): (() => void) => {
    this.holders += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders -= 1;
      if (this.disposed && this.holders === 0) this.closeWhenSaved();
    };
  };

  /** The tab stopped showing the deck: the replica closes once nothing holds it and the host has acknowledged every edit. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    open.delete(this);
    for (const stop of this.stops.splice(0)) stop();
    this.listeners.clear();
    try {
      this.current.session?.dispose(); // P4-B2 (D17): it releases a standing hold, whose flush's listeners may throw
    } finally {
      if (this.holders === 0) this.closeWhenSaved(); // M7: else the last release closes it
    }
  }

  private closeWhenSaved(): void {
    const handle = this.current.handle;
    if (!handle || this.closing) return;
    if (handle.state().unsaved === 0 || handle.state().readOnly) return handle.close();
    this.closing = true;
    const off = handle.subscribe((state) => {
      if (state.unsaved > 0 && !state.readOnly) return;
      off();
      handle.close();
    });
  }
}
