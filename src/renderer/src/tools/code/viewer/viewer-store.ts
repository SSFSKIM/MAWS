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
// `agent`, so a grant alone admits nothing there. One order rules the admission: every read that can set it draws a
// number when it is sent, and an answer sets it only when its number is above the last one that set it (`admit`); a
// refused answer sets nothing. The document, its hash and the pin move only with the content the reads commit.
//
// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M5; Interfaces §E; "The sequences that
// must hold"): a PDF, an HTML page, a video or a sound (the kind `frame`) is drawn from a token main issues
// (`layout.frameFile`). The store asks when a read of such a file lands, keeps one ask in flight per entry (a read that
// lands meanwhile marks one more ask after the answer), applies an answer only to the ask it is the answer of, keeps the
// frame drawn until the new token is ready and then releases the old one, and releases every token it no longer shows:
// an entry removed, an answer that came too late, a frame that failed or turned into a row, a reset. A failed frame
// (main's `layout.frameFailed`) starts nothing by itself: it is read again by the person (Open again, showing its tab
// again, opening the file again: `revisitable`) or by a `files.changed`, never by a clock.
//
// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; decisions 11 to 14
// and 18; Decision Log 16, 20, 21 and 26): a session that takes the remote route (a lane B session main runs on another
// machine over RL2) reads with `named` and `agent` as a session on this Mac does, and main's adapter turns a read of a
// file outside the folders into the act there; every other session of another machine is asked as before, to the byte.
// A read, a save and a frame's ask of a path the person opened on that machine (`openedThere`) carry `open`. A failure
// that carries `issues.refusal` is a sentence of UC-7 (`said`), drawn as it is; one refused `protected` asks the person
// first (`needsOpen`, the tab's Open it), and one refused so again under `open` (a link into another such folder) offers
// Open File… instead. A savable outside file whose standing has a sentence for the save (not one of the owners, or a build
// without the capability) is read-only for it (`'elsewhere'`), its edits kept; offline its save waits for the machine.
//
// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, M3; Interfaces §C, decisions 6 and 7, S1):
// a failure is also kept whole (`failure`: its code, its message and its refusal), which the notice classifies (`notice.ts`);
// `error` stays the message. The notice's Retry is `retry`: it reads an errored entry again as showing its tab again does,
// and also one with unsaved edits, which `openAgain` passes over, by the `change` load an event starts (the document and
// its baseline standing); one guard of its own (`retrying`) holds from the press until the read it started has settled,
// the wait for the file's watch included, and it does not start while a load is out or a save (or its conflict read) is.
//
// UX wave U6b-4c (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, Interfaces §F; W1): a read of a
// session's file waits while a follow of a link to it is under way (`following`), so the first read through a link is
// answered by what the daemon recorded, and notes how many follows of it had answered `linked` when it was sent
// (`linkedCount`). A read sent before the click can land refused, or read-only, after a follow found the link: once no
// follow is under way, such an answer whose count has moved is read once more, as a shown tab is read again (`readAgain`,
// or at the next mount), never over unsaved edits, and only for the entry and generation it landed in. That read again
// holds the guard the notice's Retry holds (`retrying`), each read of the two taking it in turn, so neither starts while
// the other's read is on its way. A file opened read-only because the Markdown file that links it is read-only for the
// session is locked `linked` (`outside.linked`), with its own sentence. The branch panel: a load superseded while in flight
// holds no read again back (`loadLive`); a continuation that found a read-only file changed is compared as such an answer
// is; and a Save that answers while a load issued since it began is out issues that load again after the write.
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
import type { FramedKind } from '@shared/files/framed';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { IpcErrorCode } from '@shared/ipc/errors';
import { FILES_READ_DEFAULT_LENGTH, FILES_READ_MAX_LENGTH, type FilesChanged, type FilesReadOutput } from '@shared/ipc/schema/files';
import { failureWords, refusalWords, type RemoteStanding } from '@shared/ipc/remote-unavailable';
import { ipc } from '../../../ipc/client';
import { remoteStandingOf } from '../../../lane-b/remote-standing';
import { useLayout } from '../../../stores/layout';
import { useMachines } from '../../../stores/machines';
import { allTabs } from '../../../stores/layout-model';
import type { MachineRef } from '@shared/machine/ref';
import { machineOf } from '@shared/machine/address';
import { openedThere, outsideUnavailable, ownersOnly, takesRemoteRoute } from '../files/elsewhere'; // UX wave U6f
import { useFiles, type WatchHold } from '../files/store';
import { sideFileKeys } from '../files/tabs'; // UX wave U6b-1
import { dirname, sameFile } from '../files/tree';
import { EDITOR_COPY, REFUSAL, VIEWER_COPY } from '../copy';
import { CODE_CAP, kindOf, type ViewerKind } from './kinds';
import { failureOf, type FileFailure } from './notice'; // UX wave U6b-4b
import { following, linkedCount } from '../follow'; // UX wave U6b-4c

export const VIEWER_ENTRIES_MAX = 20;

// P3-L (M6b fix wave 2, Decision Log 36i): a File artifact's file read by the artifact alone (`library.read`, main
// resolving its path), for an artifact no session made: no session, so no watch and no write.
export interface ArtifactRead {
  artifactId: string;
  machine: MachineRef;
  revision: number;
}

export interface ViewerEntry {
  tabId: string;
  appSessionId: AppSessionId | null; // null: read by `artifact` alone (P3-L M6b fix wave 2)
  artifact: ArtifactRead | null; // P3-L (M6b fix wave 2)
  path: string;
  status: 'loading' | 'ready' | 'error';
  error: string | null; // the read's refusal, word for word
  failure: FileFailure | null; // UX wave U6b-4b (decision 6): the same failure whole, for the notice; set and cleared with `error`
  retrying: boolean; // UX wave U6b-4b (decision 7): the notice's Retry started a read that has not settled yet
  // UX wave U6f (§E; decision 18, Decision Log 20)
  said: boolean; // the error is a sentence of UC-7 (the failure carried `issues.refusal`), drawn as it is
  needsOpen: boolean; // the read was refused for a folder macOS protects there: the tab offers Open it
  offersOpenFile: boolean; // refused so again under `open` (a link into another such folder): the tab offers Open File…
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
  saveSaid: boolean; // UX wave U6f (Decision Log 30 d): that failure is a sentence of UC-7 (`issues.refusal`), drawn as it is
  theirs: Theirs | null; // the disk's content past the baseline while dirty
  diskUnusable: DiskUnusable | null; // E11 W-D: the disk moved past the baseline to a file the editor cannot take, and why
  baseline: number; // bumped when `text` and `hash` move while the document stands (a save, Keep mine)
  loads: number; // loads of this entry completed, whether or not they landed anything (a superseded one when its read answers)
  pending: number; // loads of this entry in flight; the e2e's own-save barrier is a `loads` increase with `pending` at 0
  // E5 end
  readOnly: boolean; // E2: mounted read-only (the File artifact viewer; E2's Decision Log 7): never editable, whatever the file
  named: boolean; // U6c: the last load's answer carried `named`: the file is outside the session's folders, admitted by the transcript
  // UX wave U6e (§D; decision 6)
  // the latest answered read: `own` → 'maws'; else `outside.writable === false` → 'linked' with `outside.linked` (UX wave
  // U6b-4c), else its `why`
  locked: 'maws' | 'added' | 'result' | 'linked' | null;
  pin: string | null; // the real path of the document the entry holds; null for a document read with no `outside`
  agent: boolean; // the entry's reads carry `agent` (the tab's mark, decision 19)
  textEditable: boolean; // the baseline is a text the editor takes losslessly (`isEditable` where it landed); with the admission it decides `editable`
  frame: EntryFrame | null; // UX wave U6b-2: a framed file's token, as main answered it
}

// UX wave U6b-2 (Interfaces §E): what a framed file's tab draws.
export interface ReadyFrame {
  status: 'ready';
  token: string;
  url: string;
  framed: FramedKind;
  neighbours?: boolean;
}
export type EntryFrame =
  | { status: 'asking'; shown: ReadyFrame | null }
  | ReadyFrame
  | { status: 'failed' }
  | { status: 'row'; why: 'too-large' | 'unserved' }
  | { status: 'row'; why: 'unplayable'; from: string };

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
  mediaAt: number; // UX wave U6b-2: a video's or a sound's position, seconds
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
  // for an entry with a load in flight or unsaved edits, or one a session given is not the entry's (the mount replaces it).
  // U6e (decision 19): `agent`, the mark the open leaves on the tab (a person's open: none); an entry holding the other
  // mark takes it and is read again under it, a read in flight under the other mark superseded
  revisit(tabId: string, appSessionId?: AppSessionId | null, agent?: boolean): void;
  // UX wave U6e (decision 19, W9): the agent's show for `appSessionId` brings this file's view forward. The next mount of
  // the view is the agent's: a view it draws again reads nothing new, and one that must read fresh bytes (no entry yet,
  // or another session's) reads them as the agent's, with `agent` (a person's open, `revisit`, takes it back)
  agentShowed(tabId: string, appSessionId: AppSessionId): void;
  // UX wave U6e (decision 18): the person chose the file whose real path is `real` for the session (Open File…): each entry
  // of the session pinned to it has its admission read again once, its document and its pin standing
  readAdmission(appSessionId: AppSessionId, real: string): void;
  // UX wave U6b-1 (sequence 6): the prune, run by the side tabs' one subscriber (`files/tabs.ts`) when they change
  prune(): void;
  // UX wave U6b-1 (Decision 20b): a key on its way between two views (a move) is kept out of the ownership prune and the
  // cap until its next mount, or until no tab holds it
  holdKey(key: string): void;
  // UX wave U6b-2 (Interfaces §E)
  frameFailed(token: string): void;
  frameUnplayable(tabId: string): void;
  openAgain(tabId: string): void;
  // UX wave U6f (decision 18; W3): the tab's Open it, for a file in a folder macOS protects on another machine: the path
  // joins what the person opened there and is read again with `open`, once; nothing while that read is on its way
  openProtected(tabId: string): void;
  // UX wave U6b-4b (decision 7; S1): the notice's Retry: an errored entry read again, also under unsaved edits; nothing
  // while `canRetry` answers false, which the button asks too
  retry(tabId: string): void;
  canRetry(entry: ViewerEntry): boolean;
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
  if (!view) views.set(tabId, (view = { editor: null, editorAt: null, codeScroll: 0, renderedScroll: 0, ratio: null, ratioPending: false, docOf: null, clean: null, mediaAt: 0 }));
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
  locked: read.own === true ? 'maws' : read.outside?.writable === false ? (read.outside.linked === true ? 'linked' : (read.outside.why ?? 'added')) : null,
  real: read.outside?.real ?? null,
});
// Whether the admission and the pin let a text the editor takes be edited: not mounted read-only, not locked, and outside
// the folders only with the real path pinned (a daemon of the parent pin answers `named` with no `outside`: W6).
// U6f (§E, W1, R9): nor, on another machine, while the standing has a sentence for the save there.
const admits = (entry: Pick<ViewerEntry, 'readOnly' | 'locked' | 'named' | 'pin' | 'appSessionId'>): boolean =>
  !entry.readOnly && entry.locked === null && (!entry.named || entry.pin !== null) && (entry.pin === null || elsewhereWords(entry) === null);

/**
 * UX wave U6f (§E; decision 12's third column, W1, R9): why an outside file of a session that takes the remote route
 * cannot be saved there, in the window's helper's words; null where it can, or where no outside save is at stake (a file
 * inside the folders, one named with no pin, MAWS's own). Offline is no reason for one of the machine's owners, whose
 * save waits for the machine (decision 14); for anyone else the ownership row stands offline too (fix wave, finding 2).
 */
export function elsewhereWords(entry: Pick<ViewerEntry, 'appSessionId' | 'locked' | 'pin'>, standing?: RemoteStanding | null): string | null {
  const { appSessionId } = entry;
  if (appSessionId === null || entry.locked === 'maws' || (entry.locked === null && entry.pin === null) || !takesRemoteRoute(appSessionId)) return null;
  const now = standing === undefined ? remoteStandingOf(appSessionId) : standing;
  if (now === null) return null;
  return now.phase === 'offline' ? ownersOnly(now, 'files.writeOutside') : outsideUnavailable(now, 'files.writeOutside');
}

// Fix wave (finding 7; decision 14, B9): what Save answers for such a file, nothing sent: the refusal UC-7 words for the
// row the label says (a build without the capability, else the ownership).
function refusedSaveThere(entry: Pick<ViewerEntry, 'appSessionId' | 'locked' | 'pin'>): string | null {
  const words = elsewhereWords(entry);
  if (words === null || entry.appSessionId === null) return null;
  const standing = remoteStandingOf(entry.appSessionId)!;
  return refusalWords('files.writeOutside', standing.machine, words === ownersOnly(standing, 'files.writeOutside') ? 'owners-only' : 'not-offered');
}

// E5: why a code view is read-only, shown as its content's title; null when it is editable or no reason is the owner's
// to know (an svg's source). U6c: a file the transcript names is read-only for being outside the folders, first. U6e:
// first what locks it, then a file outside the folders with no pin (W6); a savable outside file has no reason. U6f: on
// another machine, after MAWS's own, the standing's sentence for a save there (`elsewhereWords`); `standing`, the one a
// render follows, else the one now.
export type ReadOnlyReason = 'maws' | 'elsewhere' | 'added' | 'result' | 'linked' | 'outside' | 'head' | 'encoding' | 'loading';
export function readOnlyReason(entry: ViewerEntry, standing?: RemoteStanding | null): ReadOnlyReason | null {
  if (entry.locked === 'maws') return 'maws';
  if (elsewhereWords(entry, standing) !== null) return 'elsewhere';
  if (entry.locked !== null) return entry.locked;
  if (entry.named && entry.pin === null) return 'outside';
  if (entry.editable) return null;
  if (entry.kind === 'head') return 'head';
  if (entry.readOnly) return null; // E2: a read-only mount is read-only by design, not for a reason of the file's
  if (entry.kind !== 'code' && entry.kind !== 'markdown') return null;
  if (entry.complete && entry.hash !== null && entry.encoding === 'utf8') return 'encoding';
  return 'loading';
}

/** The reason's sentence, as the editor's title and the "Read-only" panel say it; null with no reason. */
export function readOnlyWords(entry: ViewerEntry, standing?: RemoteStanding | null): string | null {
  const reason = readOnlyReason(entry, standing);
  if (reason === 'elsewhere') return EDITOR_COPY.readOnly.elsewhere(elsewhereWords(entry, standing)!);
  return reason === null ? null : EDITOR_COPY.readOnly[reason];
}

async function settled<N extends 'files.read' | 'files.write' | 'files.writeOutside' | 'library.read' | 'layout.frameFile' | 'layout.releaseFrame'>(call: Promise<CommandResult<N>>): Promise<CommandResult<N>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
  }
}

const isNotFound = (message: string) => message.startsWith('not found:');

// UX wave U6e (decision 18): an outside save's refusal in words that say the way on, and a daemon that does not know the
// command in its own; every other failure (`FILES_MOVED`, `not writable: <path>`) in the service's words.
// U6f (R7): the service's refusal from another machine, as main's adapter words a failure there, says the way on alike.
const REFUSED_THERE = failureWords('files.writeOutside', REFUSAL);
const outsideFailure = (error: { code: string; message: string }): string =>
  error.code === 'unknown_command' ? EDITOR_COPY.outsideUnavailable : error.message === REFUSAL || error.message === REFUSED_THERE ? EDITOR_COPY.outsideRefused : error.message;

// UX wave U6f: a failure as the store meets it, and the UC-7 word it carries, if any.
type Failure = { code: IpcErrorCode; message: string; issues?: unknown };
const refusalOf = (error: Failure): string | null => {
  const issues = error.issues as { refusal?: unknown } | undefined;
  return typeof issues?.refusal === 'string' ? issues.refusal : null;
};
// A save's failure as the bar says it (Decision Log 30 d): a sentence of UC-7 is said once, as it is.
const saveFailureOf = (error: Failure, outside: boolean): Pick<ViewerEntry, 'saveError' | 'saveSaid'> => {
  const saveError = outside ? outsideFailure(error) : error.message;
  return { saveError, saveSaid: refusalOf(error) !== null && saveError === error.message };
};
// U6f (decision 18; Decision Log 16, 26): whether a request for the entry's path carries `open`: a session that takes the
// remote route, and a path the person opened on its machine this run.
const opensThere = (entry: Pick<ViewerEntry, 'appSessionId' | 'path'>): boolean =>
  entry.appSessionId !== null && takesRemoteRoute(entry.appSessionId) && openedThere(machineOf(entry.appSessionId)).has(entry.path);
/** `open` for a request about the entry's path, under that test; also "Open externally"'s copy (ExternalRow.tsx). */
export const opens = (entry: Pick<ViewerEntry, 'appSessionId' | 'path'>) => (opensThere(entry) ? { open: true as const } : {});
const machineNameOf = (appSessionId: AppSessionId | null): string => (appSessionId === null ? '' : (remoteStandingOf(appSessionId)?.machine ?? ''));
const sameSource = (a: ArtifactRead | null, b: ArtifactRead | null) => a?.artifactId === b?.artifactId && a?.revision === b?.revision && a?.machine === b?.machine;

// What a load read, committed whole at its end (a `change` load) or patched as it goes (an `open` load). `utf8` (E5) is
// the read's answer about the hashed bytes, which decides `editable` and is not kept on the entry; `named` (U6c) is set
// when any read of the load answers it (the branch review's finding 3: the roots can change between two chunks). U6e:
// the admission is no part of it (each answer sets it as it lands, by `admit`); `real` is the last chunk's.
type LoadedFile = Pick<ViewerEntry, 'kind' | 'mime' | 'encoding' | 'bytes' | 'text' | 'base64' | 'loaded' | 'complete' | 'hash'> & { utf8: boolean | null; real: string | null };

// What made a load: an event (`files.changed`, or one left for the next showing), or the person asking again (U6c's
// `revisit`, or showing a failed or named tab again).
type LoadCause = 'event' | 'revisit';

// UX wave U6b-4c (W1 g): a read's answer that landed refused, or as an outside file that may not be saved: for whom and for
// which path it was sent, the generation it landed in, and the follows it noted as linked when it was sent.
interface Landed {
  appSessionId: AppSessionId | null;
  path: string;
  generation: number;
  noted: number;
}

// UX wave U6b-2: the token a frame holds: the one drawn, or the one kept drawn while a newer one is asked.
const heldToken = (frame: EntryFrame | null): string | null =>
  frame?.status === 'ready' ? frame.token : frame?.status === 'asking' ? (frame.shown?.token ?? null) : null;

// UX wave U6b-2: what the window asks main for a framed file: the one place U6e's `agent` joins ("What this document
// assumes of landings in flight"), for an entry that holds the agent's mark, as its own reads carry it (`readChunk`).
// UX wave U6f (Decision Log 26): and `open` under the test of the entry's reads.
const frameAsk = (entry: ViewerEntry) => ({ appSessionId: entry.appSessionId!, path: entry.path, ...(entry.agent ? { agent: true as const } : {}), ...opens(entry) });

// U6c (M3 decision 3; Decision Log 15 b, 16): an unhashed read that found what the entry shows, so a revisit of an image
// or an external kind (or of a named head, which a revisit re-reads too) does not flash Updated over a file that did not
// change. An image's and a head's bytes are compared; an external kind is read for its size and type alone, which two
// different files can share, so it is taken as unchanged only on a revisit: after an event it lands, as before. A watched
// head keeps today's rule: its re-read follows an event, and lands.
// UX wave U6b-2: a framed kind is read for its size and type alone too (M5, decision 6).
const sameUnhashed = (entry: ViewerEntry, read: LoadedFile, cause: LoadCause) =>
  read.hash === null &&
  (read.kind === 'image' || ((read.kind === 'external' || read.kind === 'frame') && cause === 'revisit') || (read.kind === 'head' && entry.named)) &&
  read.kind === entry.kind && read.mime === entry.mime && read.encoding === entry.encoding && read.bytes === entry.bytes &&
  read.loaded === entry.loaded && read.complete === entry.complete && read.text === entry.text && read.base64 === entry.base64;

export function createViewerStore(client: MawsBridge) {
  const holds = new Map<string, WatchHold>();
  // UX wave U6b-4b, the branch review: a hold a read again waits on, whose answer that read follows. An invalidation of the
  // folder's watch met meanwhile is read by that read, not by one of its own (which would supersede it), and is read by a
  // refresh only when that read starts nothing.
  const readsAfter = new WeakMap<WatchHold, { invalidated: boolean }>();
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
  const shownByAgent = new Set<string>(); // U6e (decision 19): views the agent's show brings forward, whose next mount is the agent's
  const tabMarks = new Map<string, boolean>(); // U6e (decision 19): the tab's own mark (the view's `agent`) as last mounted
  const admittedAt = new Map<string, number>(); // U6e (decision 6): the number of the read whose answer last set the tab's admission
  let lastAsk = 0; // the numbers reads that can set an admission draw when they are sent, rising
  const used = new Map<string, number>();
  const held = new Set<string>(); // UX wave U6b-1 (Decision 20b): keys on their way between two views
  // UX wave U6b-2: each living entry's ask in flight, from a counter that only grows; whether a read landed while it was
  // out (one more ask after its answer); and whether the entry has given its frame up (`obsolete`: the answer is released
  // on arrival). Through a kind change or a refusal of the same entry the slot is held until the answer comes, so an entry
  // never has two asks in flight (decision 5). An entry removed or replaced lets its slot go: its ask goes on alone and its
  // answer, matching no slot, is released when it comes (the table's X row), so the next entry under the key asks at once.
  const asks = new Map<string, { id: number; again: boolean; obsolete: boolean; open: boolean }>(); // U6f: `open`, whether the ask carried it
  let lastFrameAsk = 0;
  let clock = 0;
  let unsubscribe: (() => void) | null = null;
  let unfollowStanding: (() => void) | null = null; // UX wave U6f: the machines' standing, for `editable` there
  const pressedOpen = new Set<string>(); // UX wave U6f (W3): tabs whose Open it asked for a load not started yet
  const guards = new Map<string, number>(); // UX wave U6b-4c: each tab's latest turn of the read again's guard (`retrying`)
  let lastGuard = 0;
  const owed = new Map<string, Landed>(); // UX wave U6b-4c (W1 g): a read again owed, kept until the entry can read again
  // UX wave U6b-4c (the branch panel): each tab's newest load while it runs, by its generation; a load in flight whose
  // generation is no longer the tab's lands nowhere, so it holds back no read again
  const loading = new Map<string, number>();

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
    // entry holds the agent's mark. U6f (decision 11; Decision Log 16): `named` and `agent` also for a session that takes
    // the remote route, and `open` there for a path the person opened (`opensThere`).
    // UX wave U6b-4c (W1 a, g): a session's read waits until no follow of a link to the path is under way, asking again after
    // each wait; `sent` hears, as the read is sent, how many follows of it have answered `linked` (an artifact's read, 0).
    const readChunk = (entry: Pick<ViewerEntry, 'appSessionId' | 'artifact' | 'path' | 'agent'>, offset: number, length: number, hash: boolean, sent?: (linked: number) => void): Promise<CommandResult<'files.read'>> => {
      const chunk = { offset, length, ...(hash ? { hash: true } : {}) };
      const under = entry.artifact ? null : following(entry.appSessionId, entry.path);
      if (under !== null) return under.then(() => readChunk(entry, offset, length, hash, sent));
      sent?.(entry.artifact ? 0 : linkedCount(entry.appSessionId, entry.path));
      if (entry.artifact) {
        const { machine, ...artifact } = entry.artifact;
        return settled(client.invoke('library.read', { ...artifact, ...chunk }, { machine }));
      }
      const { appSessionId } = entry;
      const local = appSessionId !== null && machineOf(appSessionId) === client.localMachine;
      const remote = appSessionId !== null && !local && takesRemoteRoute(appSessionId);
      const asking = local || remote ? { named: true as const, ...(entry.agent ? { agent: true as const } : {}), ...(remote ? opens({ appSessionId, path: entry.path }) : {}) } : {};
      return settled(client.invoke('files.read', { appSessionId: appSessionId!, path: entry.path, ...chunk, ...asking }));
    };

    // UX wave U6b-2: a token main is told the window no longer shows; nothing to say if main no longer knows it.
    const release = (token: string | null) => {
      if (token !== null) void settled(client.invoke('layout.releaseFrame', { token }));
    };
    // The entry's frame is given up: its token released, and its ask in flight, if any, made obsolete (its answer released
    // on arrival). The entry itself going (`gone`: removed, or replaced under its key) lets the slot go as well.
    const dropFrame = (tabId: string, gone = false) => {
      release(heldToken(get().entries.get(tabId)?.frame ?? null));
      const out = asks.get(tabId);
      if (gone) asks.delete(tabId);
      else if (out) {
        out.obsolete = true;
        out.again = false;
      }
    };

    const remove = (tabId: string) => {
      dropFrame(tabId, true);
      shownByAgent.delete(tabId);
      tabMarks.delete(tabId);
      admittedAt.delete(tabId);
      holds.get(tabId)?.release();
      holds.delete(tabId);
      generations.delete(tabId);
      incarnations.delete(tabId);
      stale.delete(tabId);
      used.delete(tabId);
      held.delete(tabId);
      pressedOpen.delete(tabId);
      guards.delete(tabId); // UX wave U6b-4c
      owed.delete(tabId);
      loading.delete(tabId);
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
    // U6e (decision 6): the one order of the admission. An answer of a read numbered `asked` sets the entry's latest
    // admission (`named`, `locked`, and `editable` with them) only when no answer of a later-sent read has set it yet, and
    // records that it did; the pin stands (it moves with the document). Every caller has an answer that was not refused.
    const admit = (tabId: string, asked: number, read: FilesReadOutput) => {
      const entry = get().entries.get(tabId);
      if (!entry || asked <= (admittedAt.get(tabId) ?? 0)) return;
      admittedAt.set(tabId, asked);
      const { named, locked } = admissionOf(read);
      patch(tabId, { named, locked, editable: entry.textEditable && admits({ readOnly: entry.readOnly, named, locked, pin: entry.pin, appSessionId: entry.appSessionId }) });
    };
    // What the entry's admission, as it stands, and a pin let it be: editable or not.
    const editableWith = (entry: ViewerEntry, pin: string | null, textEditable = entry.textEditable) =>
      textEditable && admits({ readOnly: entry.readOnly, named: entry.named, locked: entry.locked, pin, appSessionId: entry.appSessionId });

    // UX wave U6f (W1, R9): the standing of a machine moved; an outside file of a session there is editable again, or no
    // longer, as its save is offered there (`admits`), its document standing.
    const followStanding = () => {
      for (const entry of get().entries.values()) {
        if (entry.pin === null || entry.appSessionId === null || !takesRemoteRoute(entry.appSessionId)) continue;
        const editable = editableWith(entry, entry.pin);
        if (editable !== entry.editable) patch(entry.tabId, { editable });
      }
    };

    // U6c (decision 15): an entry read again when it is asked for again: its last read failed, or no watch keeps it
    // current (a file the transcript names), and no load of it is in flight nor edits of it unsaved. A failed entry is
    // read as it was first (an `open` load), a shown one as a re-read (a `change` load, the content standing until the
    // new one is whole).
    // UX wave U6b-2 (M5, decision 4; A4): and an entry whose frame failed.
    // UX wave U6b-4c (the branch panel): a load in flight holds it back only while it can still land; a superseded one,
    // whose answer lands nowhere, does not (the person's open that took an agent's tab back, its read refused, and the
    // agent's own read still out: the link's click then reads after its follow)
    const loadLive = (tabId: string) => loading.has(tabId) && loading.get(tabId) === generations.get(tabId);
    const revisitable = (entry: ViewerEntry) => (entry.status === 'error' || entry.named || entry.frame?.status === 'failed') && !loadLive(entry.tabId) && !unsaved(entry);
    const reasonOf = (entry: ViewerEntry): 'open' | 'change' => (entry.status === 'error' && !unsaved(entry) ? 'open' : 'change');

    // U6f (decision 18; Decision Log 20; W3): what a failure shows. A UC-7 sentence (`issues.refusal`) as it is; a folder
    // macOS protects there asks the person first, and refused so again under `open` offers Open File…; a load that
    // follows an Open it press (`pressed`) and fails otherwise keeps the question and its button, so it can be asked again.
    // Fix wave (finding 6): `carried`, whether the request that failed carried `open`, as it was sent.
    // UX wave U6b-4b (decision 6): and the failure whole, as it came, whatever sentence U6f shows for it.
    const shownFailure = (entry: ViewerEntry | undefined, error: Failure, pressed: boolean, carried: boolean): Pick<ViewerEntry, 'error' | 'failure' | 'said' | 'needsOpen' | 'offersOpenFile'> => {
      const machine = machineNameOf(entry?.appSessionId ?? null);
      const remote = entry !== undefined && entry.appSessionId !== null && takesRemoteRoute(entry.appSessionId);
      const refusal = refusalOf(error);
      const failure = failureOf(error);
      if (remote && refusal === 'protected' && carried)
        return { error: VIEWER_COPY.protectedThrough(machine), failure, said: true, needsOpen: false, offersOpenFile: true };
      if (remote && (refusal === 'protected' || pressed)) return { error: VIEWER_COPY.protectedThere(machine), failure, said: true, needsOpen: true, offersOpenFile: false };
      return { error: error.message, failure, said: refusal !== null, needsOpen: false, offersOpenFile: false };
    };

    const fail = (tabId: string, error: Failure, reason: 'open' | 'change', pressed = false, carried = false) => {
      const entry = get().entries.get(tabId);
      const { message } = error;
      // A file gone during a re-read keeps its last content; U6c: and `named`, since outside the folders only a named path
      // answers `not found` (decision 16), so the entry is still read again when asked for again.
      if (reason === 'change' && isNotFound(message) && entry?.status === 'ready') return patch(tabId, { removed: true, loadingMore: false });
      const shown = shownFailure(entry, error, pressed, carried);
      // E5: unsaved edits keep their baseline and their document (the view's) under a refusal, which shows over them; a
      // later read lands as any change load does. U6e (decision 6): a refusal moves neither the lock nor the pin, so the
      // label stays and a save asks the daemon, which decides.
      if (unsaved(entry)) return patch(tabId, { status: 'error', ...shown, loadingMore: false, named: false, editable: entry!.textEditable && admits({ ...entry!, named: false }) });
      dropFrame(tabId); // UX wave U6b-2: a refused file shows no frame
      patch(tabId, {
        status: 'error', ...shown, kind: null, text: '', base64: null, loaded: 0, complete: false, epoch: (entry?.epoch ?? 0) + 1, loadingMore: false, hash: null, editable: false, named: false, textEditable: false, frame: null,
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
      const pin = pinAfter(entry, read.real);
      const ready = { status: 'ready' as const, error: null, failure: null, said: false, needsOpen: false, offersOpenFile: false, removed: false, loadingMore: false, diskUnusable: null, pin, editable: editableWith(entry, pin) };
      const admissionMoved = pin !== entry.pin || ready.editable !== entry.editable;
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
      patch(tabId, { ...ready, ...file, textEditable, editable: editableWith(entry, pin, textEditable), epoch: entry.epoch + 1, updated: entry.updated + 1 });
    };

    // UX wave U6b-2 (the entry's frame table, event L): a read of a framed file landed, so main is asked for a token; a
    // read that lands while an ask is out marks one more ask after its answer, so there is never a second in flight. An
    // entry read by its artifact alone (no session) asks nothing and draws the row (M5, decision 2).
    const ask = (tabId: string) => {
      const entry = get().entries.get(tabId);
      if (!entry || entry.kind !== 'frame' || entry.appSessionId === null) return;
      const shown = entry.frame?.status === 'ready' ? entry.frame : entry.frame?.status === 'asking' ? entry.frame.shown : null;
      const out = asks.get(tabId);
      if (out) {
        // behind the ask in flight, an obsolete one's included: the entry shows that it asks, and asks on its answer
        out.again = true;
        if (entry.frame?.status !== 'asking') patch(tabId, { frame: { status: 'asking', shown } });
        return;
      }
      const id = ++lastFrameAsk;
      const asking = frameAsk(entry);
      asks.set(tabId, { id, again: false, obsolete: false, open: 'open' in asking });
      patch(tabId, { frame: { status: 'asking', shown } });
      void settled(client.invoke('layout.frameFile', asking)).then((answer) => answered(tabId, id, answer));
    };

    // Events A+, A0 and A×, in one synchronous step: the answer frees its key's slot; it lands only when nothing gave the
    // frame up meanwhile (an entry removed, replaced, refused or no longer framed made it obsolete, so its token is
    // released here, and an ask queued behind it goes now); the token drawn before is released after the new frame is in
    // place.
    const answered = (tabId: string, id: number, answer: CommandResult<'layout.frameFile'>) => {
      const out = asks.get(tabId);
      if (out?.id === id) asks.delete(tabId);
      if (out?.id !== id || out.obsolete) {
        if (answer.ok && answer.value.status === 'ready') release(answer.value.token);
        if (out?.id === id && out.again) ask(tabId);
        return;
      }
      const before = heldToken(get().entries.get(tabId)?.frame ?? null);
      if (!answer.ok) {
        release(before);
        patch(tabId, { frame: null });
        return fail(tabId, answer.error, 'open', false, out.open); // a read's failure, which `revisit` reads again
      }
      const value = answer.value;
      const frame: EntryFrame =
        value.status === 'ready'
          ? { status: 'ready', token: value.token, url: value.url, framed: value.framed, ...(value.neighbours !== undefined && { neighbours: value.neighbours }) }
          : value.why === 'unframed'
            ? { status: 'failed' } // the file changed between its read and main's ("Decisions settled at authoring", 3)
            : { status: 'row', why: value.why };
      patch(tabId, { frame });
      release(before);
      if (out.again) ask(tabId);
    };

    // After a load committed: a framed file asks (event L); an entry that is no longer one gives its frame up.
    const settleFrame = (tabId: string) => {
      const entry = get().entries.get(tabId);
      if (entry?.kind === 'frame') ask(tabId);
      else if (entry?.frame) {
        dropFrame(tabId);
        patch(tabId, { frame: null });
      }
    };

    // One load per tab at a time: a newer one (or the entry's removal) makes an older one's answers land nowhere. A
    // follow-the-file re-read (`change`) keeps the shown content until the new one is complete, then commits it whole.
    // Whatever a load patches ends a Load more it superseded (`loadingMore` false), whose answer then lands nowhere.
    // E5: every read of a text the editor could take asks for the file's hash; a continuation answering another hash
    // than the first chunk's means the file changed mid-load, and the load ends there (an open load shows what it has,
    // read-only; a change load lands nothing): the change's own `files.changed` re-reads it.
    const loadOnce = async (tabId: string, reason: 'open' | 'change', cause: LoadCause): Promise<Landed | null> => {
      const entry = get().entries.get(tabId);
      if (!entry) return null;
      const generation = ++lastGeneration;
      generations.set(tabId, generation);
      const live = () => generations.get(tabId) === generation;
      // A re-read of a head covers what Load more had reached, not only the first chunk.
      const extent = reason === 'change' && entry.kind === 'head' ? Math.min(CODE_CAP, entry.loaded) : 0;
      const { path } = entry;
      const pressed = pressedOpen.delete(tabId); // U6f (W3): the load an Open it press asked for
      // The reads are sent one after another, each awaited: `asked` is the number of the one last sent (U6e: `admit`), drawn
      // as it is sent (U6b-4c: after any wait for a follow), with the follows it found linked (`noted`).
      let asked = 0;
      let carried = false; // U6f (fix wave, finding 6): whether the read last sent carried `open`
      let noted = 0;
      const read = (offset: number, length: number, hash: boolean) =>
        readChunk(entry, offset, length, hash, (linked) => {
          asked = ++lastAsk;
          carried = opensThere(entry); // the test `readChunk` applies, at the same moment
          noted = linked;
        });
      // U6b-4c (W1 g): what the load's last answer leaves for the read again after the follows: a refusal, or a file outside
      // the folders that may not be saved; null when it landed otherwise, or nowhere
      const landed = (): Landed => ({ appSessionId: entry.appSessionId, path, generation, noted });
      const failed = (error: Failure): Landed => {
        fail(tabId, error, reason, pressed, carried);
        return landed();
      };

      // The hash is asked for only where it can be used: the kind still undecided (an open load, an entry with none) or
      // one the editor takes. A change load of a head, an image or an external kind asks none (each would cost main a
      // whole-file read and a SHA-256 per change), and asks again, once, should the file have become editable text.
      const editableKind = (candidate: ViewerKind | null) => candidate === null || candidate === 'code' || candidate === 'markdown';
      const hashed = reason === 'open' || editableKind(entry.kind);
      let first = await read(0, FILES_READ_DEFAULT_LENGTH, hashed);
      if (!live()) return null;
      if (!first.ok) return failed(first.error);
      if (!hashed && editableKind(kindOf({ name: path, mime: first.value.mime, bytes: first.value.bytes, encoding: first.value.encoding }))) {
        first = await read(0, FILES_READ_DEFAULT_LENGTH, true);
        if (!live()) return null;
        if (!first.ok) return failed(first.error);
      }
      const head = first.value;
      // U6e (decision 6): each answer's admission lands as the answer does, before the load's content commits; the head's is
      // on the entry from the first frame that shows the file (K11), the label with it
      admit(tabId, asked, head);
      const kind = kindOf({ name: path, mime: head.mime, bytes: head.bytes, encoding: head.encoding });
      const file = { kind, mime: head.mime, encoding: head.encoding, bytes: head.bytes };
      const opened = { status: 'ready' as const, error: null, failure: null, said: false, needsOpen: false, offersOpenFile: false, removed: false, loadingMore: false, epoch: (get().entries.get(tabId)?.epoch ?? 0) + 1, dirty: false, theirs: null, diskUnusable: null, saveError: null };
      // An open load puts the document on the entry, so the pin is the real path it read (decision 6).
      // U6b-4c: `answer`, the read whose admission the commit draws (the last that landed)
      const commit = ({ utf8, real, ...loaded }: LoadedFile, answer: FilesReadOutput): Landed | null => {
        if (reason === 'change') commitChange(tabId, { ...loaded, utf8, real }, cause);
        else {
          const textEditable = isEditable({ ...loaded, utf8 });
          patch(tabId, { ...opened, ...loaded, pin: real, textEditable, editable: editableWith(get().entries.get(tabId) ?? entry, real, textEditable) });
        }
        settleFrame(tabId); // UX wave U6b-2
        return answer.outside?.writable === false ? landed() : null;
      };
      // A markdown file opened at a line is shown as its source, where the line exists.
      const sourceView = kind === 'markdown' && get().entries.get(tabId)?.pendingJump != null ? true : undefined;

      if (kind === 'external' || kind === 'frame') return commit({ ...file, real: admissionOf(head).real, text: '', base64: null, loaded: 0, complete: true, hash: null, utf8: null }, head);
      if (kind === 'image') {
        let whole = head;
        if (head.truncated) {
          const all = await read(0, head.bytes, false);
          if (!live()) return null;
          if (!all.ok) return failed(all.error);
          whole = all.value;
          admit(tabId, asked, whole);
        }
        const utf8 = whole.encoding === 'utf8';
        return commit({ ...file, real: admissionOf(whole).real, text: utf8 ? whole.content : '', base64: utf8 ? null : whole.content, loaded: whole.length, complete: true, hash: null, utf8: null }, whole);
      }

      const hash = kind === 'head' ? null : head.hash;
      const utf8 = hash === null ? null : head.utf8; // the whole hashed file's, so every chunk of one hash answers the same
      let text = head.content;
      let loaded = head.offset + head.length;
      let { real } = admissionOf(head);
      const wanted = () => kind !== 'head' || loaded < extent;
      let more = head.truncated && wanted();
      let last = head; // U6b-4c: the last answer that landed
      if (reason === 'open') patch(tabId, { ...opened, ...file, pin: real, text, base64: null, loaded, complete: !head.truncated, hash: null, editable: false, textEditable: false, ...(sourceView ? { sourceView } : {}) });
      while (more && loaded < CODE_CAP) {
        const next = await read(loaded, kind === 'head' ? Math.min(FILES_READ_DEFAULT_LENGTH, extent - loaded) : FILES_READ_DEFAULT_LENGTH, hash !== null);
        if (!live()) return null;
        // Mid-file: nothing of either version stays, except that a file gone during a re-read keeps its last content.
        if (!next.ok) return failed(next.error);
        // Changed mid-load, whatever the chunk's length (a shrunk file answers zero bytes with its new hash): the load ends
        // here, an open one read-only with `hash: null`; its files.changed re-reads it. Checked before the shrink exit,
        // which would otherwise commit the old file's partial text with its whole-file hash, as editable.
        // U6e (decision 6): each answer's admission is the latest from the moment it lands, from itself alone, also where its
        // content is not taken (a chunk of another version, or none at all), the pin standing until the content commits.
        admit(tabId, asked, next.value);
        // U6b-4c (the branch panel): an answer read-only from a file outside the folders, which no watch follows, is compared
        // with the follows as any such answer is, so the file is read again, whole, once a follow has found its link
        if (hash !== null && next.value.hash !== hash) return next.value.outside?.writable === false ? landed() : null;
        real = admissionOf(next.value).real;
        last = next.value;
        if (next.value.length === 0) break; // the file shrank under an unhashed read (a head)
        text += next.value.content;
        loaded = next.value.offset + next.value.length;
        more = next.value.truncated && wanted();
        if (reason === 'open') patch(tabId, { text, loaded, complete: !more });
      }
      return commit({ ...file, real, text, base64: null, loaded, complete: kind !== 'head', hash, utf8 }, last);
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
      const running = loadOnce(tabId, reason, cause);
      const generation = generations.get(tabId)!; // drawn by the load as it began
      loading.set(tabId, generation);
      const landed = await running;
      if (loading.get(tabId) === generation) loading.delete(tabId);
      const entry = get().entries.get(tabId);
      if (entry && incarnations.get(tabId) === incarnation) patch(tabId, { loads: entry.loads + 1, pending: entry.pending - 1 });
      // U6b-4c (W1 g): outside the load, which has left `pending`; a read again owed meanwhile may be possible now
      if (landed !== null) void readAfterFollows(tabId, landed);
      else readOwed(tabId);
    };

    // U6c (decision 15; the branch review's finding 4): an entry asked for again is read again; one whose last read
    // failed takes its watch again first, since the watch failed with the read when the file's folder did not exist yet
    // and the Files store installs a refused watch again only for a new holder. The new hold is taken before the old one
    // goes, so a watch that stands is not dropped; the read follows once the watch has answered, as at the first mount.
    // UX wave U6b-4b (S1): settled once that read has (or once the watch answered, when a newer hold took its place).
    // `still`, asked once the watch has answered, right before the read: false starts nothing (Retry's, fix wave 1).
    const readAgain = (tabId: string, entry: ViewerEntry, cause: LoadCause, still: () => boolean = () => true): Promise<void> => {
      const reason = reasonOf(entry);
      if (entry.status !== 'error' || entry.appSessionId === null) return load(tabId, reason, cause);
      const hold = useFiles.getState().watch(entry.appSessionId, dirname(entry.path));
      holds.get(tabId)?.release();
      holds.set(tabId, hold);
      const waiting = { invalidated: false };
      readsAfter.set(hold, waiting);
      return hold.ready.then(() => {
        readsAfter.delete(hold);
        if (holds.get(tabId) !== hold) return undefined;
        if (still()) return load(tabId, reason, cause);
        if (waiting.invalidated) refresh(tabId); // the invalidation's own read, which this one would have been
        else readOwed(tabId); // UX wave U6b-4c: this one read nothing, so a read again owed may go now
        return undefined;
      });
    };

    // UX wave U6b-4b (decision 7; S1 (a), (f)): whether the notice's Retry would start a read now.
    const canRetry = (entry: ViewerEntry) => entry.status === 'error' && !entry.retrying && entry.pending === 0 && !entry.saving;

    // UX wave U6b-4b (decision 7; S1), U6b-4c (W1 g): an entry read again under the guard (`retrying`) from now until that read
    // has settled, the wait for the file's watch included. Retry's and the store's own read again after a follow take it in
    // turn: each drawing a turn of its own (`guards`), only the last clears it, so the guard holds while either's read is on
    // its way. What started it is asked again once the watch has answered, right before the read (Retry's fix wave 1): a
    // save started meanwhile, or a load begun since, starts nothing, and the guard clears.
    // `also`, what else the starter asks right before the read (W1 g: the entry still as its answer landed).
    const readAgainGuarded = (tabId: string, entry: ViewerEntry, also: () => boolean = () => true): Promise<void> => {
      const incarnation = incarnations.get(tabId);
      const turn = ++lastGuard;
      guards.set(tabId, turn);
      patch(tabId, { retrying: true });
      const still = () => {
        const now = get().entries.get(tabId);
        return now !== undefined && incarnations.get(tabId) === incarnation && now.status === 'error' && now.pending === 0 && !now.saving && also();
      };
      return readAgain(tabId, entry, 'revisit', still).then(() => {
        if (incarnations.get(tabId) !== incarnation || guards.get(tabId) !== turn) return;
        guards.delete(tabId);
        patch(tabId, { retrying: false });
        readOwed(tabId); // a read again owed while the guard was held
      });
    };
    // A read again waiting on the file's watch (`readAgain`'s hold), which is no load yet
    const waitingOnWatch = (tabId: string) => {
      const hold = holds.get(tabId);
      return hold !== undefined && readsAfter.has(hold);
    };

    // UX wave U6b-4c (W1 g): an answer that landed refused, or as an outside file that may not be saved, compared once no
    // follow of its session and path is under way (at once when none is). When a follow has answered `linked` since its read
    // was sent, a read again is owed (`owed`), and it is made as soon as the entry can read again: now, or when the load,
    // the read again on its watch or the guarded read that holds it back has ended. It is made only while the entry is
    // still that session's, that path's and of the generation the answer landed in (a read since answers for itself), with
    // no edits unsaved; it is asked again right before the read (`still`). Then it reads as a shown tab is read again: now
    // when its view is mounted, else at its next mount. The new read notes the new count, so it starts no further one.
    const readAfterFollows = async (tabId: string, landed: Landed) => {
      for (let under = following(landed.appSessionId, landed.path); under !== null; under = following(landed.appSessionId, landed.path)) await under;
      // a comparison obsolete by now (the entry another session's, path's or generation's) owes nothing, and takes no place
      // of a read again the entry owes for itself
      if (linkedCount(landed.appSessionId, landed.path) <= landed.noted || !stillOwed(tabId, landed)) return;
      owed.set(tabId, landed);
      readOwed(tabId);
    };
    // Whether the read again owed for the tab may still be made: the entry, its session, path and generation as it landed,
    // no edits unsaved
    const stillOwed = (tabId: string, { appSessionId, path, generation }: Landed): boolean => {
      const entry = get().entries.get(tabId);
      return entry !== undefined && entry.appSessionId === appSessionId && entry.path === path && generations.get(tabId) === generation && !unsaved(entry);
    };
    const readOwed = (tabId: string) => {
      const landed = owed.get(tabId);
      if (landed === undefined) return;
      if (!stillOwed(tabId, landed)) return void owed.delete(tabId);
      const entry = get().entries.get(tabId)!;
      if (entry.pending > 0 || waitingOnWatch(tabId) || entry.retrying) return; // kept: asked again when that read ends
      owed.delete(tabId);
      if (mounted.get(tabId)) void readAgainGuarded(tabId, entry, () => stillOwed(tabId, landed));
      else if (!stale.has(tabId)) stale.set(tabId, 'revisit');
    };

    // U6e (decision 19): the entry's mark has just changed (the tab's own, or a person's open taking the agent's back): a
    // read in flight under the other mark is superseded, since its admission differs (one still opening is opened again),
    // and a failed or named entry is read again under the new one; unsaved edits stand. True when it read.
    const readUnderMark = (tabId: string, entry: ViewerEntry): boolean => {
      if (unsaved(entry)) return false;
      if (entry.status === 'loading') void load(tabId, 'open', 'revisit');
      else if (entry.status === 'error' || entry.named || entry.pending > 0) readAgain(tabId, entry, 'revisit');
      else return false;
      return true;
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
      let asked = 0;
      // U6b-4c: the number drawn as the read is sent, after any wait for a follow
      const answer = await readChunk(entry, 0, FILES_READ_MAX_LENGTH, true, () => void (asked = ++lastAsk));
      if (!current()) return false;
      if (generations.get(tabId) !== generation) {
        patch(tabId, { saving: false });
        return true;
      }
      if (!answer.ok) {
        // U6e (decision 18): an outside file's conflict read refused says the way on, as its save's refusal does
        patch(tabId, { saving: false, ...saveFailureOf(answer.error, entry.pin !== null) });
        return true;
      }
      const read = answer.value;
      admit(tabId, asked, read);
      const { real } = admissionOf(read);
      const file: LoadedFile = {
        kind: kindOf({ name: entry.path, mime: read.mime, bytes: read.bytes, encoding: read.encoding }), mime: read.mime, encoding: read.encoding, bytes: read.bytes,
        text: read.content, base64: null, loaded: read.length, complete: !read.truncated, hash: read.hash, utf8: read.utf8, real,
      };
      // U6c (Decision Log 15 e): the answer's `named` is the entry's, the document standing. U6e (decision 6, W3): its
      // admission set above, by the order; the pin moves by `pinAfter`, so a swap the read meets leaves the pin the save
      // then sends.
      const shown = get().entries.get(tabId)!;
      const pin = pinAfter(shown, real);
      const naming = { pin, editable: editableWith(shown, pin) };
      if (file.hash !== null && file.hash === shown.hash) {
        patch(tabId, { saving: false, theirs: null, diskUnusable: null, ...naming });
        return true;
      }
      // A file that is no longer a text the editor could take (grown past its cap, binary, not UTF-8) is not offered;
      // the bar says why (E11 W-D), and a theirs shown earlier is withdrawn, the disk no longer holding it (W-D review I1).
      patch(
        tabId,
        isEditable(file)
          ? { saving: false, theirs: { text: file.text, hash: file.hash!, view: 'merge', real }, diskUnusable: null, ...naming }
          : { saving: false, saveError: EDITOR_COPY.conflictOnSave, saveSaid: false, theirs: null, diskUnusable: unusableReason(file), ...naming },
      );
      return true;
    };

    return {
      entries: new Map(),
      wrap: false,

      mount(tabId, { appSessionId, path, line, readOnly = false, artifact, agent = false }) {
        used.set(tabId, ++clock);
        if (!unsubscribe) unsubscribe = useLayout.subscribe((state, prev) => state.main !== prev.main && prune());
        if (!unfollowStanding) unfollowStanding = useMachines.subscribe(followStanding);
        const entry = get().entries.get(tabId);
        const source = artifact ?? null;
        // U6e (decision 19): the mount reads as the agent's when the tab holds the agent's mark or the agent's show drew it
        // (the one carrier of a show: `agentShowed`); every fresh read below asks with it
        const byAgent = shownByAgent.delete(tabId);
        const asAgent = agent || byAgent;
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
          patch(tabId, { appSessionId, agent: asAgent, ...(line !== entry.line ? { line, pendingJump: line } : {}) });
          tabMarks.set(tabId, agent);
          watchThenRead('change');
        } else if (!entry || entry.appSessionId !== appSessionId || entry.path !== path || entry.readOnly !== readOnly || !sameSource(entry.artifact, source)) {
          dropFrame(tabId, true); // UX wave U6b-2: the entry replaced gives its token up, and its ask goes on alone
          holds.get(tabId)?.release();
          views.delete(tabId);
          stale.delete(tabId);
          supersede(tabId); // an older load lands nowhere
          const fresh: ViewerEntry = {
            tabId, appSessionId, artifact: source, path, status: 'loading', error: null, failure: null, retrying: false, said: false, needsOpen: false, offersOpenFile: false, kind: null, mime: '', encoding: 'utf8', bytes: 0, loaded: 0, complete: false,
            text: '', epoch: (entry?.epoch ?? 0) + 1, base64: null, removed: false, updated: 0, sourceView: false, line, pendingJump: line, loadingMore: false,
            hash: null, editable: false, dirty: false, saving: false, saveError: null, saveSaid: false, theirs: null, diskUnusable: null, baseline: 0, loads: 0, pending: 0, readOnly, named: false,
            locked: null, pin: null, agent: asAgent, textEditable: false, frame: null,
          };
          incarnations.set(tabId, ++lastIncarnation);
          admittedAt.delete(tabId); // U6e: a new incarnation's admission is its own reads' alone
          tabMarks.set(tabId, agent);
          set((s) => ({ entries: new Map(s.entries).set(tabId, fresh) }));
          watchThenRead('open');
        } else {
          const moved = line !== entry.line;
          // the agent's show of an entry that is there reads nothing new and leaves its mark as it is; the tab's own mark
          // changing (a keep, an open that marks or unmarks the tab) reads again under it, unless the open already gave the
          // entry that mark (`revisit`). Only a change of the tab's own mark counts: an entry the agent's show read as the
          // agent's under a tab of the person's stays the agent's when the show moves its line (a person's open takes it back)
          const marked = !byAgent && agent !== (tabMarks.get(tabId) ?? entry.agent) && agent !== entry.agent;
          tabMarks.set(tabId, agent);
          if (moved) patch(tabId, { line, pendingJump: line, ...(line !== null && entry.kind === 'markdown' ? { sourceView: true } : {}) });
          if (marked) patch(tabId, { agent });
          // a re-read an event left for the next showing, or (U6c) a failed or named entry shown again. U6e (decision 19):
          // not for a line moved under a view that stays mounted (a person's open reads through `revisit`), nor for a view
          // the agent's show drew again (it reads nothing new); and again when the agent's mark changes, a read in flight
          // under the other mark superseded, since its admission differs (one still opening is opened again)
          const left = stale.get(tabId);
          stale.delete(tabId);
          if (!(marked && readUnderMark(tabId, entry))) {
            if (left !== undefined) readAgain(tabId, entry, left);
            else if (!marked && !moved && !byAgent && revisitable(entry)) readAgain(tabId, entry, 'revisit');
            // UX wave U6b-2 (event M): a row for a daemon that could not serve a frame asks again each time it is shown
            else if (entry.frame?.status === 'row' && entry.frame.why === 'unserved') ask(tabId);
          }
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
        let asked = 0;
        let carried = false; // U6f (fix wave, finding 6)
        let noted = 0; // U6b-4c (W1 g)
        const sent = (linked: number) => {
          asked = ++lastAsk;
          carried = opensThere(entry);
          noted = linked;
        };
        void readChunk(entry, entry.loaded, length, false, sent).then((next) => {
          // A newer load, or one that replaced the text this read continues, superseded it and cleared `loadingMore`.
          if (generations.get(tabId) !== generation || get().entries.get(tabId)?.epoch !== entry.epoch) return;
          if (!next.ok) {
            fail(tabId, next.error, 'open', false, carried);
            if (generation !== undefined) void readAfterFollows(tabId, { appSessionId: entry.appSessionId, path: entry.path, generation, noted }); // U6b-4c
            return;
          }
          // U6e (decision 6): the answer's admission by the order; the pin moves by the document and dirty rule
          admit(tabId, asked, next.value);
          const current = get().entries.get(tabId)!;
          const pin = pinAfter(current, admissionOf(next.value).real);
          patch(tabId, { text: current.text + next.value.content, loaded: next.value.offset + next.value.length, loadingMore: false, pin, editable: editableWith(current, pin) });
          // U6b-4c (W1 g): landed from a file that may not be saved; a read again covers what Load more reached (a head's extent)
          if (next.value.outside?.writable === false && generation !== undefined) void readAfterFollows(tabId, { appSessionId: entry.appSessionId, path: entry.path, generation, noted });
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
            // The Files store re-watches the directory (the boundary runs again); the file is re-read once that answered, by
            // the read again already waiting on the watch when there is one (the branch review: one read, not two)
            const hold = holds.get(tabId);
            if (!hold || !sameFile(event.path, directory)) continue;
            const waiting = readsAfter.get(hold);
            if (waiting) waiting.invalidated = true;
            else void hold.ready.then(() => holds.get(tabId) === hold && refresh(tabId));
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
        // U6f (W1, R9; decision 14, B9): one whose standing has a sentence for the save on its machine sends nothing, and
        // says the refusal, once
        const refused = refusedSaveThere(entry);
        if (refused !== null) {
          patch(tabId, { saveError: refused, saveSaid: true });
          return 'error';
        }
        const content = documentOf(tabId);
        if (content === undefined) return 'noop';
        const incarnation = incarnations.get(tabId);
        const current = () => incarnations.get(tabId) === incarnation;
        const began = generations.get(tabId); // U6b-4c (the branch panel): the loads issued before the save
        patch(tabId, { saving: true, saveError: null });
        const { appSessionId, path, pin } = entry;
        if (appSessionId === null) return 'noop'; // P3-L: an artifact's file read by the artifact is never written
        // U6e (decision 5): an entry with a pin is saved by the outside save with it, and never by files.write, whatever the
        // answer; a daemon that does not know the command writes nothing and is said so
        const answer =
          pin !== null
            ? await settled(client.invoke('files.writeOutside', { appSessionId, path, content, expectedHash, real: pin, ...opens(entry) }))
            : await settled(client.invoke('files.write', { appSessionId, path, content, expectedHash }));
        if (!current()) return 'noop';
        if (!answer.ok) {
          patch(tabId, { saving: false, ...saveFailureOf(answer.error, pin !== null) });
          return 'error';
        }
        if (answer.value.status === 'conflict') return (await conflicted(tabId, get().entries.get(tabId)!, current)) ? 'conflict' : 'noop';
        // U6b-4c (the branch panel): a load issued since the save began (the tab moved to another session, its read waiting on
        // a follow) is superseded with the rest, since its read may have been sent before the write; it is issued again,
        // after the write, so the tab shows what that load would
        const issuedSince = loadLive(tabId) && generations.get(tabId) !== began;
        supersede(tabId); // a read issued before the write lands nowhere
        moveBaseline(tabId, { text: content, hash: answer.value.hash, saving: false });
        if (issuedSince) refresh(tabId);
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
          text, hash, bytes, loaded: bytes, complete: true, theirs: null, diskUnusable: null, dirty: false, saveError: null, status: 'ready', error: null, failure: null, removed: false, epoch: entry.epoch + 1,
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
        if (entry && entry.saveError !== message) patch(tabId, { saveError: message, saveSaid: false });
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

      revisit(tabId, appSessionId, agent = false) {
        shownByAgent.delete(tabId); // an open: the view reads again as asked
        const entry = get().entries.get(tabId);
        if (!entry || (appSessionId !== undefined && appSessionId !== entry.appSessionId)) return;
        if (entry.agent !== agent) {
          // U6e (decision 19): the open's mark is the entry's now, so a person's open takes back the mark an agent's show
          // gave the entry under a tab of the person's; read again under it now, or at the next mount
          patch(tabId, { agent });
          if (mounted.get(tabId)) readUnderMark(tabId, entry);
          else if (!unsaved(entry) && !stale.has(tabId)) stale.set(tabId, 'revisit');
          return;
        }
        if (!revisitable(entry)) return;
        if (mounted.get(tabId)) readAgain(tabId, entry, 'revisit');
        else if (!stale.has(tabId)) stale.set(tabId, 'revisit'); // read when next shown; an event's re-read already waiting stays one
      },

      agentShowed(tabId, appSessionId) {
        // A view drawn now under the same session is not drawn again, so there is no mount to carry the show to
        if (!mounted.get(tabId) || get().entries.get(tabId)?.appSessionId !== appSessionId) shownByAgent.add(tabId);
      },

      readAdmission(appSessionId, real) {
        for (const entry of get().entries.values()) {
          if (entry.appSessionId !== appSessionId || entry.pin !== real || entry.artifact) continue;
          const { tabId, path, pin, agent } = entry;
          // It lands only on the entry it was asked for (its incarnation, its loads' generation, its session, path, pin and
          // mark as they were), and there by the order of `admit`: an answer of a read sent later wins, whenever it lands.
          const target = { incarnation: incarnations.get(tabId), generation: generations.get(tabId) };
          let asked = 0; // U6b-4c: drawn as the read is sent, after any wait for a follow
          void readChunk(entry, 0, 1, false, () => void (asked = ++lastAsk)).then((answer) => {
            const now = get().entries.get(tabId);
            const same =
              now !== undefined && incarnations.get(tabId) === target.incarnation && generations.get(tabId) === target.generation &&
              now.appSessionId === appSessionId && now.path === path && now.pin === pin && now.agent === agent;
            if (same && answer.ok) admit(tabId, asked, answer.value); // a refusal sets nothing, and records nothing
          });
        }
      },

      prune,

      holdKey(key) {
        held.add(key);
      },

      // UX wave U6b-2 (event F): main says a read for this token failed. Only the entry that holds it, or whose row came
      // from it, hears it; the token is released, and nothing reads again by itself.
      frameFailed(token) {
        for (const [tabId, { frame }] of get().entries) {
          if (frame?.status === 'asking' && frame.shown?.token === token) {
            patch(tabId, { frame: { status: 'asking', shown: null } }); // the ask goes on, nothing drawn meanwhile
            release(token);
          } else if (frame?.status === 'ready' && frame.token === token) {
            patch(tabId, { frame: { status: 'failed' } });
            release(token);
          } else if (frame?.status === 'row' && frame.why === 'unplayable' && frame.from === token) {
            patch(tabId, { frame: { status: 'failed' } }); // its token went with the media error
          }
        }
      },

      // UX wave U6b-2 (event U; M5, decision 7): the media element reported an error. A drawn frame turns into its row and
      // releases its token, remembering which it was, so a failure main tells for it afterwards is still heard.
      frameUnplayable(tabId) {
        const frame = get().entries.get(tabId)?.frame;
        if (frame?.status !== 'ready') return;
        patch(tabId, { frame: { status: 'row', why: 'unplayable', from: frame.token } });
        release(frame.token);
      },

      // UX wave U6b-2 (M5, decision 3; L7): the failure body's button, the same act as showing the tab again.
      openAgain(tabId) {
        const entry = get().entries.get(tabId);
        if (entry && revisitable(entry)) readAgain(tabId, entry, 'revisit');
      },

      openProtected(tabId) {
        const entry = get().entries.get(tabId);
        if (!entry?.needsOpen || entry.appSessionId === null || entry.pending > 0 || pressedOpen.has(tabId)) return;
        openedThere(machineOf(entry.appSessionId)).add(entry.path);
        pressedOpen.add(tabId);
        readAgain(tabId, entry, 'revisit');
      },

      canRetry,

      // An errored entry is read as showing its tab again reads it (its watch taken again, then the read), and one with
      // unsaved edits by the `change` load (`reasonOf`), under which the document and its baseline stand; the guard is the
      // entry incarnation's, so a tab closed or replaced meanwhile keeps nothing of it.
      retry(tabId) {
        const entry = get().entries.get(tabId);
        if (!entry || !canRetry(entry)) return;
        void readAgainGuarded(tabId, entry); // the guard, and what the press found asked again before the read
      },

      reset() {
        for (const entry of get().entries.values()) release(heldToken(entry.frame)); // UX wave U6b-2 (M5, decision 10)
        asks.clear(); // the store forgets everything (tests, a hot reload): an answer still out finds no slot and is released
        shownByAgent.clear();
        tabMarks.clear();
        admittedAt.clear();
        for (const hold of holds.values()) hold.release();
        holds.clear();
        generations.clear();
        incarnations.clear();
        mounted.clear();
        stale.clear();
        loading.clear(); // UX wave U6b-4c
        used.clear();
        held.clear();
        views.clear();
        pressedOpen.clear();
        guards.clear(); // UX wave U6b-4c
        owed.clear();
        unsubscribe?.();
        unsubscribe = null;
        unfollowStanding?.();
        unfollowStanding = null;
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
