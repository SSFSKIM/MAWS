// The state a document tab owns (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13): what L's registry
// makes with `createState` when a surface starts showing a document and ends with `dispose` when it stops, so the X32
// header's actions and close guard read the tab, never a body that may have unmounted (X32's lifetime rule). It opens
// and keeps the replica (`ArtifactHost.open`), follows its saved state and its open threads, reads the artifact's row
// (the title, the suggestions setting, and the owner's last view as it stood before this showing, which the history
// rail's "See N new changes" compares against: the surface records this view once the editor is on screen), holds
// the rail the header toggles, an export's progress, and the comment sends in flight: the replica stays open until
// they settle, since a send that lands records its message in the document's thread (Decision Log 27).
//
// A replica never initialises its document: the host writes a new document's first tab (kinds/document.ts in the
// engine host; fix wave 1), and the editor shows "Loading…" until that tab has arrived, then binds it.
import { listThreads, observeThreads } from '@artifacts/document/threads';
import type { DocumentRail } from '@artifacts/document/editor/DocumentEditor';
import type { HistoryApi } from '@artifacts/document/editor/history/api';
import type { MentionSource } from '@artifacts/document/editor/MentionPicker';
import { actorKey } from '@shared/artifacts/actor';
import type { PageSize } from '@artifacts/document/export/design-system';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import type { ArtifactRow } from '@shared/ipc/schema/artifacts';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactEditorTarget } from '../../artifacts/registry';
import type { DocumentExportFormat, ExportStatus } from './header';
import { createHistoryApi } from './history-api';
import { documentMentions } from './mentions';

const ROW_QUIET_MS = 500; // a burst of writes reads the row once
const SAVE_WAIT_MS = 3_000; // how long the close guard waits for edits in flight before it asks

export interface DocumentTabDeps {
  host: ArtifactHost;
  ipc: Pick<MawsBridge, 'invoke' | 'on'>;
  log(line: string): void;
  /** Asks the owner a yes-or-no question (the close guard's, when edits would be lost). */
  confirm(message: string): boolean;
  sessionTitle(appSessionId: string): string | undefined;
  /** The sessions a mention can name, most recent first, by their shown titles. */
  sessions(): Array<{ appSessionId: string; title: string }>;
}

export interface DocumentTabSnapshot {
  /** The replica is open and the row was read (or could not be): the editor can show. */
  ready: boolean;
  failed: string | null; // the document cannot be opened (gone, not a document)
  handle: DocumentHandle | null;
  title: string;
  /** Where the artifact sits, as the governing design system is chosen by it (its own system, its Space's). */
  placement: { designSystemId?: string; spaceId?: string };
  document: DocumentState | null;
  unresolved: number;
  suggestions: boolean | null;
  rail: DocumentRail;
  saveVersionRequest: number;
  previewing: boolean;
  exporting: ExportStatus | null;
}

// `ArtifactHost.export` with the page size (Letter or A4, the owner's Decision Log 43), which A's service is asked to
// take with the request; until it does, the argument is not read.
type ExportWithPage = (artifactId: string, format: string, version: number | undefined, options: { pageSize: PageSize }) => Promise<{ path: string }>;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
  private sending = 0;
  private disposed = false;
  private handleClosed = false;
  private closing = false; // disposed, waiting for the host to acknowledge what the replica holds
  private rowTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    target: ArtifactEditorTarget,
    private readonly deps: DocumentTabDeps,
  ) {
    this.artifactId = target.artifactId;
    this.host = deps.host;
    this.current = { ready: false, failed: null, handle: null, title: '', placement: {}, document: null, unresolved: 0, suggestions: null, rail: null, saveVersionRequest: 0, previewing: false, exporting: null };
    this.history = createHistoryApi({
      artifactId: this.artifactId,
      ipc: deps.ipc,
      host: deps.host,
      viewedAt: { get: () => this.viewedBefore, set: (at) => (this.viewedBefore = at) },
      sessionTitle: deps.sessionTitle,
      log: deps.log,
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

  private async open(): Promise<void> {
    const [opened] = await Promise.allSettled([this.deps.host.open(this.artifactId), this.readRow()]);
    if (opened.status === 'rejected') {
      if (!this.disposed) this.set({ failed: messageOf(opened.reason) });
      return;
    }
    const handle = opened.value;
    if (this.disposed) return void handle.close();
    const openThreads = () => listThreads(handle.doc).filter((thread) => thread.status === 'open').length;
    this.stops.push(
      handle.subscribe((document) => this.set({ document })),
      observeThreads(handle.doc, () => this.set({ unresolved: openThreads() })),
    );
    this.set({ handle, document: handle.state(), unresolved: openThreads(), ready: true });
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
    if (!this.rowRead) this.viewedBefore = row?.lastViewedAt ?? null;
    this.rowRead = true;
    if (this.disposed || !row) return;
    const placement = { ...(row.designSystemId ? { designSystemId: row.designSystemId } : {}), ...(row.spaceId ? { spaceId: row.spaceId } : {}) };
    this.set({ title: row.title, placement, suggestions: row.agentEditsAsSuggestions ?? false });
  }

  // ── what the header and the body ask ──

  setRail(rail: DocumentRail): void {
    if (rail !== this.current.rail) this.set({ rail });
  }
  toggleRail(rail: Exclude<DocumentRail, null>): void {
    this.setRail(this.current.rail === rail ? null : rail);
  }
  requestSaveVersion(): void {
    this.set({ saveVersionRequest: this.current.saveVersionRequest + 1 });
  }
  setPreviewing(previewing: boolean): void {
    if (previewing !== this.current.previewing) this.set({ previewing });
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

  async export(format: DocumentExportFormat, pageSize: PageSize): Promise<void> {
    if (this.current.exporting?.phase === 'running') return;
    this.set({ exporting: { phase: 'running', format } });
    try {
      const { path } = await (this.deps.host.export as ExportWithPage)(this.artifactId, format, undefined, { pageSize });
      if (!this.disposed) this.set({ exporting: { phase: 'done', format, path } });
    } catch (error) {
      this.deps.log(`document ${this.artifactId}: the ${format} export failed: ${messageOf(error)}`);
      if (!this.disposed) this.set({ exporting: { phase: 'failed', format, message: messageOf(error) } });
    }
  }
  dismissExport(): void {
    if (this.current.exporting?.phase !== 'running') this.set({ exporting: null });
  }

  /** X32's close guard: closing loses nothing once the host has every edit; edits in flight are waited for, then asked about. */
  closeGuard = async (): Promise<boolean> => {
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

  /** A comment's send set out: the replica stays open until the returned release (once) says it settled. */
  holdForSend = (): (() => void) => {
    this.sending += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.sending -= 1;
      if (this.disposed && this.sending === 0) this.closeHandle();
    };
  };

  /**
   * The tab stopped showing the document (L's `dispose`): the replica closes once no send needs it and the host has
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
    if (this.sending === 0) this.closeHandle();
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
