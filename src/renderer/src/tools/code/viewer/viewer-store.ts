// The viewer's per-tab state, kept outside React (C8c execution document, Repository map `viewer/viewer-store.ts`;
// M2's decisions): C5 mounts only a pane's active tab, so a file tab's content, its load and its view state outlive the
// component. One entry per file tab, bounded to VIEWER_ENTRIES_MAX by last use and pruned when the layout store no
// longer holds the tab. Each entry holds a watch on its file's directory for its life (through the Files store's
// counts) and re-reads on `files.changed` for its file, keeping the scroll.
//
// Reads (Interfaces *Viewer kinds and caps*): the first `files.read` decides the kind; a text within CODE_CAP past the
// first chunk is completed by continuation reads before it is presented as complete (painted at once, appended per
// chunk; the concatenation is exact because every chunk of a file answers one encoding and no utf8 chunk ends inside a
// character or a CRLF); an image past the first chunk is re-read in one call; a head keeps its first chunk and grows
// by `loadMore` up to CODE_CAP. A refusal at any read drops what was loaded for the refusal (a swap under a half-loaded
// file shows nothing of either), and nothing retries it.
//
// No CodeMirror here: this module is in the main chunk. The editor state a CodeView leaves behind is kept opaque in
// `viewState(tabId)`, beside the scroll offsets, where rendering never reads it.
//
// E5 (E5 execution document, Interfaces *The entry's editing fields* and *The editing state machine*): a complete code
// text read with its hash, whose bytes main found valid UTF-8, is editable. The entry holds the baseline (`text` with
// `hash`, what the tab believes is on disk); the document itself is the code view's, read through
// `viewState(tabId).docOf`. Every read of a load asks for the file's hash, and a load's answer is committed by the state
// the entry is in when it completes: while clean it replaces the text as before (unless its hash is the baseline's: an
// own save, a spurious event), while dirty it becomes `theirs` and the document stands. A save writes the document
// captured at invocation through `files.write` with the baseline's hash (the merge view's `theirs.hash` once the owner
// has seen theirs). A save's answer, and the conflict read it may start, land only on the entry incarnation that issued
// them.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { FILES_READ_DEFAULT_LENGTH, FILES_READ_MAX_LENGTH, type FilesChanged, type FilesReadOutput } from '@shared/ipc/schema/files';
import { ipc } from '../../../ipc/client';
import { useLayout } from '../../../stores/layout';
import { allTabs } from '../../../stores/layout-model';
import { useFiles, type WatchHold } from '../files/store';
import { dirname, sameFile } from '../files/tree';
import { EDITOR_COPY } from '../copy';
import { CODE_CAP, kindOf, type ViewerKind } from './kinds';

export const VIEWER_ENTRIES_MAX = 20;

export interface ViewerEntry {
  tabId: string;
  appSessionId: AppSessionId;
  path: string;
  status: 'loading' | 'ready' | 'error';
  error: string | null; // the read's refusal, word for word
  kind: ViewerKind | null;
  mime: string;
  encoding: FilesReadOutput['encoding'];
  bytes: number; // the file's size
  loaded: number; // how many of its bytes `text` (or the image) covers
  complete: boolean; // the whole file is loaded (a head never is)
  text: string; // utf8 content: code, markdown, a head, an svg
  epoch: number; // bumped when `text` is replaced rather than extended
  base64: string | null; // a binary image's content
  removed: boolean; // a re-read found the file gone; `text` is the last content
  updated: number; // bumped by each follow-the-file re-read (the fading notice)
  sourceView: boolean; // markdown or svg shown as its source
  line: number | null; // the tab's line as last seen
  pendingJump: number | null; // a line the code view has yet to land on
  loadingMore: boolean;
  // E5 start: the editing fields
  hash: string | null; // the baseline's hash: the last hashed read's, or the last save's; null until one answers
  editable: boolean; // derived at each load: a complete, losslessly decoded utf8 code (or markdown) text with a hash
  dirty: boolean; // the editor's document differs from `text`
  saving: boolean;
  saveError: string | null; // the last save's failure, word for word; cleared by the next edit or save
  theirs: Theirs | null; // the disk's content past the baseline while dirty
  diskUnusable: DiskUnusable | null; // E11 W-D: the disk moved past the baseline to a file the editor cannot take, and why
  baseline: number; // bumped when `text` and `hash` move while the document stands (a save, Keep mine)
  loads: number; // loads of this entry completed, whether or not they landed anything (a superseded one when its read answers)
  pending: number; // loads of this entry in flight; the e2e's own-save barrier is a `loads` increase with `pending` at 0
  // E5 end
  readOnly: boolean; // E2: mounted read-only (the deliverables viewer, Decision Log 7): never editable, whatever the file
}

// E5: what the disk holds past the baseline, shown as the notice (Changed on disk) or, once compared or a save found
// it, as the merge view.
export interface Theirs {
  text: string;
  hash: string;
  view: 'notice' | 'merge';
}

export type SaveResult = 'ok' | 'conflict' | 'error' | 'noop';

// E11 W-D: why the disk's version under unsaved edits cannot become theirs: past the editor's cap (a head), not text
// (an image, an external kind, a binary encoding), or not UTF-8 (a lossy decode).
export type DiskUnusable = 'head' | 'binary' | 'encoding';
const unusableReason = (read: Pick<LoadedFile, 'kind' | 'encoding'>): DiskUnusable =>
  read.kind === 'head' ? 'head' : (read.kind !== 'code' && read.kind !== 'markdown') || read.encoding !== 'utf8' ? 'binary' : 'encoding';

// What a view leaves behind when it unmounts; never rendered, so never reactive.
export interface ViewState {
  editor: unknown; // CodeMirror's EditorState, opaque here
  editorAt: { epoch: number; baseline: number; length: number } | null; // the text it holds (E5: and the baseline it compares against)
  codeScroll: number;
  renderedScroll: number;
  ratio: number | null; // the last view's scroll ratio, for the Source toggle
  ratioPending: boolean; // the next view to mount takes `ratio` rather than its own offset
  // E5 start
  docOf: (() => string) | null; // the document as the file's text (the baseline's line breaks); the view's, live or left behind
  clean: unknown; // the view's own: CodeMirror's Text equal to the entry's `text`, never written here
  // E5 end
}

export interface ViewerStore {
  entries: Map<string, ViewerEntry>;
  wrap: boolean; // the Wrap toggle, one for every code view
  mount(tabId: string, target: { appSessionId: AppSessionId; path: string; line: number | null; readOnly?: boolean }): () => void;
  loadMore(tabId: string): void;
  toggleSource(tabId: string): void;
  setWrap(wrap: boolean): void;
  jumped(tabId: string): void; // the code view landed (or gave up on) the pending line
  applyChanged(event: FilesChanged): void;
  reset(): void; // tests: forget every entry, release every hold
  // E5 start
  save(tabId: string): Promise<SaveResult>;
  reload(tabId: string): void; // take theirs
  keepMine(tabId: string): void; // adopt theirs as the baseline, the document standing
  compare(tabId: string): void; // the notice becomes the merge view
  setDirty(tabId: string, dirty: boolean): void; // the code view's report
  setSaveError(tabId: string, message: string | null): void;
  saveAll(): Promise<UnsavedFailure[]>; // M5: every dirty tab saved at once; the ones not clean afterwards
  // E5 end
}

// E5 (M5): a tab the quit question's Save all left unsaved, with what its bar says about it.
export interface UnsavedFailure {
  path: string;
  message: string;
}

const views = new Map<string, ViewState>();
export const existingViewState = (tabId: string): ViewState | undefined => views.get(tabId);

export function viewState(tabId: string): ViewState {
  let view = views.get(tabId);
  if (!view) views.set(tabId, (view = { editor: null, editorAt: null, codeScroll: 0, renderedScroll: 0, ratio: null, ratioPending: false, docOf: null, clean: null }));
  return view;
}

// E5: the UTF-8 length of a decoded text, without encoding it; a lone surrogate counts as U+FFFD's three bytes.
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

// E5: the line break a document is written back with: the text's dominant one, CRLF when more than half its breaks are
// (VS Code's rule). CodeMirror splits a document at every break and joins it with this, so a CRLF file stays CRLF and a
// file of mixed breaks is written with its dominant one once edited.
export function lineBreakOf(text: string): '\n' | '\r\n' {
  let breaks = 0;
  let crlf = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    breaks += 1;
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf += 1;
  }
  return crlf * 2 > breaks ? '\r\n' : '\n';
}

// E5: whether a loaded text is the file's bytes exactly, so writing it back changes nothing the owner did not change: a
// complete utf8 code (or markdown) text, read with its hash, whose hashed bytes main's strict decode found valid UTF-8
// (`utf8`). Not a length comparison: a truncated multi-byte sequence decodes to U+FFFD, which may be just as long, and
// would be written back as `ef bf bd`. Markdown is edited only in its Source view, the one that shows an editor.
export const isEditable = (file: Pick<ViewerEntry, 'kind' | 'complete' | 'encoding' | 'hash'> & { utf8: boolean | null }): boolean =>
  (file.kind === 'code' || file.kind === 'markdown') && file.complete && file.encoding === 'utf8' && file.hash !== null && file.utf8 === true;

// E5: why a code view is read-only, shown as its content's title; null when it is editable or no reason is the owner's
// to know (an svg's source).
export function readOnlyReason(entry: ViewerEntry): 'head' | 'encoding' | 'loading' | null {
  if (entry.editable) return null;
  if (entry.kind === 'head') return 'head';
  if (entry.readOnly) return null; // E2: a read-only mount is read-only by design, not for a reason of the file's
  if (entry.kind !== 'code' && entry.kind !== 'markdown') return null;
  if (entry.complete && entry.hash !== null && entry.encoding === 'utf8') return 'encoding';
  return 'loading';
}

async function settled<N extends 'files.read' | 'files.write'>(call: Promise<CommandResult<N>>): Promise<CommandResult<N>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
  }
}

const isNotFound = (message: string) => message.startsWith('not found:');

// What a load read, committed whole at its end (a `change` load) or patched as it goes (an `open` load). `utf8` (E5) is
// the read's answer about the hashed bytes, which decides `editable` and is not kept on the entry.
type LoadedFile = Pick<ViewerEntry, 'kind' | 'mime' | 'encoding' | 'bytes' | 'text' | 'base64' | 'loaded' | 'complete' | 'hash'> & { utf8: boolean | null };

export function createViewerStore(client: MawsBridge) {
  const holds = new Map<string, WatchHold>();
  // The latest load of each tab, from one counter that only grows (never reset, not even by `reset`), so a load of a
  // removed entry can never match the entry that replaced it.
  const generations = new Map<string, number>();
  let lastGeneration = 0;
  // E5: each tab's entry incarnation, numbered when the store creates or replaces the entry, from a counter that only
  // grows: a save's answer (and its conflict read's) lands only on the incarnation that issued the save.
  const incarnations = new Map<string, number>();
  let lastIncarnation = 0;
  const mounted = new Map<string, number>();
  const stale = new Set<string>();
  const used = new Map<string, number>();
  let clock = 0;
  let unsubscribe: (() => void) | null = null;

  return create<ViewerStore>()((set, get) => {
    const patch = (tabId: string, next: Partial<ViewerEntry>) =>
      set((s) => {
        const entry = s.entries.get(tabId);
        return entry ? { entries: new Map(s.entries).set(tabId, { ...entry, ...next }) } : s;
      });

    // A newer generation: every read in flight for the tab lands nowhere.
    const supersede = (tabId: string) => generations.set(tabId, ++lastGeneration);

    const remove = (tabId: string) => {
      holds.get(tabId)?.release();
      holds.delete(tabId);
      generations.delete(tabId);
      incarnations.delete(tabId);
      stale.delete(tabId);
      used.delete(tabId);
      mounted.delete(tabId);
      views.delete(tabId);
      set((s) => {
        const entries = new Map(s.entries);
        entries.delete(tabId);
        return { entries };
      });
    };

    // Entries of tabs the layout no longer holds go; past the bound, the least recently used unmounted ones go. E5: the
    // bound passes over an entry with unsaved edits or a save in flight; a closed tab's goes (its close guard asked). A
    // file tab leaves the layout only by a guarded close: a session's removal and hydration keep file tabs (E11 W-D).
    const prune = () => {
      const open = new Set(allTabs(useLayout.getState().main).map((tab) => tab.id)); // W12: every project's tab set
      for (const tabId of get().entries.keys()) if (!open.has(tabId) && !mounted.get(tabId)) remove(tabId);
      for (const tabId of views.keys()) if (!get().entries.has(tabId)) views.delete(tabId);
      const idle = [...get().entries.values()]
        .filter((entry) => !mounted.get(entry.tabId) && !entry.dirty && !entry.saving)
        .map((entry) => entry.tabId)
        .sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0));
      while (get().entries.size > VIEWER_ENTRIES_MAX && idle.length > 0) remove(idle.shift()!);
    };

    // E5: an entry with unsaved edits, or with the disk's newer version still on offer.
    const unsaved = (entry: ViewerEntry | undefined) => entry !== undefined && (entry.dirty || entry.theirs !== null);

    const fail = (tabId: string, message: string, reason: 'open' | 'change') => {
      const entry = get().entries.get(tabId);
      if (reason === 'change' && isNotFound(message) && entry?.status === 'ready') return patch(tabId, { removed: true, loadingMore: false });
      // E5: unsaved edits keep their baseline and their document (the view's) under a refusal, which shows over them; a
      // later read lands as any change load does.
      if (unsaved(entry)) return patch(tabId, { status: 'error', error: message, loadingMore: false });
      patch(tabId, {
        status: 'error', error: message, kind: null, text: '', base64: null, loaded: 0, complete: false, epoch: (entry?.epoch ?? 0) + 1, loadingMore: false, hash: null, editable: false,
      });
    };

    // E5: a `change` load is judged by the entry as it is when the load completes (the editing state machine's
    // commit-time rule). Clean: the text is replaced as before, unless the read is the baseline itself (an own save, a
    // spurious event), which lands nothing. Unsaved edits: the document stands, and a read that is neither the baseline
    // nor the theirs already shown becomes theirs, when it is a text the editor could take.
    const commitChange = (tabId: string, read: LoadedFile) => {
      const entry = get().entries.get(tabId);
      if (!entry) return;
      const ready = { status: 'ready' as const, error: null, removed: false, loadingMore: false, diskUnusable: null };
      const settledAlready = entry.status === 'ready' && !entry.removed && !entry.loadingMore && entry.diskUnusable === null;
      if (unsaved(entry)) {
        // E11 W-D: a disk version the editor cannot take is not offered, and the bar says why
        if (!isEditable(read)) return patch(tabId, { ...ready, diskUnusable: unusableReason(read) });
        const differs = read.hash !== null && read.hash !== entry.hash && read.hash !== entry.theirs?.hash;
        if (differs) return patch(tabId, { ...ready, theirs: { text: read.text, hash: read.hash!, view: entry.theirs?.view ?? 'notice' } });
        if (!settledAlready) patch(tabId, ready);
        return;
      }
      if (read.hash !== null && read.hash === entry.hash) {
        if (!settledAlready) patch(tabId, ready);
        return;
      }
      const { utf8, ...file } = read;
      patch(tabId, { ...ready, ...file, editable: !entry.readOnly && isEditable({ ...file, utf8 }), epoch: entry.epoch + 1, updated: entry.updated + 1 });
    };

    // One load per tab at a time: a newer one (or the entry's removal) makes an older one's answers land nowhere. A
    // follow-the-file re-read (`change`) keeps the shown content until the new one is complete, then commits it whole.
    // Whatever a load patches ends a Load more it superseded (`loadingMore` false), whose answer then lands nowhere.
    // E5: every read of a text the editor could take asks for the file's hash; a continuation answering another hash
    // than the first chunk's means the file changed mid-load, and the load ends there (an open load shows what it has,
    // read-only; a change load lands nothing): the change's own `files.changed` re-reads it.
    const loadOnce = async (tabId: string, reason: 'open' | 'change') => {
      const entry = get().entries.get(tabId);
      if (!entry) return;
      const generation = ++lastGeneration;
      generations.set(tabId, generation);
      const live = () => generations.get(tabId) === generation;
      // A re-read of a head covers what Load more had reached, not only the first chunk.
      const extent = reason === 'change' && entry.kind === 'head' ? Math.min(CODE_CAP, entry.loaded) : 0;
      const { appSessionId, path } = entry;
      const read = (offset: number, length: number, hash: boolean) =>
        settled(client.invoke('files.read', { appSessionId, path, offset, length, ...(hash ? { hash: true } : {}) }));

      // The hash is asked for only where it can be used: the kind still undecided (an open load, an entry with none) or
      // one the editor takes. A change load of a head, an image or an external kind asks none (each would cost main a
      // whole-file read and a SHA-256 per change), and asks again, once, should the file have become editable text.
      const editableKind = (candidate: ViewerKind | null) => candidate === null || candidate === 'code' || candidate === 'markdown';
      const hashed = reason === 'open' || editableKind(entry.kind);
      let first = await read(0, FILES_READ_DEFAULT_LENGTH, hashed);
      if (!live()) return;
      if (!first.ok) return fail(tabId, first.error.message, reason);
      if (!hashed && editableKind(kindOf({ name: path, mime: first.value.mime, bytes: first.value.bytes, encoding: first.value.encoding }))) {
        first = await read(0, FILES_READ_DEFAULT_LENGTH, true);
        if (!live()) return;
        if (!first.ok) return fail(tabId, first.error.message, reason);
      }
      const head = first.value;
      const kind = kindOf({ name: path, mime: head.mime, bytes: head.bytes, encoding: head.encoding });
      const file = { kind, mime: head.mime, encoding: head.encoding, bytes: head.bytes };
      const opened = { status: 'ready' as const, error: null, removed: false, loadingMore: false, epoch: (get().entries.get(tabId)?.epoch ?? 0) + 1, dirty: false, theirs: null, diskUnusable: null, saveError: null };
      const commit = ({ utf8, ...loaded }: LoadedFile) =>
        reason === 'change' ? commitChange(tabId, { ...loaded, utf8 }) : patch(tabId, { ...opened, ...loaded, editable: !entry.readOnly && isEditable({ ...loaded, utf8 }) });
      // A markdown file opened at a line is shown as its source, where the line exists.
      const sourceView = kind === 'markdown' && get().entries.get(tabId)?.pendingJump != null ? true : undefined;

      if (kind === 'external') return commit({ ...file, text: '', base64: null, loaded: 0, complete: true, hash: null, utf8: null });
      if (kind === 'image') {
        let whole = head;
        if (head.truncated) {
          const all = await read(0, head.bytes, false);
          if (!live()) return;
          if (!all.ok) return fail(tabId, all.error.message, reason);
          whole = all.value;
        }
        const utf8 = whole.encoding === 'utf8';
        return commit({ ...file, text: utf8 ? whole.content : '', base64: utf8 ? null : whole.content, loaded: whole.length, complete: true, hash: null, utf8: null });
      }

      const hash = kind === 'head' ? null : head.hash;
      const utf8 = hash === null ? null : head.utf8; // the whole hashed file's, so every chunk of one hash answers the same
      let text = head.content;
      let loaded = head.offset + head.length;
      const wanted = () => kind !== 'head' || loaded < extent;
      let more = head.truncated && wanted();
      if (reason === 'open') patch(tabId, { ...opened, ...file, text, base64: null, loaded, complete: !head.truncated, hash: null, editable: false, ...(sourceView ? { sourceView } : {}) });
      while (more && loaded < CODE_CAP) {
        const next = await read(loaded, kind === 'head' ? Math.min(FILES_READ_DEFAULT_LENGTH, extent - loaded) : FILES_READ_DEFAULT_LENGTH, hash !== null);
        if (!live()) return;
        // Mid-file: nothing of either version stays, except that a file gone during a re-read keeps its last content.
        if (!next.ok) return fail(tabId, next.error.message, reason);
        // Changed mid-load, whatever the chunk's length (a shrunk file answers zero bytes with its new hash): the load ends
        // here, an open one read-only with `hash: null`; its files.changed re-reads it. Checked before the shrink exit,
        // which would otherwise commit the old file's partial text with its whole-file hash, as editable.
        if (hash !== null && next.value.hash !== hash) return;
        if (next.value.length === 0) break; // the file shrank under an unhashed read (a head)
        text += next.value.content;
        loaded = next.value.offset + next.value.length;
        more = next.value.truncated && wanted();
        if (reason === 'open') patch(tabId, { text, loaded, complete: !more });
      }
      commit({ ...file, text, base64: null, loaded, complete: kind !== 'head', hash, utf8 });
    };

    // E5: a load is `pending` from its issue and counted in `loads` once it is over, however it ended (it replaced the
    // text, landed nothing, landed in theirs, failed, or was superseded and its answer landed nowhere), both on the entry
    // incarnation it was issued for. An e2e waiting out an own save's re-reads needs both: one write can raise two
    // events and so two overlapping loads, and the older one's completion moves `loads` while the newer is in flight
    // (the router answers reads independently, so no later read is a barrier for an earlier one).
    const load = async (tabId: string, reason: 'open' | 'change') => {
      const incarnation = incarnations.get(tabId);
      const issued = get().entries.get(tabId);
      if (!issued) return;
      patch(tabId, { pending: issued.pending + 1 });
      await loadOnce(tabId, reason);
      const entry = get().entries.get(tabId);
      if (entry && incarnations.get(tabId) === incarnation) patch(tabId, { loads: entry.loads + 1, pending: entry.pending - 1 });
    };

    const refresh = (tabId: string) => {
      if (mounted.get(tabId)) void load(tabId, 'change');
      else stale.add(tabId); // read when next shown
    };

    // E5: the editor's document as the file's text, or undefined when no code view ever showed the tab.
    const documentOf = (tabId: string): string | undefined => views.get(tabId)?.docOf?.();

    // E5: the tab now believes `text` is on disk while its document stands (a save, Keep mine): `baseline` tells the
    // view to keep its document and compare against the new text; `dirty` is settled here too, for a view not mounted.
    const moveBaseline = (tabId: string, next: { text: string; hash: string } & Partial<ViewerEntry>) => {
      const entry = get().entries.get(tabId);
      if (!entry) return;
      const bytes = utf8Length(next.text);
      patch(tabId, { ...next, bytes, loaded: bytes, theirs: null, diskUnusable: null, baseline: entry.baseline + 1 });
      const document = documentOf(tabId);
      if (document !== undefined) patch(tabId, { dirty: document !== next.text });
    };

    // E5: a save's conflict answered with a hash the tab has not seen: the file is read whole (one hashed read within the
    // editor's caps) and shown as theirs in the merge view; a read answering yet another hash is newer and wins. The
    // read lands only on the incarnation that saved (`current`); answers whether it landed.
    const conflicted = async (tabId: string, entry: ViewerEntry, hash: string, current: () => boolean): Promise<boolean> => {
      if (entry.theirs?.hash === hash) {
        patch(tabId, { saving: false, theirs: { ...entry.theirs, view: 'merge' } });
        return true;
      }
      const answer = await settled(client.invoke('files.read', { appSessionId: entry.appSessionId, path: entry.path, offset: 0, length: FILES_READ_MAX_LENGTH, hash: true }));
      if (!current()) return false;
      if (!answer.ok) {
        patch(tabId, { saving: false, saveError: answer.error.message });
        return true;
      }
      const read = answer.value;
      const file: LoadedFile = {
        kind: kindOf({ name: entry.path, mime: read.mime, bytes: read.bytes, encoding: read.encoding }), mime: read.mime, encoding: read.encoding, bytes: read.bytes,
        text: read.content, base64: null, loaded: read.length, complete: !read.truncated, hash: read.hash, utf8: read.utf8,
      };
      // A file that is no longer a text the editor could take (grown past its cap, binary, not UTF-8) is not offered;
      // the bar says why (E11 W-D).
      patch(
        tabId,
        isEditable(file)
          ? { saving: false, theirs: { text: file.text, hash: file.hash!, view: 'merge' }, diskUnusable: null }
          : { saving: false, saveError: EDITOR_COPY.conflictOnSave, diskUnusable: unusableReason(file) },
      );
      return true;
    };

    return {
      entries: new Map(),
      wrap: false,

      mount(tabId, { appSessionId, path, line, readOnly = false }) {
        used.set(tabId, ++clock);
        if (!unsubscribe) unsubscribe = useLayout.subscribe((state, prev) => state.main !== prev.main && prune());
        const entry = get().entries.get(tabId);
        const watchThenRead = (reason: 'open' | 'change') => {
          // The watch first, then the read: a change made while main's watcher restarts is read, not missed (M1 Surprises).
          const hold = useFiles.getState().watch(appSessionId, dirname(path));
          holds.set(tabId, hold);
          void hold.ready.then(() => {
            if (holds.get(tabId) === hold) void load(tabId, reason);
          });
        };
        if (entry && entry.path === path && entry.appSessionId !== appSessionId && (unsaved(entry) || entry.saving)) {
          // E5: unsaved edits survive the tab's move to another session: the old session's hold goes, and the file is
          // watched and re-read under the new one, the read committing as any change load does.
          holds.get(tabId)?.release();
          stale.delete(tabId);
          supersede(tabId);
          patch(tabId, { appSessionId, ...(line !== entry.line ? { line, pendingJump: line } : {}) });
          watchThenRead('change');
        } else if (!entry || entry.appSessionId !== appSessionId || entry.path !== path || entry.readOnly !== readOnly) {
          holds.get(tabId)?.release();
          views.delete(tabId);
          stale.delete(tabId);
          supersede(tabId); // an older load lands nowhere
          const fresh: ViewerEntry = {
            tabId, appSessionId, path, status: 'loading', error: null, kind: null, mime: '', encoding: 'utf8', bytes: 0, loaded: 0, complete: false,
            text: '', epoch: (entry?.epoch ?? 0) + 1, base64: null, removed: false, updated: 0, sourceView: false, line, pendingJump: line, loadingMore: false,
            hash: null, editable: false, dirty: false, saving: false, saveError: null, theirs: null, diskUnusable: null, baseline: 0, loads: 0, pending: 0, readOnly,
          };
          incarnations.set(tabId, ++lastIncarnation);
          set((s) => ({ entries: new Map(s.entries).set(tabId, fresh) }));
          watchThenRead('open');
        } else {
          if (line !== entry.line) patch(tabId, { line, pendingJump: line, ...(line !== null && entry.kind === 'markdown' ? { sourceView: true } : {}) });
          if (stale.delete(tabId)) void load(tabId, 'change');
        }
        mounted.set(tabId, (mounted.get(tabId) ?? 0) + 1);
        prune();
        let done = false;
        return () => {
          if (done) return;
          done = true;
          mounted.set(tabId, Math.max(0, (mounted.get(tabId) ?? 1) - 1));
          prune(); // a closed tab unmounts after the layout change that dropped it
        };
      },

      loadMore(tabId) {
        const entry = get().entries.get(tabId);
        if (!entry || entry.kind !== 'head' || entry.loadingMore || entry.loaded >= Math.min(CODE_CAP, entry.bytes)) return;
        const generation = generations.get(tabId);
        patch(tabId, { loadingMore: true });
        const length = Math.min(FILES_READ_DEFAULT_LENGTH, CODE_CAP - entry.loaded);
        void settled(client.invoke('files.read', { appSessionId: entry.appSessionId, path: entry.path, offset: entry.loaded, length })).then((next) => {
          // A newer load, or one that replaced the text this read continues, superseded it and cleared `loadingMore`.
          if (generations.get(tabId) !== generation || get().entries.get(tabId)?.epoch !== entry.epoch) return;
          if (!next.ok) return fail(tabId, next.error.message, 'open');
          const current = get().entries.get(tabId)!;
          patch(tabId, { text: current.text + next.value.content, loaded: next.value.offset + next.value.length, loadingMore: false });
        });
      },

      toggleSource(tabId) {
        const entry = get().entries.get(tabId);
        if (!entry) return;
        viewState(tabId).ratioPending = true;
        patch(tabId, { sourceView: !entry.sourceView });
      },

      setWrap: (wrap) => set({ wrap }),

      jumped: (tabId) => patch(tabId, { pendingJump: null }),

      applyChanged(event) {
        for (const [tabId, entry] of get().entries) {
          if (entry.appSessionId !== event.appSessionId) continue;
          const directory = dirname(entry.path);
          if (event.kind === 'invalidated') {
            // The Files store re-watches the directory (the boundary runs again); the file is re-read once that answered.
            const hold = holds.get(tabId);
            if (hold && sameFile(event.path, directory)) void hold.ready.then(() => holds.get(tabId) === hold && refresh(tabId));
          } else if (sameFile(event.path, entry.path) || (event.kind === 'changed' && sameFile(event.path, directory))) {
            refresh(tabId); // an event naming only the directory may be the file's, coalesced; a re-read absorbs a spurious one
          }
        }
      },

      // E5: the document captured now is what is written, and what `text` becomes on `ok`; typing during the save stays
      // dirty against it. From the notice the stale baseline's hash is sent on purpose (an unseen change is never
      // overwritten: the answer is `conflict`); from the merge view, the hash of what it shows. The answer lands only on
      // the entry incarnation that saved: a tab closed meanwhile (and perhaps reopened, a fresh entry loading) is left
      // alone, and the save answers 'noop', the entry it was for being gone.
      async save(tabId) {
        const entry = get().entries.get(tabId);
        const expectedHash = entry?.theirs?.view === 'merge' ? entry.theirs.hash : (entry?.hash ?? null);
        if (!entry || entry.saving || !unsaved(entry) || expectedHash === null) return 'noop';
        const content = documentOf(tabId);
        if (content === undefined) return 'noop';
        const incarnation = incarnations.get(tabId);
        const current = () => incarnations.get(tabId) === incarnation;
        patch(tabId, { saving: true, saveError: null });
        const answer = await settled(client.invoke('files.write', { appSessionId: entry.appSessionId, path: entry.path, content, expectedHash }));
        if (!current()) return 'noop';
        if (!answer.ok) {
          patch(tabId, { saving: false, saveError: answer.error.message });
          return 'error';
        }
        if (answer.value.status === 'conflict') return (await conflicted(tabId, get().entries.get(tabId)!, answer.value.hash, current)) ? 'conflict' : 'noop';
        supersede(tabId); // a read issued before the write lands nowhere
        moveBaseline(tabId, { text: content, hash: answer.value.hash, saving: false });
        return 'ok';
      },

      reload(tabId) {
        const entry = get().entries.get(tabId);
        if (!entry?.theirs || entry.saving) return;
        supersede(tabId);
        const { text, hash } = entry.theirs;
        const bytes = utf8Length(text);
        // The document is replaced whole (`epoch`); the owner's own act, so no Updated notice.
        patch(tabId, { text, hash, bytes, loaded: bytes, complete: true, theirs: null, diskUnusable: null, dirty: false, saveError: null, status: 'ready', error: null, removed: false, epoch: entry.epoch + 1 });
      },

      keepMine(tabId) {
        const entry = get().entries.get(tabId);
        if (!entry?.theirs || entry.saving) return;
        moveBaseline(tabId, { text: entry.theirs.text, hash: entry.theirs.hash });
      },

      compare(tabId) {
        const theirs = get().entries.get(tabId)?.theirs;
        if (theirs?.view === 'notice') patch(tabId, { theirs: { ...theirs, view: 'merge' } });
      },

      setDirty(tabId, dirty) {
        if (get().entries.get(tabId)?.dirty === !dirty) patch(tabId, { dirty });
      },

      setSaveError(tabId, message) {
        const entry = get().entries.get(tabId);
        if (entry && entry.saveError !== message) patch(tabId, { saveError: message });
      },

      // E5 (M5): the quit question's Save all. Every dirty tab saves at once (main serialises writes per file); a tab
      // that is still dirty afterwards is answered with its bar's words: a conflict now shows the merge view, an error
      // its message, a save already running its progress, and typing during the save the unsaved mark. A tab gone
      // meanwhile has nothing left to save. A tab already in the merge view is never saved here (fix wave 1): its save
      // sends the hash the merge shows, so it would write the owner's unresolved document over the disk's change;
      // resolving it is the owner's act in that tab, and it is answered as the conflict it is.
      async saveAll() {
        const dirty = [...get().entries.values()].filter((entry) => entry.dirty);
        const merging = new Set(dirty.filter((entry) => entry.theirs?.view === 'merge').map((entry) => entry.tabId));
        await Promise.all(dirty.filter((entry) => !merging.has(entry.tabId)).map((entry) => get().save(entry.tabId)));
        return dirty.flatMap(({ tabId }) => {
          const entry = get().entries.get(tabId);
          if (!entry?.dirty) return [];
          const message = merging.has(tabId)
            ? EDITOR_COPY.conflictOnSave
            : entry.saveError !== null
              ? EDITOR_COPY.saveFailed(entry.saveError)
              : entry.theirs?.view === 'merge'
                ? EDITOR_COPY.conflictOnSave
                : entry.saving
                  ? EDITOR_COPY.saving
                  : EDITOR_COPY.unsaved;
          return [{ path: entry.path, message }];
        });
      },

      reset() {
        for (const hold of holds.values()) hold.release();
        holds.clear();
        generations.clear();
        incarnations.clear();
        mounted.clear();
        stale.clear();
        used.clear();
        views.clear();
        unsubscribe?.();
        unsubscribe = null;
        set({ entries: new Map(), wrap: false });
      },
    };
  });
}

export const useViewer = createViewerStore(ipc);

// E5 (M5): the paths of the tabs with unsaved edits, once each, sorted.
export const unsavedPaths = (entries: ReadonlyMap<string, ViewerEntry>): string[] =>
  [...new Set([...entries.values()].filter((entry) => entry.dirty).map((entry) => entry.path))].sort();

// E5 (M5): every dirty tab as a Save all that could not run answers it (E11 W-D: its fallback), each path once with its
// bar's reason: a tab in the merge view its conflict, any other the unsaved mark.
export const unsavedFailures = (entries: ReadonlyMap<string, ViewerEntry>): UnsavedFailure[] => {
  const byPath = new Map<string, string>();
  for (const entry of entries.values()) {
    if (entry.dirty && byPath.get(entry.path) !== EDITOR_COPY.conflictOnSave) byPath.set(entry.path, entry.theirs?.view === 'merge' ? EDITOR_COPY.conflictOnSave : EDITOR_COPY.unsaved);
  }
  return [...byPath].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, message]) => ({ path, message }));
};

// E5 (M5): the window's whole dirty set to main for the quit guard (`layout.unsavedFiles`), sent whenever it changes
// (a tab turning dirty or clean, a dirty tab's entry gone) and never otherwise; synchronously from the store's write, so
// a save's push leaves before anything the caller sends after it. Main starts each page from an empty set, and a
// disconnect leaves it empty again, since nothing reports the window's edits after it.
export function pushUnsavedFiles(client: MawsBridge = ipc, store: ReturnType<typeof createViewerStore> = useViewer): () => void {
  let sent: string[] = [];
  const send = (paths: string[]) => {
    if (paths.length === sent.length && paths.every((path, i) => path === sent[i])) return;
    sent = paths;
    void client.invoke('layout.unsavedFiles', { paths }).then((result) => {
      if (!result.ok) console.warn('[editor] could not tell main the unsaved files', result.error);
    });
  };
  send(unsavedPaths(store.getState().entries));
  const off = store.subscribe((state, previous) => {
    if (state.entries !== previous.entries) send(unsavedPaths(state.entries));
  });
  return () => {
    off();
    send([]);
  };
}
