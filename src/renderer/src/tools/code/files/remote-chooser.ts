// The chooser for a session on another machine, its model (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; decisions 7, 8, 17 and 18; Cards 1
// to 3 as the owner answered them; sequences C1 to C3 and C5). A state machine apart from its sheet, with no DOM: it reads
// one folder at a time from that machine (`files.listOutside`, one page of 200 names, More… for the next) and asks the
// machine to choose the file picked (`files.chooseOutside`, which its daemon records as a grant and answers with the real
// path the tab opens). It is the one place of the window that issues either command.
//
// - Order: one ask at a time is the newest. Every listing and choice draws a number when it is sent, and only the newest
//   one's answer lands (C1); after Cancel nothing lands and nothing is asked (C3).
// - A listing that never answers says so at the pending bound, the one an act gets, with Try again (C2); one the link
//   could not carry says the machine is not reachable (C5). Every refusal in UC-7's words stands as main worded it.
// - A private folder asks first (`asking`): the person's Open sends the listing or the choice again with `open: true` and
//   adds the folder to what was opened there (`openedThere`), so every path under it carries `open` after, a tab's
//   reads and saves included. A folder the walk ended at through a link joins it too.
// - A typed path is listed first and, where it names a file, selected in its parent's listing; a link is chosen as a file
//   and, where its target is a folder, that folder is listed (the walk's real path then stands in the path field).
// - It starts in the folder last shown on that machine this run, else the home (Card 2); the daemon lists every name,
//   dot names after the others of their kind (Card 3), and nothing here hides them.
// - Fix wave (the review's findings 2 to 5): the offer is asked again before every request (`unoffered`), and once
//   withdrawn (`withdraw`, the sheet hearing the ownership go) nothing more is sent. What a request that carried `open`
//   reached is what the person opened: the folder a listing ended at, the real path a choice was granted. The private
//   folder's question invalidates whatever was still asked for the listing behind it. A typed file is looked for page by
//   page in its parent, until found or the listing ends.
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { OutsideEntry } from '@shared/ipc/schema/files';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import { ipc } from '../../../ipc/client';
import { REMOTE_CHOOSER_COPY } from '../copy';
import { openedThere } from './elsewhere';

export type ChooserState =
  | { at: 'reading'; path: string | null }
  | { at: 'listed'; path: string; parent: string | null; home: string; entries: OutsideEntry[]; cursor: string | null; selected: string | null }
  | { at: 'asking'; folder: OutsideEntry } // a private folder's confirmation
  | { at: 'failed'; path: string | null; words: string } // with Try again
  | { at: 'choosing'; path: string };

export interface RemoteChooser {
  state(): ChooserState;
  subscribe(listener: () => void): () => void;
  enter(entry: OutsideEntry): void;
  up(): void;
  go(path: string): void;
  more(): void;
  select(path: string): void;
  confirm(): void;
  back(): void;
  choose(): Promise<string | null>; // the granted real path, or null
  retry(): void;
  cancel(): void;
  withdraw(words: string): void; // the offer is gone: the sentence stands where the list stood, and nothing more is sent
}

export type ListInput = { appSessionId: AppSessionId; path?: string; open?: true; cursor?: string };
export type ChooseInput = { appSessionId: AppSessionId; path: string; open?: true };
export interface ChooserDeps {
  list(input: ListInput): Promise<CommandResult<'files.listOutside'>>;
  choose(input: ChooseInput): Promise<CommandResult<'files.chooseOutside'>>;
  machine(): string; // the machine's name, for the sentences
  unoffered?(): string | null; // the sentence the two acts are not offered with now (the ownership row); null: offered
  startAt: string | null; // null: the home
}

type Failure = { code: string; message: string; issues?: unknown };
type Listing = { path: string | null; cursor?: string; typed?: boolean; select?: string; open?: boolean };

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path;
// The folder a path names its parent by its text alone, for ".." while a folder is read or failed: none at the root, at
// the home's `~` or with no path.
const textualParent = (path: string | null): string | null => {
  if (path === null || path === '/' || path === '~') return null;
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const cut = trimmed.lastIndexOf('/');
  return cut < 0 ? null : cut === 0 ? '/' : trimmed.slice(0, cut);
};

/** Where ".." leads from the state: the listing's parent, else the parent of the path asked; null where none is known. */
export function parentOf(state: ChooserState): string | null {
  if (state.at === 'listed') return state.parent;
  if (state.at === 'reading' || state.at === 'failed') return textualParent(state.path);
  return null;
}

const refusalOf = (error: Failure): string | null => {
  const issues = error.issues as { refusal?: unknown } | undefined;
  return typeof issues?.refusal === 'string' ? issues.refusal : null;
};

// The last folder shown on each machine this run (Card 2), in memory alone.
const lastShown = new Map<MachineRef, string>();

/** Where the chooser starts on `machine`: the folder last shown there this run; null, the home. */
export function startOf(machine: MachineRef): string | null {
  return lastShown.get(machine) ?? null;
}

/** Tests: forget where the chooser was on every machine. */
export function forgetStarts(): void {
  lastShown.clear();
}

/** The two commands, as the window sends them to main (the chooser's own; no other source names them). */
export function chooserCalls(client: MawsBridge = ipc): Pick<ChooserDeps, 'list' | 'choose'> {
  return { list: (input) => client.invoke('files.listOutside', input), choose: (input) => client.invoke('files.chooseOutside', input) };
}

export function createRemoteChooser(appSessionId: AppSessionId, deps: ChooserDeps): RemoteChooser {
  const machine = machineOf(appSessionId);
  const opened = openedThere(machine);
  const listeners = new Set<() => void>();
  let state: ChooserState = { at: 'reading', path: deps.startAt };
  let newest = 0; // the number of the newest ask
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown: Extract<ChooserState, { at: 'listed' }> | null = null; // the last listing, which Back returns to
  let confirmed: (() => void) | null = null; // what the private folder's Open goes on to
  let declined: (() => void) | null = null; // and its Back
  let choice: ((path: string | null) => void) | null = null; // the open choice's answer
  let withdrawn: string | null = null; // the offer's sentence once it went: nothing more is sent

  const set = (next: ChooserState) => {
    if (closed) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const stopTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const answerChoice = (path: string | null) => {
    const resolve = choice;
    choice = null;
    resolve?.(path);
  };
  const words = (error: Failure): string =>
    refusalOf(error) !== null ? error.message : error.code === 'host_unavailable' ? REMOTE_CHOOSER_COPY.unreachable(deps.machine()) : error.code === 'timeout' ? REMOTE_CHOOSER_COPY.noAnswer(deps.machine()) : error.message;
  const opens = (path: string | null, asked: boolean | undefined) => asked === true || (path !== null && opened.has(path));
  const asking = (folder: OutsideEntry, onOpen: () => void, onBack: () => void) => {
    newest += 1; // C1: what was still asked for the listing behind the question lands nowhere, its bound included
    stopTimer();
    confirmed = onOpen;
    declined = onBack;
    set({ at: 'asking', folder });
  };
  const selectable = (entry: OutsideEntry) => entry.kind === 'file' || entry.kind === 'link';
  const backToShown = () => (shown !== null ? set(shown) : list({ path: null }));
  // A call that throws or rejects answers as a failure of its own; it is sent at once, so the ask is out when it returns.
  const settled = <T>(call: () => Promise<T>, failed: (error: Failure) => T): Promise<T> => {
    const failure = (error: unknown) => failed({ code: 'internal', message: error instanceof Error ? error.message : String(error) });
    try {
      return call().catch(failure);
    } catch (error) {
      return Promise.resolve(failure(error));
    }
  };

  // The folder the list's place stands for: the one shown, read or failed, else the listing behind a question or a choice.
  const standingPath = (): string | null => (state.at === 'listed' || state.at === 'reading' || state.at === 'failed' ? state.path : (shown?.path ?? null));
  // The offer gone: its sentence where the list stands, whatever was asked landing nowhere, and nothing sent after.
  const stopOffer = (words: string) => {
    const path = standingPath();
    withdrawn = words;
    newest += 1;
    stopTimer();
    answerChoice(null);
    set({ at: 'failed', path, words });
  };
  // Before a request: the offer as it stands now; true when it is not offered, so nothing is sent.
  const refusedNow = (): boolean => {
    if (withdrawn !== null) return true;
    const words = deps.unoffered?.() ?? null;
    if (words !== null) stopOffer(words);
    return words !== null;
  };

  function list(how: Listing): void {
    if (closed || refusedNow()) return;
    const ask = ++newest;
    stopTimer();
    if (how.cursor === undefined) set({ at: 'reading', path: how.path });
    // C2: the pending bound an act gets; the ask stays the newest, so its answer still lands when it comes
    timer = setTimeout(() => {
      timer = null;
      if (ask === newest) set({ at: 'failed', path: how.path, words: REMOTE_CHOOSER_COPY.noAnswer(deps.machine()) });
    }, REMOTE_ACT_PENDING_MS);
    const input: ListInput = { appSessionId, ...(how.path !== null && { path: how.path }), ...(opens(how.path, how.open) && { open: true as const }), ...(how.cursor !== undefined && { cursor: how.cursor }) };
    void settled(() => deps.list(input), (error): CommandResult<'files.listOutside'> => ({ ok: false, error: error as never })).then((answer) => listed(ask, how, input, answer));
  }

  function listed(ask: number, how: Listing, input: ListInput, answer: CommandResult<'files.listOutside'>): void {
    if (closed || ask !== newest) return; // C1: an ask no longer the newest lands nowhere
    stopTimer();
    if (!answer.ok) return set({ at: 'failed', path: how.path, words: words(answer.error) });
    const value = answer.value;
    if (value.status === 'refused') {
      const at = how.path ?? '~';
      switch (value.reason) {
        case 'protected': // a path into a private folder (typed, or a link's target): asked as that folder is
          return asking(
            { name: basename(at), path: at, kind: 'dir', protected: true },
            () => {
              opened.add(at);
              list({ ...how, open: true });
            },
            backToShown,
          );
        case 'unreadable':
          return set({ at: 'failed', path: how.path, words: REMOTE_CHOOSER_COPY.unreadable(deps.machine()) });
        case 'not-a-folder': {
          const parent = textualParent(how.path);
          if (how.typed === true && parent !== null) return list({ path: parent, select: basename(at), open: how.open });
          return set({ at: 'failed', path: how.path, words: REMOTE_CHOOSER_COPY.nothingThere(deps.machine()) });
        }
        default:
          return set({ at: 'failed', path: how.path, words: REMOTE_CHOOSER_COPY.nothingThere(deps.machine()) });
      }
    }
    if (input.open === true) opened.add(value.path); // the folder the walk ended at, the request having carried open
    lastShown.set(machine, value.path);
    const more = how.cursor !== undefined && state.at === 'listed' && state.path === value.path ? state : null;
    const entries = more ? [...more.entries, ...value.entries] : value.entries;
    const picked = how.select === undefined ? null : (entries.find((entry) => entry.name === how.select && selectable(entry))?.path ?? null);
    const next: Extract<ChooserState, { at: 'listed' }> = { at: 'listed', path: value.path, parent: value.parent, home: value.home, entries, cursor: value.cursor, selected: (more ? more.selected : null) ?? picked };
    shown = next;
    set(next);
    // a typed file not on this page: the next one is read for it, until it is found or the listing ends
    if (how.select !== undefined && picked === null && value.cursor !== null) list({ path: value.path, cursor: value.cursor, select: how.select, open: how.open });
  }

  function choose(entry: OutsideEntry, open: boolean, from: Extract<ChooserState, { at: 'listed' }>): void {
    if (refusedNow()) return;
    const ask = ++newest;
    stopTimer();
    set({ at: 'choosing', path: entry.path });
    const input: ChooseInput = { appSessionId, path: entry.path, ...(opens(entry.path, open) && { open: true as const }) };
    void settled(() => deps.choose(input), (error): CommandResult<'files.chooseOutside'> => ({ ok: false, error: error as never })).then((answer) => {
      if (closed || ask !== newest) return;
      if (!answer.ok) {
        answerChoice(null);
        return set({ at: 'failed', path: from.path, words: words(answer.error) });
      }
      const value = answer.value;
      if (value.status === 'granted') {
        if (input.open === true) opened.add(value.path); // the real path the person opened, which the tab then reads
        return answerChoice(value.path);
      }
      switch (value.reason) {
        case 'protected': // a link whose target lies in a private folder: asked as that folder is, then chosen again
          return asking(
            entry,
            () => {
              opened.add(entry.path);
              choose(entry, true, from);
            },
            () => {
              answerChoice(null);
              set(from);
            },
          );
        case 'not-a-file':
          answerChoice(null);
          // a link that leads to a folder: that folder is shown; any other row cannot be opened here
          if (entry.kind === 'link') return list({ path: entry.path, open });
          return set({ at: 'failed', path: from.path, words: REMOTE_CHOOSER_COPY.notAFile });
        default:
          answerChoice(null);
          return set({ at: 'failed', path: from.path, words: REMOTE_CHOOSER_COPY.nothingThere(deps.machine()) });
      }
    });
  }

  list({ path: deps.startAt });

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    enter(entry) {
      if (closed || entry.kind !== 'dir' || (state.at !== 'listed' && state.at !== 'reading' && state.at !== 'failed')) return;
      if (entry.protected && !opened.has(entry.path))
        return asking(
          entry,
          () => {
            opened.add(entry.path);
            list({ path: entry.path, open: true });
          },
          backToShown,
        );
      list({ path: entry.path });
    },
    up() {
      if (state.at === 'asking' || state.at === 'choosing') return;
      const parent = parentOf(state);
      if (parent !== null) list({ path: parent });
    },
    go(path) {
      const typed = path.trim();
      if (typed === '' || state.at === 'asking' || state.at === 'choosing') return;
      list({ path: typed, typed: true });
    },
    more() {
      if (state.at !== 'listed' || state.cursor === null) return;
      list({ path: state.path, cursor: state.cursor });
    },
    select(path) {
      if (state.at !== 'listed') return;
      const entry = state.entries.find((candidate) => candidate.path === path);
      if (entry === undefined || !selectable(entry) || state.selected === path) return;
      set({ ...state, selected: path });
    },
    confirm() {
      if (state.at !== 'asking' || confirmed === null) return;
      const next = confirmed;
      confirmed = declined = null;
      next();
    },
    back() {
      if (state.at !== 'asking' || declined === null) return;
      const next = declined;
      confirmed = declined = null;
      next();
    },
    choose() {
      if (closed || state.at !== 'listed' || state.selected === null || choice !== null) return Promise.resolve(null);
      const from = state;
      const entry = from.entries.find((candidate) => candidate.path === from.selected)!;
      return new Promise<string | null>((resolve) => {
        choice = resolve;
        choose(entry, false, from);
      });
    },
    // Try again, and the sheet's own ask when the link drops under a listing (C5): the folder in the path field, read again
    retry() {
      if (state.at === 'failed' || state.at === 'listed') list({ path: state.path });
    },
    cancel() {
      stopTimer();
      answerChoice(null);
      closed = true;
      listeners.clear();
    },
    withdraw(words) {
      if (!closed && withdrawn === null) stopOffer(words);
    },
  };
}
