// The state a deck tab owns (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Shell"; M4): what L's registry
// makes with `createState` when a surface starts showing a presentation and ends with `dispose` when it stops (X32's
// lifetime rule: the header's close guard and the editor's undo stack read the tab, never a body that may have
// unmounted on a tab switch). It opens and keeps the replica (`ArtifactHost.open`), follows its saved state, and holds
// the deck session (the one undo stack, the slide shown, the zoom). A restore of a version (A's frame 101) clears the
// undo stack: what it refers to was replaced. The replica closes once the host has acknowledged every edit it holds.
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { DeckSession } from '@artifacts/slides/editor/session';
import type { ArtifactEditorTarget } from '../../artifacts/registry';

const SAVE_WAIT_MS = 3_000; // how long the close guard waits for edits in flight before it asks (B's rule)
// Edits wait this long for the host's acknowledgement before the header says "Saving…", so a drag's frames, each
// acknowledged in milliseconds, never flicker the saved word (S7b's bound 3; B's M9).
const SAVING_SHOWN_MS = 500;

export interface DeckTabDeps {
  host: ArtifactHost;
  log(line: string): void;
  /** Asks the owner whether to close with edits the host has not acknowledged. */
  confirmDiscard(title: string): Promise<boolean>;
  savingShownMs?: number;
  /** How long the close guard waits for edits in flight before it asks (3 s). */
  saveWaitMs?: number;
}

export interface DeckTabSnapshot {
  failed: string | null;
  handle: DocumentHandle | null;
  session: DeckSession | null;
  /** The replica's state as of its last change of phase, sync or read-only. */
  document: DocumentState | null;
  saving: boolean;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Every open deck tab, for the e2e seam's timings.
const open = new Set<DeckTabState>();
export const openDeckTabs = (): readonly DeckTabState[] => [...open];

export class DeckTabState {
  readonly artifactId: string;
  readonly surface: ArtifactEditorTarget['surface'];
  readonly host: ArtifactHost;
  private current: DeckTabSnapshot = { failed: null, handle: null, session: null, document: null, saving: false };
  private readonly listeners = new Set<() => void>();
  private readonly stops: (() => void)[] = [];
  private disposed = false;
  private closing = false;
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
    let handle: DocumentHandle;
    try {
      handle = await this.deps.host.open(this.artifactId);
    } catch (error) {
      if (!this.disposed) this.set({ failed: messageOf(error) });
      return;
    }
    if (this.disposed) return void handle.close();
    const session = new DeckSession(handle.doc, this.openedAt);
    session.timings.syncedAt = performance.now();
    this.stops.push(
      handle.subscribe((document) => this.follow(handle, document)),
      handle.onRestored(() => session.undo.clear()),
      () => this.stopSavingTimer(),
    );
    this.set({ handle, session, document: handle.state() });
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

  /** The content is on screen: true the first time (the surface records the owner's view then), false after. */
  markShown = (): boolean => {
    if (this.wasShown) return false;
    this.wasShown = true;
    return true;
  };

  /** X32's close guard: nothing is lost once the host has every edit; edits in flight are waited for, then asked about. */
  closeGuard = async (): Promise<boolean> => {
    const handle = this.current.handle;
    if (!handle || handle.state().readOnly || handle.state().unsaved === 0) return true;
    const saved = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(false);
      }, this.deps.saveWaitMs ?? SAVE_WAIT_MS);
      const off = handle.subscribe((state) => {
        if (state.unsaved > 0) return;
        clearTimeout(timer);
        off();
        resolve(true);
      });
    });
    return saved || handle.state().unsaved === 0 || this.deps.confirmDiscard(this.title);
  };

  /** The tab stopped showing the deck: the replica closes once the host has acknowledged every edit it holds. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    open.delete(this);
    for (const stop of this.stops.splice(0)) stop();
    this.listeners.clear();
    this.current.session?.dispose();
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
