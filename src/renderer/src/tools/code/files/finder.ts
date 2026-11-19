// Go to file (UX wave U6b-3b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, Interfaces §A and §C; M1).
//
// The action (decision 11; R5): `files.goToFile` (Go ▸ Go to file, ⌘P, the palette's row) is registered exactly while it
// can end with the keyboard in Files' field: the side column has a session, neither the Settings dialog nor the Overview
// is open, and no modal keeps the keyboard (Decision Log 16: a modal that holds nothing a person would lose, the Command
// palette or Keyboard shortcuts, lends itself; every other keeps it while open, `keymap/modal-handoff.ts`). Its handler,
// with the keyboard in a modal that lends itself, closes that modal and runs again from its close, from the modal's
// opener, by every route alike (the menu, its key, the palette's row). Then it leaves an open page (root UC-12), records
// where the keyboard is (for Esc's second step), shows the session's Files (`showFiles`, which shows a hidden or collapsed
// column), marks the tab it lands in as finding (decision 9: that tab draws the tree column for the search, whatever its
// fold) and asks for the keyboard for that tab's field.
//
// The request for the keyboard (decision 10; sequence S2): one at most, for a taker that may not be drawn yet. A drawn
// taker is told at once (`useKeyboardRequest`), one drawn later takes it when it draws (`takeKeyboard`, true once). The
// person's next key or pointer press anywhere drops it, so the keyboard stays where that act put it; the menu's own key
// reaches the page before the action runs, so the press that made the request is never heard. M1 builds the field's
// taker; a file's view is M2's, on the same request (`viewer/FileViewer.tsx`).
//
// The search (M2; decisions 1 to 5, 8 and 12; sequences S1, S4 and S5): one hook (`useFinder`) owns the states and the
// generation. The text's query (`parseQuery`) is asked of the working folder by `git.lsFiles` 80 ms after the last
// keystroke, at once when the folder, the session or its machine changes; every ask carries the generation current when
// it goes out, and its answer or its failure is taken only while that generation is still the finder's. A held Enter (one
// pressed before the text's answer came) opens only on its own generation's answer. An open filter is asked again (a
// refresh: ⌘P, the field taking the keyboard again, the working folder's status changing its set of entries) at once and
// once more `FINDER_AGAIN_MS` later, past the ten seconds the daemon keeps a folder's list; a refresh that falls while the
// text's own answer is awaited is owed and issued when that answer settles. Enter opens the highlighted file as a kept tab
// and asks the keyboard for it by its key (the request's `file` half), which the file's view takes wherever it is drawn.
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { disabledWords } from '@shared/ipc/remote-unavailable';
import type { MachineRef } from '@shared/machine/ref';
import { shellGeometryOf } from '../../../app/shell-view';
import { ipc } from '../../../ipc/client';
import { checkoutKey, machineFor, pathTarget } from '../../../ipc/machine';
import { registerAction } from '../../../keymap/actions-runtime';
import { handOffModal, modalKeepsKeyboard, subscribeModalKeyboard } from '../../../keymap/modal-handoff';
import { useRemoteStanding } from '../../../lane-b/remote-standing';
import { surfaceSession } from '../../../panel/surface-model';
import { useGit } from '../../../stores/git';
import { pageOpen, useLayout, type LayoutState } from '../../../stores/layout';
import { FILES_COPY } from '../copy';
import { openFile, type Opened } from '../open-file';
import { statusSet } from './changed';
import { fileKey, showFiles } from './tabs';
import { useTreeState } from './tree-state';

// ---- the request for the keyboard ---------------------------------------------------------------------------------------

// UX wave U6b-5a (M1, decision 4): `tree`, a Files tab's tree, which a surface's key asks for and whose rows are drawn only
// once the list has measured itself.
export type KeyboardRequest = { into: 'filter'; tabId: string } | { into: 'file'; key: string } | { into: 'tree'; tabId: string };

const takerOf = (request: KeyboardRequest): string => (request.into === 'file' ? `file\n${request.key}` : `${request.into}\n${request.tabId}`);

let pending: { taker: string; made: number } | null = null;
let made = 0;
const takers = new Set<() => void>();
const tell = () => takers.forEach((taker) => taker());

// Ends the waiting request and takes down its pair of capture listeners on the window.
function end(): void {
  pending = null;
  window.removeEventListener('keydown', drop, true);
  window.removeEventListener('pointerdown', drop, true);
  tell();
}
function drop(): void {
  if (pending !== null) end();
}

/** Replaces any earlier request; the next keydown or pointerdown anywhere drops it. Answers the request's number. */
export function requestKeyboard(request: KeyboardRequest): number {
  made += 1;
  pending = { taker: takerOf(request), made };
  window.addEventListener('keydown', drop, true);
  window.addEventListener('pointerdown', drop, true);
  tell();
  return made;
}

/** UX wave U6b-5a: ends the request of this number while it still waits (the showing that made it has ended). */
export function withdrawKeyboard(number: number): void {
  if (pending?.made === number) end();
}

/** True once, for the taker the waiting request names; false for any other, and while none waits. */
export function takeKeyboard(request: KeyboardRequest): boolean {
  if (pending?.taker !== takerOf(request)) return false;
  end();
  return true;
}

const subscribe = (taker: () => void) => {
  takers.add(taker);
  return () => void takers.delete(taker);
};

/** Changes when a request for this taker is made (0 while none waits for it), so a drawn taker runs its effect. */
export function useKeyboardRequest(request: KeyboardRequest | null): number {
  const taker = request === null ? null : takerOf(request);
  return useSyncExternalStore(subscribe, () => (pending !== null && pending.taker === taker ? pending.made : 0));
}

// ---- where the keyboard was when ⌘P was pressed (Esc's second step) -----------------------------------------------------

const FILTER_SELECTOR = '[data-files-filter]'; // the field's marker (Interfaces §A)
let before: HTMLElement | null = null;

// M1 decision 2 and S2: never the page's body (nothing held it), and never a field of Go to file (⌘P pressed again from
// the field keeps the element the first press found).
function recordKeyboard(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body || active.matches(FILTER_SELECTOR)) return;
  before = active;
}

/** Esc in an empty field: the element ⌘P found the keyboard in, once, while it is in the page; else null. */
export function keyboardBefore(): HTMLElement | null {
  const element = before;
  before = null;
  return element?.isConnected ? element : null;
}

// ---- the action -------------------------------------------------------------------------------------------------------

/** Decision 11 (R5): a session for the side column, no Settings dialog, no Overview; and no modal keeps the keyboard (Decision Log 16). */
export function canGoToFile(state: LayoutState): boolean {
  return surfaceSession(state) !== null && state.settings === null && !state.overviewOpen && !modalKeepsKeyboard();
}

/** The handler: a modal that lends itself closed first; the page left, the keyboard's place recorded, Files shown, its tab finding, the request for its field. */
export function goToFile(): void {
  const state = useLayout.getState();
  if (!canGoToFile(state) || handOffModal(goToFile)) return;
  const session = surfaceSession(state)!;
  if (pageOpen(state)) state.closeDestination();
  recordKeyboard();
  const tabId = showFiles(session);
  useTreeState.getState().setFinding(session, tabId);
  requestKeyboard({ into: 'filter', tabId });
}

/** Keeps `files.goToFile` registered while `canGoToFile` holds; returns its removal. */
export function connectGoToFile(): () => void {
  let unregister: (() => void) | null = null;
  const sync = () => {
    const can = canGoToFile(useLayout.getState());
    if (can && unregister === null) unregister = registerAction('files.goToFile', goToFile);
    else if (!can && unregister !== null) {
      unregister();
      unregister = null;
    }
  };
  sync();
  // the side column's session, the dialog and the Overview; a modal that keeps the keyboard
  const offs = [useLayout.subscribe(sync), subscribeModalKeyboard(sync)];
  return () => {
    offs.forEach((off) => off());
    unregister?.();
    unregister = null;
  };
}

// ---- the search (M2) ----------------------------------------------------------------------------------------------------

export const FINDER_ASK = 200; // git.lsFiles' limit, the command's most
export const FINDER_LIMIT = 50; // the files shown
export const FINDER_WAIT_MS = 80; // after the last keystroke, the `@` menu's
export const FINDER_AGAIN_MS = 10_500; // a refresh's later ask: just past the ten seconds the daemon keeps a folder's list (CACHE_MS, src/services/git/ls-files.ts)
const QUERY_MAX = 256; // the schema's bound on git.lsFiles' query

// A trailing `:<digits>`, or `:<digits>:<digits>` (a column, read and dropped).
const LINE_AT_END = /:(\d+)(?::\d+)?$/;

/** Decision 2: the query, and the line a trailing `:<digits>` names (at least 1); with nothing before it, the whole text is the query. */
export function parseQuery(text: string): { query: string; line: number | null } {
  const found = LINE_AT_END.exec(text);
  if (found === null || found.index === 0) return { query: text.slice(0, QUERY_MAX), line: null };
  const line = Math.min(Math.max(1, Number(found[1])), Number.MAX_SAFE_INTEGER);
  return { query: text.slice(0, found.index).slice(0, QUERY_MAX), line };
}

/** S1's states. `rows` and `shown` are absolute paths: the working folder's path joined with the answer's. */
export type FinderState =
  | { status: 'empty' }
  | { status: 'waiting'; shown: readonly string[] | null; held: boolean }
  | { status: 'answered'; rows: readonly string[]; at: number; refreshing: boolean }
  | { status: 'failed' }
  | { status: 'offline'; words: string };

export interface Finder {
  state: FinderState;
  onKey(event: KeyboardEvent<HTMLInputElement>): void; // decision 5: ↓ and ↑, Enter
  choose(index: number, how: { keep: boolean; main: boolean }): Opened | null; // a row opened: Enter keeps; a click as decision 6
  refresh(): void; // decision 8: ⌘P, and the field taking the keyboard again
  left(): void; // the field lost the keyboard: a held Enter ends
}

/** The rows a state draws: an answer's, or the earlier answer's while the text's is awaited; null where none are. */
export function drawnRows(state: FinderState): readonly string[] | null {
  return state.status === 'answered' ? state.rows : state.status === 'waiting' ? state.shown : null;
}

const EMPTY: FinderState = { status: 'empty' };
const KEEP = { keep: true, main: false };

type Answer = { ok: true; rows: string[] } | { ok: false };
type Timer = ReturnType<typeof setTimeout>;

// What the hook is given: the session, its machine, the working folder (null: the window holds no record of it), the
// field's text and, while the session's machine is offline, the words that say so.
interface Inputs {
  appSessionId: AppSessionId;
  machine: MachineRef;
  directory: string | null;
  text: string;
  offline: string | null;
}
const placeOf = (inputs: Inputs) => JSON.stringify([inputs.machine, inputs.appSessionId, inputs.directory]);

// S1 as one object the hook holds for its mount: the generation, the state, what is owed, the two timers.
class Search {
  private state: FinderState = EMPTY;
  private generation = 0;
  private owed = false; // a refresh fell while the text's own answer was awaited
  private wait: Timer | null = null; // the 80 ms after the last keystroke
  private again: Timer | null = null; // a refresh's later ask
  private inputs: Inputs | null = null;
  private seen: { key: string; set: string } | null = null; // the working folder's status set last seen
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly get = (): FinderState => this.state;

  private set(next: FinderState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  // Every ask of an earlier generation is stale from here on; the later ask and anything owed go with it.
  private next(): void {
    this.generation += 1;
    if (this.wait !== null) clearTimeout(this.wait);
    this.wait = null;
    this.dropAgain();
    this.owed = false;
  }
  private dropAgain(): void {
    if (this.again !== null) clearTimeout(this.again);
    this.again = null;
  }

  /** The hook's inputs as they stand after a render. */
  update(inputs: Inputs): void {
    const last = this.inputs;
    this.inputs = inputs;
    if (inputs.text === '') {
      if (last === null || last.text !== '' || this.state.status !== 'empty') this.toEmpty();
      return;
    }
    if (inputs.offline !== null) {
      if (this.state.status === 'offline') {
        if (this.state.words !== inputs.offline) this.set({ status: 'offline', words: inputs.offline });
        return;
      }
      this.next();
      this.set({ status: 'offline', words: inputs.offline });
      return;
    }
    if (last === null || last.offline !== null || placeOf(last) !== placeOf(inputs)) return this.restart();
    if (last.text !== inputs.text) this.typed();
  }

  /** The working folder's status set as the git store holds it now (null: no status); a set that differs from the last one seen is a refresh. */
  statusSeen(key: string | null, set: string | null): void {
    if (key === null || set === null) return;
    const last = this.seen;
    this.seen = { key, set };
    if (last !== null && last.key === key && last.set !== set) this.refresh();
  }

  /** The hook's unmount: nothing asked is taken, no timer runs. */
  stop(): void {
    this.next();
    this.inputs = null;
    this.seen = null;
  }

  private toEmpty(): void {
    this.next();
    this.set(EMPTY);
  }

  // The folder, the session or its machine changed, the link came back, a retry: asked at once, nothing drawn.
  private restart(): void {
    this.next();
    this.set({ status: 'waiting', shown: null, held: false });
    this.send();
  }

  // The text changed: the rows drawn stay while its answer is awaited, asked 80 ms after the last keystroke.
  private typed(): void {
    const drawn = drawnRows(this.state);
    this.next();
    this.set({ status: 'waiting', shown: drawn !== null && drawn.length > 0 ? drawn : null, held: false });
    const generation = this.generation;
    this.wait = setTimeout(() => {
      this.wait = null;
      if (this.generation === generation) this.send();
    }, FINDER_WAIT_MS);
  }

  // One ask of the current generation; its answer or failure is taken only while that generation stands.
  private send(): void {
    const inputs = this.inputs;
    if (inputs === null) return;
    const generation = this.generation;
    const { directory } = inputs;
    if (directory === null) return this.settle(generation, { ok: false }); // no working folder this window knows
    const base = directory.replace(/\/+$/, '');
    void ipc.invoke('git.lsFiles', { directory, query: parseQuery(inputs.text).query, limit: FINDER_ASK }, pathTarget(inputs.machine, inputs.appSessionId)).then(
      (result) => {
        // M2 decision 3: the folders go (a submodule's among them, decision 14), then the cut
        const rows = result.ok ? result.value.paths.filter((path) => !path.endsWith('/')).slice(0, FINDER_LIMIT).map((path) => `${base}/${path}`) : null;
        this.settle(generation, rows === null ? { ok: false } : { ok: true, rows });
      },
      () => this.settle(generation, { ok: false }),
    );
  }

  private settle(generation: number, answer: Answer): void {
    if (generation !== this.generation) return; // an earlier generation's: dropped, a success and a failure alike
    const state = this.state;
    if (state.status === 'waiting') {
      if (answer.ok) {
        this.set({ status: 'answered', rows: answer.rows, at: 0, refreshing: false });
        if (state.held && answer.rows.length > 0) this.open(answer.rows[0], KEEP, true);
      } else this.set({ status: 'failed' });
    } else if (state.status === 'answered' && state.refreshing) {
      if (answer.ok) {
        const at = answer.rows.indexOf(state.rows[state.at]);
        this.set({ status: 'answered', rows: answer.rows, at: Math.max(0, at), refreshing: false });
      } else this.set({ ...state, refreshing: false }); // the drawn rows stay, and nothing is said
    } else return;
    if (!this.owed) return;
    this.owed = false;
    this.refresh(); // in the state reached
  }

  readonly refresh = (): void => {
    const state = this.state;
    if (state.status === 'answered') {
      this.next();
      this.set({ ...state, refreshing: true });
      this.send();
      this.again = setTimeout(() => {
        this.again = null;
        this.due();
      }, FINDER_AGAIN_MS);
    } else if (state.status === 'waiting') this.owed = true; // the text's own ask is on its way, and a held Enter stays bound to it
    else if (state.status === 'failed') this.restart();
  };

  // The later ask: the first ask of a refresh can be answered from a list the daemon loaded before the change; this one cannot.
  private due(): void {
    const state = this.state;
    if (state.status === 'answered') {
      this.next();
      this.set({ ...state, refreshing: true });
      this.send();
    } else if (state.status === 'waiting') this.owed = true;
  }

  readonly onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return; // an input method composes: the key is its own
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const state = this.state;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (state.status === 'answered') {
        event.preventDefault();
        const at = Math.min(Math.max(0, state.at + (event.key === 'ArrowDown' ? 1 : -1)), Math.max(0, state.rows.length - 1));
        if (at !== state.at) this.set({ ...state, at });
      } else if (state.status === 'waiting') {
        event.preventDefault();
        if (state.held) this.set({ ...state, held: false });
      }
      return;
    }
    if (event.key !== 'Enter') return;
    if (state.status === 'answered' && state.rows.length > 0) {
      event.preventDefault();
      this.open(state.rows[state.at], KEEP, true);
    } else if (state.status === 'waiting') {
      event.preventDefault();
      if (!state.held) this.set({ ...state, held: true });
    }
  };

  readonly left = (): void => {
    const state = this.state;
    if (state.status === 'waiting' && state.held) this.set({ ...state, held: false });
  };

  readonly choose = (index: number, how: { keep: boolean; main: boolean }): Opened | null => {
    const path = drawnRows(this.state)?.[index];
    return path === undefined ? null : this.open(path, how, false);
  };

  // M2 decision 6: the open at the text's line, then (Enter's) the request for the keyboard by the file's key, then finding
  // ends (decision 9). Decision Log 15: Enter's open that brings a main-area tab forward while the side column is a sheet
  // over a narrow window collapses the sheet first, so that the tab is on screen and its view takes the keyboard.
  private open(path: string, how: { keep: boolean; main: boolean }, keyboard: boolean): Opened | null {
    const inputs = this.inputs;
    if (inputs === null) return null;
    const opened = openFile(inputs.appSessionId, path, parseQuery(inputs.text).line, how);
    if (keyboard) {
      if (opened?.surface === 'main' && shellGeometryOf(useLayout.getState(), window.innerWidth).sheet) useLayout.getState().setPanel({ collapsed: true });
      requestKeyboard({ into: 'file', key: fileKey(inputs.machine, path) });
    }
    useTreeState.getState().setFinding(inputs.appSessionId, null);
    return opened;
  }
}

/** The search for the field's text in the working folder (`directory`; null while the window holds no record of the session). */
export function useFinder(appSessionId: AppSessionId, directory: string | null, text: string): Finder {
  const machine = machineFor(appSessionId);
  const standing = useRemoteStanding(appSessionId); // a session reached over the link (U9)
  const offline = standing?.phase === 'offline' ? disabledWords('git.lsFiles', standing, FILES_COPY.fileSearch) : null;
  const key = directory === null ? null : checkoutKey(machine, directory);
  // the drawn tree's hold on the git store stands while the list is in its place (M2 decision 4): the hook takes none
  const set = useGit((s) => {
    const status = key === null ? null : s.entries.get(key)?.status;
    return status ? statusSet(status) : null;
  });
  const [search] = useState(() => new Search());
  const state = useSyncExternalStore(search.subscribe, search.get);
  useEffect(() => search.update({ appSessionId, machine, directory, text, offline }), [search, appSessionId, machine, directory, text, offline]);
  useEffect(() => search.statusSeen(key, set), [search, key, set]);
  useEffect(() => () => search.stop(), [search]);
  return { state, onKey: search.onKey, choose: search.choose, refresh: search.refresh, left: search.left };
}
