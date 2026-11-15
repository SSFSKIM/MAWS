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
// file shows nothing of either).
//
// UX wave U6c (docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §E): a session on this Mac reads
// with `named`, so the files service also answers for a file outside the session's folders that its transcript links;
// the answer says so (`named`), and such an entry was never editable, its reason the editor's title (U6e below). Every load sets
// `named` from its answer, also one that lands nothing else. No watch follows a file outside the folders, and nothing
// follows a refusal, so `revisit` reads a failed or named entry again when its tab is shown again or its file opened
// again (decision 15).
//
// UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §D; decisions 5, 6, 18, 19): a
// file outside the folders that this build's daemon admits for a save is editable. Every answered read sets the latest
// admission (`named`, and `locked`: MAWS's own, only added, or named only by a tool's result), under unsaved edits too;
// the entry also keeps the pin, the real path of the document it holds, which a read moves only where it lands on an
// entry with no unsaved edits (or one that has none), and Reload moves to the version taken. An entry with a pin is saved
// by `files.writeOutside` with it, and never by `files.write`; a locked one, or one named with no pin (a daemon of the
// parent pin, which answers no `outside`), is not saved at all. A tab the agent's open made (`agent`) reads with
// `agent`, so a grant alone admits nothing there.
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
// them; the conflict read, like a load, only while no newer load was issued.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { FILES_READ_DEFAULT_LENGTH, FILES_READ_MAX_LENGTH, type FilesChanged, type FilesReadOutput } from '@shared/ipc/schema/files';
import { ipc } from '../../../ipc/client';
import { useLayout } from '../../../stores/layout';
import { allTabs } from '../../../stores/layout-model';
import { machineOf } from '@shared/machine/address';
import { useFiles, type WatchHold } from '../files/store';
import { sideFileKeys } from '../files/tabs'; // UX wave U6b-1
import { dirname, sameFile } from '../files/tree';
import { EDITOR_COPY, REFUSAL } from '../copy';
import { CODE_CAP, kindOf, type ViewerKind } from './kinds';

export const VIEWER_ENTRIES_MAX = 20;

// P3-L (M6b fix wave 2, Decision Log 36i): a File artifact's file read by the artifact alone (`library.read`, main
// resolving its path), for an artifact no session made: no session, so no watch and no write.
export interface ArtifactRead {
  artifactId: string;
  revision: number;
}

export interface ViewerEntry {
  tabId: string;
  appSessionId: AppSessionId | null; // null: read by `artifact` alone (P3-L M6b fix wave 2)
  artifact: ArtifactRead | null; // P3-L (M6b fix wave 2)
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
  readOnly: boolean; // E2: mounted read-only (the File artifact viewer; E2's Decision Log 7): never editable, whatever the file
  named: boolean; // U6c: the last load's answer carried `named`: the file is outside the session's folders, admitted by the transcript
  // UX wave U6e (§D; decision 6)
  locked: 'maws' | 'added' | 'result' | null; // the latest answered read: `own` → 'maws'; else `outside.writable === false` → its `why`
  pin: string | null; // the real path of the document the entry holds; null for a document read with no `outside`
  agent: boolean; // the entry's reads carry `agent` (the tab's mark, decision 19)
  textEditable: boolean; // the baseline is a text the editor takes losslessly (`isEditable` where it landed); with the admission it decides `editable`
}

// E5: what the disk holds past the baseline, shown as the notice (Changed on disk) or, once compared or a save found
// it, as the merge view.
export interface Theirs {
  text: string;
  hash: string;
  view: 'notice' | 'merge';
  real: string | null; // UX wave U6e: the real path of the read that gave this version (Reload pins it)
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
  // P3-L (M6b fix wave 2): `artifact` reads the file by the artifact alone, the session (null for none) kept for what
  // the view offers beside the read
  // UX wave U6e (decision 19): `agent`, the tab holds the mark of an open the agent asked for
  mount(tabId: string, target: { appSessionId: AppSessionId | null; path: string; line: number | null; readOnly?: boolean; artifact?: ArtifactRead; agent?: boolean }): () => void;
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
  // U6c (decision 15): a failed or named entry is read again, now when its tab is mounted, else at its next mount; nothing
  // for an entry with a load in flight or unsaved edits, or one a session given is not the entry's (the mount replaces it)
  revisit(tabId: string, appSessionId?: AppSessionId | null): void;
  // UX wave U6e (decision 19, W9): the agent's show brought this file's view forward; when that draws it again, the mount
  // reads nothing new (a person's open, `revisit`, takes the mark back)
  agentShowed(tabId: string): void;
  // UX wave U6e (decision 18): the person chose the file whose real path is `real` for the session (Open File…): each entry
  // of the session pinned to it has its admission read again once, its document and its pin standing
  readAdmission(appSessionId: AppSessionId, real: string): void;
  // UX wave U6b-1 (sequence 6): the prune, run by the side tabs' one subscriber (`files/tabs.ts`) when they change
  prune(): void;
  // UX wave U6b-1 (Decision 20b): a key on its way between two views (a move) is kept out of the ownership prune and the
  // cap until its next mount, or until no tab holds it
  holdKey(key: string): void;
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

// UX wave U6e (decision 6, §D): what one read's answer says of the file now, the latest admission (`named`, `locked`),
// and the real path it read for a file outside the folders (`real`).
type Admission = Pick<ViewerEntry, 'named' | 'locked'> & { real: string | null };
const admissionOf = (read: FilesReadOutput): Admission => ({
  named: read.named === true,
  locked: read.own === true ? 'maws' : read.outside?.writable === false ? (read.outside.why ?? 'added') : null,
  real: read.outside?.real ?? null,
});
// Whether the admission and the pin let a text the editor takes be edited: not mounted read-only, not locked, and outside
// the folders only with the real path pinned (a daemon of the parent pin answers `named` with no `outside`: W6).
const admits = (entry: Pick<ViewerEntry, 'readOnly' | 'locked' | 'named' | 'pin'>): boolean => !entry.readOnly && entry.locked === null && (!entry.named || entry.pin !== null);

// E5: why a code view is read-only, shown as its content's title; null when it is editable or no reason is the owner's
// to know (an svg's source). U6c: a file the transcript names is read-only for being outside the folders, first. U6e:
// first what locks it, then a file outside the folders with no pin (W6); a savable outside file has no reason.
export function readOnlyReason(entry: ViewerEntry): 'maws' | 'added' | 'result' | 'outside' | 'head' | 'encoding' | 'loading' | null {
  if (entry.locked !== null) return entry.locked;
  if (entry.named && entry.pin === null) return 'outside';
  if (entry.editable) return null;
  if (entry.kind === 'head') return 'head';
  if (entry.readOnly) return null; // E2: a read-only mount is read-only by design, not for a reason of the file's
  if (entry.kind !== 'code' && entry.kind !== 'markdown') return null;
  if (entry.complete && entry.hash !== null && entry.encoding === 'utf8') return 'encoding';
  return 'loading';
}

async function settled<N extends 'files.read' | 'files.write' | 'files.writeOutside' | 'library.read'>(call: Promise<CommandResult<N>>): Promise<CommandResult<N>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
  }
}

const isNotFound = (message: string) => message.startsWith('not found:');

// UX wave U6e (decision 18): an outside save's refusal in words that say the way on, and a daemon that does not know the
// command in its own; every other failure (`FILES_MOVED`, `not writable: <path>`) in the service's words.
const outsideFailure = (error: { code: string; message: string }): string =>
  error.code === 'unknown_command' ? EDITOR_COPY.outsideUnavailable : error.message === REFUSAL ? EDITOR_COPY.outsideRefused : error.message;
const sameSource = (a: ArtifactRead | null, b: ArtifactRead | null) => a?.artifactId === b?.artifactId && a?.revision === b?.revision;

// What a load read, committed whole at its end (a `change` load) or patched as it goes (an `open` load). `utf8` (E5) is
// the read's answer about the hashed bytes, which decides `editable` and is not kept on the entry; `named` (U6c) is set
// when any read of the load answers it (the branch review's finding 3: the roots can change between two chunks). U6e:
// `locked` and `real` are the last chunk's that says them.
type LoadedFile = Pick<ViewerEntry, 'kind' | 'mime' | 'encoding' | 'bytes' | 'text' | 'base64' | 'loaded' | 'complete' | 'hash' | 'named' | 'locked'> & { utf8: boolean | null; real: string | null };

// What made a load: an event (`files.changed`, or one left for the next showing), or the person asking again (U6c's
// `revisit`, or showing a failed or named tab again).
type LoadCause = 'event' | 'revisit';

// U6c (M3 decision 3; Decision Log 15 b, 16): an unhashed read that found what the entry shows, so a revisit of an image
// or an external kind (or of a named head, which a revisit re-reads too) does not flash Updated over a file that did not
// change. An image's and a head's bytes are compared; an external kind is read for its size and type alone, which two
// different files can share, so it is taken as unchanged only on a revisit: after an event it lands, as before. A watched
// head keeps today's rule: its re-read follows an event, and lands.
const sameUnhashed = (entry: ViewerEntry, read: LoadedFile, cause: LoadCause) =>
  read.hash === null &&
  (read.kind === 'image' || (read.kind === 'external' && cause === 'revisit') || (read.kind === 'head' && read.named)) &&
  read.kind === entry.kind && read.mime === entry.mime && read.encoding === entry.encoding && read.bytes === entry.bytes &&
  read.loaded === entry.loaded && read.complete === entry.complete && read.text === entry.text && read.base64 === entry.base64;

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
  const stale = new Map<string, LoadCause>(); // tabs to read at their next mount, and why (an event's reason wins)
  const quiet = new Set<string>(); // U6e (decision 19): views the agent's show brought forward, whose next mount reads nothing new
  const answered = new Map<string, number>(); // U6e (decision 6): the answers a load or Load more of the tab has had, counted
  const used = new Map<string, number>();
  const held = new Set<string>(); // UX wave U6b-1 (Decision 20b): keys on their way between two views
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
    // One chunk of the entry's file: under its session (`files.read`), or by its artifact alone (`library.read`, P3-L
    // M6b fix wave 2), which answers alike. U6c (M3 decision 1): `named` for a session on this Mac alone; a session on
    // another machine is asked as today, to the byte (decision 10). U6e (decision 19): and `agent` beside it while the
    // entry holds the agent's mark.
    const readChunk = (entry: Pick<ViewerEntry, 'appSessionId' | 'artifact' | 'path' | 'agent'>, offset: number, length: number, hash: boolean): Promise<CommandResult<'files.read'>> => {
      const chunk = { offset, length, ...(hash ? { hash: true } : {}) };
      if (entry.artifact) return settled(client.invoke('library.read', { ...entry.artifact, ...chunk }));
      const { appSessionId } = entry;
      const local = appSessionId !== null && machineOf(appSessionId) === client.localMachine;
      const asking = local ? { named: true as const, ...(entry.agent ? { agent: true as const } : {}) } : {};
      return settled(client.invoke('files.read', { appSessionId: appSessionId!, path: entry.path, ...chunk, ...asking }));
    };

    const remove = (tabId: string) => {
      quiet.delete(tabId);
      answered.delete(tabId);
      holds.get(tabId)?.release();
      holds.delete(tabId);
      generations.delete(tabId);
      incarnations.delete(tabId);
      stale.delete(tabId);
      used.delete(tabId);
      held.delete(tabId);
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
    // UX wave U6b-1 (Decision 20a): a file a side tab holds is open too, whether its tab is in view or not. (20b) A key held
    // for a move is passed over by both until its next mount; a hold whose key no tab holds any more ends here.
    const prune = () => {
      const layout = useLayout.getState();
      const open = new Set([...allTabs(layout.main).map((tab) => tab.id), ...sideFileKeys(layout)]); // W12: every project's tab set
      for (const key of held) if (!open.has(key)) held.delete(key);
      for (const tabId of get().entries.keys()) if (!open.has(tabId) && !mounted.get(tabId) && !held.has(tabId)) remove(tabId);
      for (const tabId of views.keys()) if (!get().entries.has(tabId)) views.delete(tabId);
      const idle = [...get().entries.values()]
        .filter((entry) => !mounted.get(entry.tabId) && !entry.dirty && !entry.saving && !held.has(entry.tabId))
        .map((entry) => entry.tabId)
        .sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0));
      while (get().entries.size > VIEWER_ENTRIES_MAX && idle.length > 0) remove(idle.shift()!);
    };

    // E5: an entry with unsaved edits, or with the disk's newer version still on offer.
    const unsaved = (entry: ViewerEntry | undefined) => entry !== undefined && (entry.dirty || entry.theirs !== null);
    // U6e (decision 6): the pin after a read that answered `real`: the read's where it lands on an entry with no unsaved
    // edits, else the one the entry holds, or the read's when it holds none.
    const pinAfter = (entry: ViewerEntry, real: string | null): string | null => (unsaved(entry) ? (entry.pin ?? real) : real);
    // U6e (decision 6): an answer whose content is not taken (a chunk of another version, a read for the admission alone)
    // still sets the latest admission; the pin stands, since the document it names does.
    // U6e (decision 6): counts an answer of a read the tab still waits for, so an admission-only answer asked before it
    // knows a newer answer has spoken.
    const heard =
      (tabId: string, live: () => boolean) =>
      <T>(answer: T): T => {
        if (live()) answered.set(tabId, (answered.get(tabId) ?? 0) + 1);
        return answer;
      };
    const admitOnly = (tabId: string, admission: Admission) => {
      const entry = get().entries.get(tabId);
      if (!entry) return;
      const { named, locked } = admission;
      patch(tabId, { named, locked, editable: entry.textEditable && admits({ readOnly: entry.readOnly, named, locked, pin: entry.pin }) });
    };

    // U6c (decision 15): an entry read again when it is asked for again: its last read failed, or no watch keeps it
    // current (a file the transcript names), and no load of it is in flight nor edits of it unsaved. A failed entry is
    // read as it was first (an `open` load), a shown one as a re-read (a `change` load, the content standing until the
    // new one is whole).
    const revisitable = (entry: ViewerEntry) => (entry.status === 'error' || entry.named) && entry.pending === 0 && !unsaved(entry);
    const reasonOf = (entry: ViewerEntry): 'open' | 'change' => (entry.status === 'error' && !unsaved(entry) ? 'open' : 'change');

    const fail = (tabId: string, message: string, reason: 'open' | 'change') => {
      const entry = get().entries.get(tabId);
      // A file gone during a re-read keeps its last content; U6c: and `named`, since outside the folders only a named path
      // answers `not found` (decision 16), so the entry is still read again when asked for again.
      if (reason === 'change' && isNotFound(message) && entry?.status === 'ready') return patch(tabId, { removed: true, loadingMore: false });
      // E5: unsaved edits keep their baseline and their document (the view's) under a refusal, which shows over them; a
      // later read lands as any change load does. U6e (decision 6): a refusal moves neither the lock nor the pin, so the
      // label stays and a save asks the daemon, which decides.
      if (unsaved(entry)) return patch(tabId, { status: 'error', error: message, loadingMore: false, named: false, editable: entry!.textEditable && admits({ ...entry!, named: false }) });
      patch(tabId, {
        status: 'error', error: message, kind: null, text: '', base64: null, loaded: 0, complete: false, epoch: (entry?.epoch ?? 0) + 1, loadingMore: false, hash: null, editable: false, named: false, textEditable: false,
      });
    };

    // E5: a `change` load is judged by the entry as it is when the load completes (the editing state machine's
    // commit-time rule). Clean: the text is replaced as before, unless the read is the baseline itself (an own save, a
    // spurious event), which lands nothing. Unsaved edits: the document stands, and a read that is neither the baseline
    // nor the theirs already shown becomes theirs, when it is a text the editor could take; the baseline itself
    // withdraws a theirs shown earlier. U6c (M3 decision 2): `named` is the read's, also when it lands nothing else. U6e
    // (decision 6): so is the whole latest admission, under unsaved edits too, the document standing; the pin moves by
    // `pinAfter`; and `editable` is the baseline's text with the admission, so it moves both ways (W4).
    const commitChange = (tabId: string, read: LoadedFile, cause: LoadCause) => {
      const entry = get().entries.get(tabId);
      if (!entry) return;
      const admission = { named: read.named, locked: read.locked, pin: pinAfter(entry, read.real) };
      const ready = {
        status: 'ready' as const, error: null, removed: false, loadingMore: false, diskUnusable: null,
        ...admission, editable: entry.textEditable && admits({ readOnly: entry.readOnly, ...admission }),
      };
      const admissionMoved = admission.named !== entry.named || admission.locked !== entry.locked || admission.pin !== entry.pin || ready.editable !== entry.editable;
      const settledAlready = entry.status === 'ready' && !entry.removed && !entry.loadingMore && entry.diskUnusable === null && !admissionMoved;
      if (unsaved(entry)) {
        // E11 W-D: a disk version the editor cannot take is not offered, and the bar says why; a theirs shown earlier is
        // withdrawn, the disk no longer holding it (W-D review I1)
        if (!isEditable(read)) return patch(tabId, { ...ready, theirs: null, diskUnusable: unusableReason(read) });
        const differs = read.hash !== null && read.hash !== entry.hash && read.hash !== entry.theirs?.hash;
        if (differs) return patch(tabId, { ...ready, theirs: { text: read.text, hash: read.hash!, view: entry.theirs?.view ?? 'notice', real: read.real } });
        // P4 W2-C (tracker 2026-10-06): the disk back at the baseline withdraws a theirs shown earlier, so a save from the
        // merge view sends the baseline's hash and lands; safe because a save's conflict read supersedes older loads
        if (read.hash !== null && read.hash === entry.hash && entry.theirs !== null) return patch(tabId, { ...ready, theirs: null });
        if (!settledAlready) patch(tabId, ready);
        return;
      }
      if ((read.hash !== null && read.hash === entry.hash) || sameUnhashed(entry, read, cause)) {
        if (!settledAlready) patch(tabId, ready);
        return;
      }
      const { utf8, real: _real, ...file } = read; // the read's real path is the pin's, by `pinAfter` above
      void _real;
      const textEditable = isEditable({ ...file, utf8 });
      patch(tabId, { ...ready, ...file, textEditable, editable: textEditable && admits({ readOnly: entry.readOnly, ...admission }), epoch: entry.epoch + 1, updated: entry.updated + 1 });
    };

    // One load per tab at a time: a newer one (or the entry's removal) makes an older one's answers land nowhere. A
    // follow-the-file re-read (`change`) keeps the shown content until the new one is complete, then commits it whole.
    // Whatever a load patches ends a Load more it superseded (`loadingMore` false), whose answer then lands nowhere.
    // E5: every read of a text the editor could take asks for the file's hash; a continuation answering another hash
    // than the first chunk's means the file changed mid-load, and the load ends there (an open load shows what it has,
    // read-only; a change load lands nothing): the change's own `files.changed` re-reads it.
    const loadOnce = async (tabId: string, reason: 'open' | 'change', cause: LoadCause) => {
      const entry = get().entries.get(tabId);
      if (!entry) return;
      const generation = ++lastGeneration;
      generations.set(tabId, generation);
      const live = () => generations.get(tabId) === generation;
      // A re-read of a head covers what Load more had reached, not only the first chunk.
      const extent = reason === 'change' && entry.kind === 'head' ? Math.min(CODE_CAP, entry.loaded) : 0;
      const { path } = entry;
      const read = (offset: number, length: number, hash: boolean) => readChunk(entry, offset, length, hash).then(heard(tabId, live));

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
      // U6e (decision 6): an answer's admission is the latest from the moment it lands, before the load's content commits
      // (an open load's first patch carries the head's)
      if (reason === 'change') admitOnly(tabId, admissionOf(head));
      const kind = kindOf({ name: path, mime: head.mime, bytes: head.bytes, encoding: head.encoding });
      // U6e: the head's admission is on the entry from the first frame that shows the file (K11), the label with it
      const admitted = admissionOf(head);
      const file = { kind, mime: head.mime, encoding: head.encoding, bytes: head.bytes, named: admitted.named, locked: admitted.locked };
      const opened = { status: 'ready' as const, error: null, removed: false, loadingMore: false, epoch: (get().entries.get(tabId)?.epoch ?? 0) + 1, dirty: false, theirs: null, diskUnusable: null, saveError: null };
      // An open load puts the document on the entry, so the pin is the real path it read (decision 6).
      const commit = ({ utf8, real, ...loaded }: LoadedFile) => {
        if (reason === 'change') return commitChange(tabId, { ...loaded, utf8, real }, cause);
        const textEditable = isEditable({ ...loaded, utf8 });
        const landed = { ...opened, ...loaded, pin: real, textEditable };
        patch(tabId, { ...landed, editable: textEditable && admits({ readOnly: entry.readOnly, ...landed }) });
      };
      // A markdown file opened at a line is shown as its source, where the line exists.
      const sourceView = kind === 'markdown' && get().entries.get(tabId)?.pendingJump != null ? true : undefined;

      if (kind === 'external') return commit({ ...file, real: admitted.real, text: '', base64: null, loaded: 0, complete: true, hash: null, utf8: null });
      if (kind === 'image') {
        let whole = head;
        if (head.truncated) {
          const all = await read(0, head.bytes, false);
          if (!live()) return;
          if (!all.ok) return fail(tabId, all.error.message, reason);
          whole = all.value;
        }
        const utf8 = whole.encoding === 'utf8';
        const latest = whole === head ? admitted : admissionOf(whole); // U6e (decision 6): the last answer's alone
        return commit({ ...file, named: latest.named, locked: latest.locked, real: latest.real, text: utf8 ? whole.content : '', base64: utf8 ? null : whole.content, loaded: whole.length, complete: true, hash: null, utf8: null });
      }

      const hash = kind === 'head' ? null : head.hash;
      const utf8 = hash === null ? null : head.utf8; // the whole hashed file's, so every chunk of one hash answers the same
      let text = head.content;
      let loaded = head.offset + head.length;
      let { named, locked } = file;
      let { real } = admitted;
      const wanted = () => kind !== 'head' || loaded < extent;
      let more = head.truncated && wanted();
      if (reason === 'open') patch(tabId, { ...opened, ...file, pin: real, text, base64: null, loaded, complete: !head.truncated, hash: null, editable: false, textEditable: false, ...(sourceView ? { sourceView } : {}) });
      while (more && loaded < CODE_CAP) {
        const next = await read(loaded, kind === 'head' ? Math.min(FILES_READ_DEFAULT_LENGTH, extent - loaded) : FILES_READ_DEFAULT_LENGTH, hash !== null);
        if (!live()) return;
        // Mid-file: nothing of either version stays, except that a file gone during a re-read keeps its last content.
        if (!next.ok) return fail(tabId, next.error.message, reason);
        // Changed mid-load, whatever the chunk's length (a shrunk file answers zero bytes with its new hash): the load ends
        // here, an open one read-only with `hash: null`; its files.changed re-reads it. Checked before the shrink exit,
        // which would otherwise commit the old file's partial text with its whole-file hash, as editable.
        // U6e (decision 6): each answer's admission is the latest from the moment it lands, from itself alone, also where its
        // content is not taken (a chunk of another version, or none at all), the pin standing until the content commits.
        const latest = admissionOf(next.value);
        admitOnly(tabId, latest);
        if (hash !== null && next.value.hash !== hash) return;
        ({ named, locked, real } = latest);
        if (next.value.length === 0) break; // the file shrank under an unhashed read (a head)
        text += next.value.content;
        loaded = next.value.offset + next.value.length;
        more = next.value.truncated && wanted();
        if (reason === 'open') patch(tabId, { text, loaded, complete: !more });
      }
      commit({ ...file, named, locked, real, text, base64: null, loaded, complete: kind !== 'head', hash, utf8 });
    };

    // E5: a load is `pending` from its issue and counted in `loads` once it is over, however it ended (it replaced the
    // text, landed nothing, landed in theirs, failed, or was superseded and its answer landed nowhere), both on the entry
    // incarnation it was issued for. An e2e waiting out an own save's re-reads needs both: one write can raise two
    // events and so two overlapping loads, and the older one's completion moves `loads` while the newer is in flight
    // (the router answers reads independently, so no later read is a barrier for an earlier one).
    const load = async (tabId: string, reason: 'open' | 'change', cause: LoadCause = 'event') => {
      const incarnation = incarnations.get(tabId);
      const issued = get().entries.get(tabId);
      if (!issued) return;
      patch(tabId, { pending: issued.pending + 1 });
      await loadOnce(tabId, reason, cause);
      const entry = get().entries.get(tabId);
      if (entry && incarnations.get(tabId) === incarnation) patch(tabId, { loads: entry.loads + 1, pending: entry.pending - 1 });
    };

    // U6c (decision 15; the branch review's finding 4): an entry asked for again is read again; one whose last read
    // failed takes its watch again first, since the watch failed with the read when the file's folder did not exist yet
    // and the Files store installs a refused watch again only for a new holder. The new hold is taken before the old one
    // goes, so a watch that stands is not dropped; the read follows once the watch has answered, as at the first mount.
    const readAgain = (tabId: string, entry: ViewerEntry, cause: LoadCause) => {
      const reason = reasonOf(entry);
      if (entry.status !== 'error' || entry.appSessionId === null) {
        void load(tabId, reason, cause);
        return;
      }
      const hold = useFiles.getState().watch(entry.appSessionId, dirname(entry.path));
      holds.get(tabId)?.release();
      holds.set(tabId, hold);
      void hold.ready.then(() => {
        if (holds.get(tabId) === hold) void load(tabId, reason, cause);
      });
    };

    const refresh = (tabId: string) => {
      if (mounted.get(tabId)) void load(tabId, 'change');
      else stale.set(tabId, 'event'); // read when next shown
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

    // E5: a save's conflict: the file is read whole (one hashed read within the editor's caps) and shown as theirs in the
    // merge view, whatever hash the conflict answered, the theirs already shown included; a read answering yet another
    // hash is newer and wins. The read lands only on the incarnation that saved (`current`); answers whether it landed.
    // P4 W2-C (tracker 2026-10-06): it carries the tab's generation as a load does, superseding the loads in flight and
    // superseded by a newer one, whose read then says what the disk holds. Issued after the conflict's reply, it sees the
    // disk at or after the conflict, which a reply alone does not (the reply may describe a disk older than a change read
    // in flight), so superseding the older loads is sound only through it (the reviews). A read answering the baseline's
    // own hash withdraws theirs, and an unusable disk an earlier read reported: the disk is back where the document
    // started, and the next save lands.
    const conflicted = async (tabId: string, entry: ViewerEntry, current: () => boolean): Promise<boolean> => {
      const generation = ++lastGeneration;
      generations.set(tabId, generation);
      const answer = await readChunk(entry, 0, FILES_READ_MAX_LENGTH, true);
      if (!current()) return false;
      if (generations.get(tabId) !== generation) {
        patch(tabId, { saving: false });
        return true;
      }
      if (!answer.ok) {
        // U6e (decision 18): an outside file's conflict read refused says the way on, as its save's refusal does
        patch(tabId, { saving: false, saveError: entry.pin !== null ? outsideFailure(answer.error) : answer.error.message });
        return true;
      }
      const read = answer.value;
      const admitted = admissionOf(read);
      const file: LoadedFile = {
        kind: kindOf({ name: entry.path, mime: read.mime, bytes: read.bytes, encoding: read.encoding }), mime: read.mime, encoding: read.encoding, bytes: read.bytes,
        text: read.content, base64: null, loaded: read.length, complete: !read.truncated, hash: read.hash, utf8: read.utf8, ...admitted,
      };
      // U6c (Decision Log 15 e): the answer's `named` is the entry's, the document standing. U6e (decision 6, W3): so is the
      // whole latest admission; the pin moves by `pinAfter`, so a swap the read meets leaves the pin the save then sends.
      const shown = get().entries.get(tabId)!;
      const pin = pinAfter(shown, admitted.real);
      const naming = { named: admitted.named, locked: admitted.locked, pin, editable: shown.textEditable && admits({ readOnly: shown.readOnly, named: admitted.named, locked: admitted.locked, pin }) };
      if (file.hash !== null && file.hash === shown.hash) {
        patch(tabId, { saving: false, theirs: null, diskUnusable: null, ...naming });
        return true;
      }
      // A file that is no longer a text the editor could take (grown past its cap, binary, not UTF-8) is not offered;
      // the bar says why (E11 W-D), and a theirs shown earlier is withdrawn, the disk no longer holding it (W-D review I1).
      patch(
        tabId,
        isEditable(file)
          ? { saving: false, theirs: { text: file.text, hash: file.hash!, view: 'merge', real: admitted.real }, diskUnusable: null, ...naming }
          : { saving: false, saveError: EDITOR_COPY.conflictOnSave, theirs: null, diskUnusable: unusableReason(file), ...naming },
      );
      return true;
    };

    return {
      entries: new Map(),
      wrap: false,

      mount(tabId, { appSessionId, path, line, readOnly = false, artifact, agent = false }) {
        used.set(tabId, ++clock);
        if (!unsubscribe) unsubscribe = useLayout.subscribe((state, prev) => state.main !== prev.main && prune());
        const entry = get().entries.get(tabId);
        const source = artifact ?? null;
        const watchThenRead = (reason: 'open' | 'change') => {
          // P3-L (M6b fix wave 2): a file read by its artifact alone has no session to watch under: it is read once
          if (appSessionId === null) return void load(tabId, reason);
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
          patch(tabId, { appSessionId, agent, ...(line !== entry.line ? { line, pendingJump: line } : {}) });
          watchThenRead('change');
        } else if (!entry || entry.appSessionId !== appSessionId || entry.path !== path || entry.readOnly !== readOnly || !sameSource(entry.artifact, source)) {
          holds.get(tabId)?.release();
          views.delete(tabId);
          stale.delete(tabId);
          supersede(tabId); // an older load lands nowhere
          const fresh: ViewerEntry = {
            tabId, appSessionId, artifact: source, path, status: 'loading', error: null, kind: null, mime: '', encoding: 'utf8', bytes: 0, loaded: 0, complete: false,
            text: '', epoch: (entry?.epoch ?? 0) + 1, base64: null, removed: false, updated: 0, sourceView: false, line, pendingJump: line, loadingMore: false,
            hash: null, editable: false, dirty: false, saving: false, saveError: null, theirs: null, diskUnusable: null, baseline: 0, loads: 0, pending: 0, readOnly, named: false,
            locked: null, pin: null, agent, textEditable: false,
          };
          incarnations.set(tabId, ++lastIncarnation);
          set((s) => ({ entries: new Map(s.entries).set(tabId, fresh) }));
          watchThenRead('open');
        } else {
          const moved = line !== entry.line;
          const marked = agent !== entry.agent;
          const shownByAgent = quiet.delete(tabId);
          if (moved) patch(tabId, { line, pendingJump: line, ...(line !== null && entry.kind === 'markdown' ? { sourceView: true } : {}) });
          if (marked) patch(tabId, { agent });
          // a re-read an event left for the next showing, or (U6c) a failed or named entry shown again. U6e (decision 19):
          // not for a line moved under a view that stays mounted (a person's open reads through `revisit`), nor for a view
          // the agent's show drew again (it reads nothing new); and again when the agent's mark changes, a read in flight
          // under the other mark superseded, since its admission differs (one still opening is opened again)
          const left = stale.get(tabId);
          stale.delete(tabId);
          if (marked && !unsaved(entry) && entry.status === 'loading') void load(tabId, 'open', 'revisit');
          else if (left !== undefined) readAgain(tabId, entry, left);
          else if (marked ? !unsaved(entry) && (entry.status === 'error' || entry.named || entry.pending > 0) : !moved && !shownByAgent && revisitable(entry)) readAgain(tabId, entry, 'revisit');
        }
        mounted.set(tabId, (mounted.get(tabId) ?? 0) + 1);
        held.delete(tabId); // the move's destination has mounted: the hold has done its work
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
        void readChunk(entry, entry.loaded, length, false).then(heard(tabId, () => generations.get(tabId) === generation)).then((next) => {
          // A newer load, or one that replaced the text this read continues, superseded it and cleared `loadingMore`.
          if (generations.get(tabId) !== generation || get().entries.get(tabId)?.epoch !== entry.epoch) return;
          if (!next.ok) return fail(tabId, next.error.message, 'open');
          const current = get().entries.get(tabId)!;
          // U6e (decision 6): the answer's admission is the latest; the pin moves by the document and dirty rule
          const { named, locked, real } = admissionOf(next.value);
          const pin = pinAfter(current, real);
          patch(tabId, {
            text: current.text + next.value.content, loaded: next.value.offset + next.value.length, loadingMore: false,
            named, locked, pin, editable: current.textEditable && admits({ readOnly: current.readOnly, named, locked, pin }),
          });
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
        // U6c: a file named with no pin is never written (U6e: a daemon of the parent pin's answer, W6); U6e: nor a locked one
        if (!entry || entry.locked !== null || (entry.named && entry.pin === null) || entry.saving || !unsaved(entry) || expectedHash === null) return 'noop';
        const content = documentOf(tabId);
        if (content === undefined) return 'noop';
        const incarnation = incarnations.get(tabId);
        const current = () => incarnations.get(tabId) === incarnation;
        patch(tabId, { saving: true, saveError: null });
        const { appSessionId, path, pin } = entry;
        if (appSessionId === null) return 'noop'; // P3-L: an artifact's file read by the artifact is never written
        // U6e (decision 5): an entry with a pin is saved by the outside save with it, and never by files.write, whatever the
        // answer; a daemon that does not know the command writes nothing and is said so
        const answer =
          pin !== null
            ? await settled(client.invoke('files.writeOutside', { appSessionId, path, content, expectedHash, real: pin }))
            : await settled(client.invoke('files.write', { appSessionId, path, content, expectedHash }));
        if (!current()) return 'noop';
        if (!answer.ok) {
          patch(tabId, { saving: false, saveError: pin !== null ? outsideFailure(answer.error) : answer.error.message });
          return 'error';
        }
        if (answer.value.status === 'conflict') return (await conflicted(tabId, get().entries.get(tabId)!, current)) ? 'conflict' : 'noop';
        supersede(tabId); // a read issued before the write lands nowhere
        moveBaseline(tabId, { text: content, hash: answer.value.hash, saving: false });
        return 'ok';
      },

      reload(tabId) {
        const entry = get().entries.get(tabId);
        if (!entry?.theirs || entry.saving) return;
        supersede(tabId);
        const { text, hash, real } = entry.theirs;
        const bytes = utf8Length(text);
        // The document is replaced whole (`epoch`); the owner's own act, so no Updated notice. U6e (decision 6): the pin is
        // the real path of the version taken, which the editor takes (theirs is offered only then).
        const taken = { pin: real, textEditable: true };
        patch(tabId, {
          text, hash, bytes, loaded: bytes, complete: true, theirs: null, diskUnusable: null, dirty: false, saveError: null, status: 'ready', error: null, removed: false, epoch: entry.epoch + 1,
          ...taken, editable: admits({ ...entry, ...taken }),
        });
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

      revisit(tabId, appSessionId) {
        quiet.delete(tabId); // a person's open: the view reads again as asked
        const entry = get().entries.get(tabId);
        if (!entry || (appSessionId !== undefined && appSessionId !== entry.appSessionId) || !revisitable(entry)) return;
        if (mounted.get(tabId)) readAgain(tabId, entry, 'revisit');
        else if (!stale.has(tabId)) stale.set(tabId, 'revisit'); // read when next shown; an event's re-read already waiting stays one
      },

      agentShowed(tabId) {
        if (!mounted.get(tabId) && get().entries.has(tabId)) quiet.add(tabId); // a view drawn now is not drawn again
      },

      readAdmission(appSessionId, real) {
        for (const entry of get().entries.values()) {
          if (entry.appSessionId !== appSessionId || entry.pin !== real || entry.artifact) continue;
          const { tabId, path, pin, agent } = entry;
          // It lands only on the entry it was asked for, and only while nothing newer has spoken: no load or Reload since
          // (`supersede`, a move to another session among them), no answer of an earlier one since, and the entry's
          // session, path, pin and mark as they were.
          const asked = { incarnation: incarnations.get(tabId), generation: generations.get(tabId), answers: answered.get(tabId) ?? 0 };
          void readChunk(entry, 0, 1, false).then((answer) => {
            const now = get().entries.get(tabId);
            const same =
              now !== undefined && incarnations.get(tabId) === asked.incarnation && generations.get(tabId) === asked.generation && (answered.get(tabId) ?? 0) === asked.answers &&
              now.appSessionId === appSessionId && now.path === path && now.pin === pin && now.agent === agent;
            if (!same || !answer.ok) return; // a refusal moves neither lock nor pin
            admitOnly(tabId, admissionOf(answer.value));
          });
        }
      },

      prune,

      holdKey(key) {
        held.add(key);
      },

      reset() {
        quiet.clear();
        answered.clear();
        for (const hold of holds.values()) hold.release();
        holds.clear();
        generations.clear();
        incarnations.clear();
        mounted.clear();
        stale.clear();
        used.clear();
        held.clear();
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
