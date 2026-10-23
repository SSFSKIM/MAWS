// The state a document tab owns (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13): what L's registry
// makes with `createState` when a surface starts showing a document and ends with `dispose` when it stops, so the X32
// header's actions and close guard read the tab, never a body that may have unmounted (X32's lifetime rule). It opens
// and keeps the replica (`ArtifactHost.open`), follows its saved state and its open threads, reads the artifact's row
// (the title, the suggestions setting, and the owner's last view as it stood before this showing, which the history
// rail's "See N new changes" compares against: the surface records this view once the editor is on screen), holds
// the rail the header toggles, an export's progress, and what still writes into the replica (the comment overlay
// through its draft's withdrawal, a send in flight that records its message, Decision Log 27): the replica closes
// only once nothing holds it and the host has acknowledged every edit.
// P3-F (8.2, F7; the deck's L233, the design's Decision Log 31; c65, c66): Export exports what the editor shows, the
// version its history previews (main reads that version's state and its pinned system) and nothing while two versions
// are compared, else the live document; main's export service writes it and the file is then saved where the owner
// chooses, as the deck's Export saves it (`artifacts.export`, then `library.saveAs`'s dialog at Downloads), the saved
// path said in a toast and a cancelled dialog saying nothing.
//
// P4-B3 M5 (its Decision Log 25; tracker row 147's undo half): the tab also keeps the undo history, one UndoManager per
// tab body of the document, which the body swaps into every editor it mounts (`view-carry.ts`): an editor's own manager
// dies with it, so a remount (the tab switched away and back, a move between the panel and a main tab) would start
// with nothing to undo. A restore this replica did not make clears it, as the binding clears its own (an undo across
// the restore would revert it); the tab's disposal ends it.
//
// A replica never initialises its document: the host writes a new document's first tab in the create's own commit (the
// document adapter's `initial`, A's seed hook), and the editor shows "Loading…" until that tab has arrived, then binds it.
import { listTabs } from '@artifacts/document/tabs';
import { documentCommentCounts } from '@artifacts/document/comment-counts';
import { onUpdate, type Node as YType } from '@artifacts/yjs';
import { UndoManager } from '@artifacts/yjs/document'; // P4-B3 M5
import type { DocumentRail, DocumentShown } from '@artifacts/document/editor/DocumentEditor'; // P3-F (F7): DocumentShown
import type { HistoryApi } from '@artifacts/document/editor/history/api';
import type { MentionSource } from '@artifacts/document/editor/MentionPicker';
import { actorKey } from '@shared/artifacts/actor';
import type { PageSize } from '@artifacts/document/export/design-system';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import type { ArtifactRow } from '@shared/ipc/schema/artifacts';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactEditorTarget } from '../../artifacts/registry';
import type { CloseAsk } from '../../panel/editor-host'; // P4-B3
import { toast } from '../../stores/notices'; // P3-F (F7)
import { VIEWERS_COPY } from '../artifacts/viewers/copy'; // P3-F (F7): the deck's words
import type { DocumentExportFormat, ExportStatus } from './header';
import { commentDraftEntry } from './comment-drafts'; // P4-B1; P4-B3: the entry, for its host
import { createHistoryApi } from './history-api';
import { documentMentions } from './mentions';

const ROW_QUIET_MS = 500; // a burst of writes reads the row once
const SAVE_WAIT_MS = 3_000; // how long the close guard waits for edits in flight before it asks
const NO_CONTENT_MS = 5_000; // the wait for a new document's first tab before saying it has none
// M9 (the scale gate): how long edits wait for the host's acknowledgement before the header says "Saving…". An edit
// acknowledged sooner (tens of milliseconds) publishes nothing, so a keystroke neither flickers the saved word (S7b's
// bound 3: X32's saved state must not flicker) nor re-renders the tab; every React commit while the editor has the
// focus walks the editor's whole DOM to save its selection, milliseconds a keystroke at 200 pages.
const SAVING_SHOWN_MS = 500;

export interface DocumentTabDeps {
  host: ArtifactHost;
  ipc: Pick<MawsBridge, 'invoke' | 'on'>;
  log(line: string): void;
  /** Asks the owner a yes-or-no question (the close guard's, when edits would be lost). */
  confirm(message: string): boolean;
  sessionTitle(appSessionId: string): string | undefined;
  /** The sessions a mention can name, most recent first, by their shown titles. */
  sessions(): Array<{ appSessionId: string; title: string }>;
  /** How long an open document may wait for its first tab before the tab says it has no content yet (5 s). */
  noContentMs?: number;
  /** How long edits wait for the host's acknowledgement before the tab says it is saving (500 ms). */
  savingShownMs?: number;
  /** P3-E (E2 M4; E's Decision Log 28): the kind's extra history changes, given to the history (a dashboard's datasets). */
  extraChanges?: HistoryApi['extraChanges'];
}

export interface DocumentTabSnapshot {
  /** The replica is open and the row was read (or could not be): the editor can show. */
  ready: boolean;
  failed: string | null; // the document cannot be opened (gone, not a document)
  handle: DocumentHandle | null;
  title: string;
  /** Where the artifact sits, as the governing design system is chosen by it (its own system, its Space's). */
  placement: { designSystemId?: string; spaceId?: string };
  /** The replica's state as of its last change of phase, sync or read-only (its counts are not followed: `handle.state()` has them). */
  document: DocumentState | null;
  /** Edits have waited past the delay for the host's acknowledgement. */
  saving: boolean;
  unresolved: number;
  suggestions: boolean | null;
  rail: DocumentRail;
  saveVersionRequest: number;
  /** The document has waited past the bound for its first tab, which the host writes (shown in place of "Loading…"). */
  noContent: boolean;
  previewing: boolean;
  /** P3-F (F7): what the editor shows, the version previewed or two compared (null: the live document); Export exports it. */
  shown: DocumentShown;
  exporting: ExportStatus | null;
}


const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
let commentHosts = 0; // P4-B3 M6

export class DocumentTabState {
  readonly artifactId: string;
  readonly history: HistoryApi;
  readonly mentions: MentionSource;
  readonly host: ArtifactHost; // the editor's assets and the identity it writes as
  private current: DocumentTabSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly stops: Array<() => void> = [];
  private rowRead = false;
  private viewedBefore: number | null = null;
  private viewedSeqBefore: number | null = null;
  private holders = 0; // what still writes into the replica (`hold`)
  private readonly undo = new Map<YType, UndoManager>(); // P4-B3 M5: by tab body
  /** P4-B3 M6: the comment card host's id, the same for every body over this state, so a move keeps its draft. */
  readonly commentHostId = `document:tab-${++commentHosts}`;
  private disposed = false;
  private handleClosed = false;
  private closing = false; // disposed, waiting for the host to acknowledge what the replica holds
  private rowTimer: ReturnType<typeof setTimeout> | null = null;
  private wasShown = false;
  private readonly whenShown: Promise<void>;
  private resolveShown: () => void = () => {};

  constructor(
    target: ArtifactEditorTarget,
    private readonly deps: DocumentTabDeps,
  ) {
    this.artifactId = target.artifactId;
    this.host = deps.host;
    this.current = { ready: false, failed: null, handle: null, title: '', placement: {}, document: null, saving: false, unresolved: 0, suggestions: null, rail: null, saveVersionRequest: 0, noContent: false, previewing: false, shown: null, exporting: null };
    this.whenShown = new Promise((resolve) => (this.resolveShown = resolve));
    this.history = createHistoryApi({
      artifactId: this.artifactId,
      ipc: deps.ipc,
      host: deps.host,
      viewedAt: { get: () => this.viewedBefore, set: (at) => (this.viewedBefore = at) },
      viewedSeq: { get: () => this.viewedSeqBefore, set: (seq) => (this.viewedSeqBefore = seq) },
      whenShown: () => this.whenShown,
      sessionTitle: deps.sessionTitle,
      log: deps.log,
      ...(deps.extraChanges && { extraChanges: deps.extraChanges }), // P3-E
    });
    this.mentions = documentMentions({
      artifactId: this.artifactId,
      ipc: deps.ipc,
      sessions: deps.sessions,
      owner: () => ({ ref: actorKey(deps.host.identity().actor), name: deps.host.identity().name }),
      log: deps.log,
    });
    this.stops.push(
      deps.ipc.on('artifacts.changed', (change) => {
        if (change.artifactId !== this.artifactId || this.rowTimer !== null) return;
        this.rowTimer = setTimeout(() => {
          this.rowTimer = null;
          void this.readRow();
        }, ROW_QUIET_MS);
      }),
    );
    void this.open();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): DocumentTabSnapshot => this.current;

  private set(patch: Partial<DocumentTabSnapshot>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  // What the header reads of the replica's state: its phase, sync and read-only, published as they change, and edits left
  // waiting for the host past the delay (an edit acknowledged sooner publishes nothing).
  private savingTimer: ReturnType<typeof setTimeout> | null = null;
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

  private async open(): Promise<void> {
    const [opened] = await Promise.allSettled([this.deps.host.open(this.artifactId), this.readRow()]);
    if (opened.status === 'rejected') {
      if (!this.disposed) this.set({ failed: messageOf(opened.reason) });
      return;
    }
    const handle = opened.value;
    if (this.disposed) return void handle.close();
    const comments = documentCommentCounts(handle.doc);
    this.stops.push(
      handle.subscribe((document) => this.follow(handle, document)),
      () => this.stopSavingTimer(),
      comments.subscribe(() => {
        const unresolved = comments.getSnapshot().total;
        if (unresolved !== this.current.unresolved) this.set({ unresolved });
      }),
      handle.onRestored(() => this.undo.forEach((manager) => manager.clear())), // P4-B3 M5
      this.awaitFirstTab(handle),
    );
    this.set({ handle, document: handle.state(), unresolved: comments.getSnapshot().total, ready: true });
  }

  // A document's first tab is the host's, written with the creation (A's seed hook); only a document made before that
  // hook (development data, no migration) has none. Past the bound the tab says so rather than loading forever, and a
  // tab arriving clears it.
  private awaitFirstTab(handle: DocumentHandle): () => void {
    if (listTabs(handle.doc).length > 0) return () => {};
    const timer = setTimeout(() => {
      if (listTabs(handle.doc).length === 0) this.set({ noContent: true });
    }, this.deps.noContentMs ?? NO_CONTENT_MS);
    const off = onUpdate(handle.doc, () => {
      if (listTabs(handle.doc).length === 0) return;
      clearTimeout(timer);
      off();
      if (this.current.noContent) this.set({ noContent: false });
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }

  // The artifact's row: the title and the suggestions setting follow it; the last view is the first read's (the view
  // before this showing), later replaced only by the rail's own view.
  private async readRow(): Promise<void> {
    try {
      const result = await this.deps.ipc.invoke('artifacts.get', { artifactId: this.artifactId });
      if (!result.ok) throw new Error(result.error.message);
      this.adopt(result.value.artifact);
    } catch (error) {
      this.deps.log(`document ${this.artifactId}: its row could not be read: ${messageOf(error)}`);
    }
  }

  private adopt(row: ArtifactRow | null): void {
    if (!this.rowRead) {
      this.viewedBefore = row?.lastViewedAt ?? null;
      this.viewedSeqBefore = row?.lastViewedSeq ?? null;
    }
    this.rowRead = true;
    if (this.disposed || !row) return;
    const placement = { ...(row.designSystemId ? { designSystemId: row.designSystemId } : {}), ...(row.spaceId ? { spaceId: row.spaceId } : {}) };
    this.set({ title: row.title, placement, suggestions: row.agentEditsAsSuggestions ?? false });
  }

  // ── what the header and the body ask ──

  /** Whether this showing's content was on screen yet (the owner's view, recorded once). */
  shown = (): boolean => this.wasShown;
  /** The content is on screen: true the first time (the surface records the view then), false after. */
  markShown = (): boolean => {
    if (this.wasShown) return false;
    this.wasShown = true;
    this.resolveShown();
    return true;
  };

  setRail(rail: DocumentRail): void {
    if (rail !== this.current.rail) this.set({ rail });
  }
  toggleRail(rail: Exclude<DocumentRail, null>): void {
    this.setRail(this.current.rail === rail ? null : rail);
  }
  requestSaveVersion(): void {
    this.set({ saveVersionRequest: this.current.saveVersionRequest + 1 });
  }
  setPreviewing(previewing: boolean, shown: DocumentShown = null): void {
    const key = (of: DocumentShown) => (of === null || of === 'compare' ? of : of.versionId); // P3-F (F7)
    if (previewing !== this.current.previewing || key(shown) !== key(this.current.shown)) this.set({ previewing, shown });
  }

  async setSuggestions(on: boolean): Promise<void> {
    try {
      const result = await this.deps.ipc.invoke('artifacts.update', { artifactId: this.artifactId, agentEditsAsSuggestions: on });
      if (!result.ok) throw new Error(result.error.message);
      this.adopt(result.value.artifact);
    } catch (error) {
      this.deps.log(`document ${this.artifactId}: Agent edits as suggestions could not be set: ${messageOf(error)}`);
    }
  }

  /** The document as shown, or WR 66's explicit history-card version, saved where the owner chooses. */
  async export(format: DocumentExportFormat, pageSize: PageSize, versionId?: number): Promise<void> {
    const shown = versionId === undefined ? this.current.shown : { versionId };
    if (this.current.exporting?.phase === 'running' || shown === 'compare') return; // two versions compared: nothing is exported
    this.set({ exporting: { phase: 'running', format } });
    try {
      // P4 (W1, L302): a file of its own, saved by its id, so Letter and A4 or the agent's export of the same revision and
      // format between the two never swaps the file saved
      const exported = await this.deps.ipc.invoke('artifacts.export', { artifactId: this.artifactId, format, ...(shown && { versionId: shown.versionId }), pageSize, ownFile: true });
      if (!exported.ok) throw new Error(exported.error.message);
      const { revision, exportId } = exported.value;
      const saved = await this.deps.ipc.invoke('library.saveAs', { artifactId: this.artifactId, source: { export: { revision, format, ...(exportId !== undefined && { exportId }) } } });
      if (!saved.ok) throw new Error(saved.error.message);
      if (saved.value.saved) void toast({ level: 'info', text: VIEWERS_COPY.saved(saved.value.path, exported.value.commentAuthorName), actions: [], dismissible: true });
      if (!this.disposed) this.set({ exporting: null });
    } catch (error) {
      this.deps.log(`document ${this.artifactId}: the ${format} export failed: ${messageOf(error)}`);
      if (!this.disposed) this.set({ exporting: { phase: 'failed', format, message: messageOf(error) } });
    }
  }
  dismissExport(): void {
    if (this.current.exporting?.phase !== 'running') this.set({ exporting: null });
  }

  /**
   * X32's close guard: closing loses nothing once the host has every edit; edits in flight are waited for, then asked about.
   * P4-B1 (C8; X36's draft rule): an unsent comment typed in the document's compose card is asked about first.
   * P4-B3 (its Decision Log 39): only this tab's card's: a comment on another view's card host is not this close's to
   * lose, nor this tab's own when a move closes it (`moving`), since its card goes to the view the move keeps.
   */
  closeGuard = async (ask?: CloseAsk): Promise<boolean> => {
    const draft = ask?.moving ? null : commentDraftEntry(this.artifactId); // P4-B3
    if (draft?.hostId === this.commentHostId && draft.text.trim() && !this.deps.confirm('Discard your unsent comment?')) return false; // P4-B1
    const handle = this.current.handle;
    if (!handle || handle.state().readOnly || handle.state().unsaved === 0) return true;
    const saved = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(false);
      }, SAVE_WAIT_MS);
      const off = handle.subscribe((state) => {
        if (state.unsaved > 0) return;
        clearTimeout(timer);
        off();
        resolve(true);
      });
    });
    return saved || this.deps.confirm(`“${this.current.title || 'This document'}” has changes that are not saved yet. Close it anyway?`);
  };

  /**
   * P4-B3 M5: the undo history of one of the document's tab bodies, made at its first editor and kept until the tab is
   * disposed (null once it is: nothing is kept for a body still unmounting). Like the binding's own, it tracks only this
   * replica's editors (the undo plugin adds each editor's sync plugin as it binds).
   */
  undoManagerFor(body: YType): UndoManager | null {
    if (this.disposed) return null;
    let manager = this.undo.get(body);
    if (!manager) {
      manager = new UndoManager(body, { trackedOrigins: new Set() });
      this.undo.set(body, manager);
    }
    return manager;
  }
  /** The undo histories kept, one per tab body shown so far. */
  undoManagers = (): UndoManager[] => [...this.undo.values()];

  /**
   * Something will still write into the replica (the comment overlay while mounted and through its draft's withdrawal,
   * a send in flight): it stays open until the returned release (once), and then until the host acknowledged.
   */
  hold = (): (() => void) => {
    this.holders += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders -= 1;
      if (this.disposed && this.holders === 0) this.closeHandle();
    };
  };

  /**
   * The tab stopped showing the document (L's `dispose`): the replica closes once nothing holds it and the host has
   * acknowledged every edit it holds (a late send's recorded message, a withdrawn draft, the owner's last keystrokes);
   * until then it stays open and reconnects by itself, as an open tab's does.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rowTimer !== null) clearTimeout(this.rowTimer);
    this.rowTimer = null;
    for (const stop of this.stops.splice(0)) stop();
    this.listeners.clear();
    for (const manager of this.undo.values()) manager.destroy(); // P4-B3 M5
    this.undo.clear();
    if (this.holders === 0) this.closeHandle();
  }

  private closeHandle(): void {
    if (this.handleClosed || this.closing) return;
    const handle = this.current.handle;
    if (!handle) return; // still opening: `open` closes it when it comes
    const close = () => {
      this.handleClosed = true;
      handle.close();
    };
    if (handle.state().unsaved === 0 || handle.state().readOnly) return close();
    this.closing = true;
    const off = handle.subscribe((state) => {
      if (state.unsaved > 0 && !state.readOnly) return;
      off();
      close();
    });
  }
}
