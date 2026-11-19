// Files' tree at the file's left (UX wave U6b-1, docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, M3
// and Interfaces §C): every Files tab draws the tree in a column at the left of its file, or alone when it holds none,
// and the tree is the session's, not the tab's: one state per session, so two Files tabs of a session cannot disagree.
//
// Where the tree goes in a tab is one pure function (`treePlace`), written for the owner's answer on card R8 (Decision Log
// 15, "In the file's place"): beside the file while the tab has room for both (unless the person folded it), and in a tab
// too narrow for both folded away, its button in the file's bar showing it in the file's place until a file is chosen or
// the button is pressed again.
//
// The state: what is stored (the width, null for the default; the fold; the folders open, oldest opened first) and what
// lasts this run only (the selection, the scroll offset, the first root opened once). Read once through `layout.get` at
// first use and written through `layout.set` 250 ms after a person's last act and at once when the page unloads, as
// `stores/people.ts` keeps `sidebar.people`: an absent, invalid or refused value is every session's defaults; an act before
// the read answered is drawn at once and applied over what the read brings, and nothing is written until the read lands.
// A write holds the 200 folders opened last of each session, and drops a session the window no longer knows. The first
// root's own opening is not a person's act and writes nothing; after a relaunch a stored session's first root is only
// noted, so a deliberate collapse stands.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { FILES_TREE_EXPANDED_MAX, FilesTreeSchema, type FilesTree } from '@shared/ipc/schema/layout';
import { isAddress, machineOf } from '@shared/machine/address';
import { ipc } from '../../../ipc/client';
import { useMachines } from '../../../stores/machines';
import { useSetup } from '../../../sessions/store';
import { useSessions } from '../../../stores/sessions';

export const FILES_TREE_KEY = 'files.tree';
export const TREE_WRITE_DELAY_MS = 250;
export const TREE_WIDTH_DEFAULT = 220; // px, while `width` is null
export const TREE_WIDTH_MIN = 160;
export const FILE_WIDTH_MIN = 320; // what the file keeps beside the tree

export type TreePlace = 'alone' | 'beside' | 'folded' | 'instead';

// `treeWidth`: the tree's width as the person set it (or the default); `folded`: the session's stored choice; `shown`: the
// button pressed in this tab while it is too narrow for both (not stored). UX wave U6b-3b
// (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, decision 9; the owner's answer on the card): `finding`,
// the tab Go to file chose while the search lasts, shows the column whatever the fold: beside where there is room for
// both, in the file's place where there is not. Absent: not finding.
export function treePlace(input: { holdsFile: boolean; tabWidth: number; treeWidth: number; folded: boolean; shown: boolean; finding?: boolean }): TreePlace {
  if (!input.holdsFile) return 'alone';
  if (input.tabWidth >= input.treeWidth + FILE_WIDTH_MIN) return input.finding || !input.folded ? 'beside' : 'folded';
  return input.finding || input.shown ? 'instead' : 'folded';
}

export interface SessionTree {
  width: number | null; // stored
  folded: boolean; // stored
  expanded: ReadonlySet<string>; // stored: in the order the folders were opened, the newest last
  selected: string | null; // this run's: the row last activated
  scrollTop: number; // this run's
  defaultRoot: string | null; // this run's: the first root, opened once
  restored: boolean; // read from the stored value: its first root is noted, not opened
  // UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decisions 7 and 11, S4): this run's
  reveal: string | null; // a folder to scroll into view once, when its row is first in the list
  changedFolded: boolean; // the Changed group folded by its heading; open at first in every session, never stored
  // UX wave U6b-3b (decision 9; "What is stored and sent"): this run's
  filter: string; // Go to file's field's text
  finding: string | null; // the tab Go to file chose, while the search lasts
}

const NEW_TREE: SessionTree = { width: null, folded: false, expanded: new Set(), selected: null, scrollTop: 0, defaultRoot: null, restored: false, reveal: null, changedFolded: false, filter: '', finding: null };

export interface TreeStateStore {
  loaded: boolean; // the read has answered (or failed): the tree can be drawn
  trees: ReadonlyMap<AppSessionId, SessionTree>;
  load(): Promise<void>; // the first call reads; later calls share it
  toggle(appSessionId: AppSessionId, path: string): void; // a folder opened or closed by the person
  setWidth(appSessionId: AppSessionId, width: number | null): void; // null: the default
  setFolded(appSessionId: AppSessionId, folded: boolean): void;
  select(appSessionId: AppSessionId, path: string): void;
  scrolled(appSessionId: AppSessionId, scrollTop: number): void;
  firstRoot(appSessionId: AppSessionId, root: string): void; // the session's first root, opened once
  // UX wave U6b-3a: a folder opened from its Changed row, with the folders above it (each closed one opened as the
  // person's toggle would, stored), selected and noted to show; the note dropped once shown, or when the person scrolls
  // or selects another row
  revealIn(appSessionId: AppSessionId, path: string, ancestors: readonly string[]): void;
  revealed(appSessionId: AppSessionId): void;
  foldChanged(appSessionId: AppSessionId, folded: boolean): void; // this run's: never written
  // UX wave U6b-3b: this run's, never written
  setFilter(appSessionId: AppSessionId, text: string): void;
  setFinding(appSessionId: AppSessionId, tabId: string | null): void; // null: the search ended
}

export const treeOf = (state: Pick<TreeStateStore, 'trees'>, appSessionId: AppSessionId): SessionTree => state.trees.get(appSessionId) ?? NEW_TREE;

type Patch = (tree: SessionTree) => Partial<SessionTree>;

function withFolder(expanded: ReadonlySet<string>, path: string, open: boolean): ReadonlySet<string> {
  const next = new Set(expanded);
  next.delete(path); // opened again: the newest
  if (open) next.add(path);
  return next;
}

function storedTrees(value: unknown): Map<AppSessionId, SessionTree> {
  const parsed = value === null ? null : FilesTreeSchema.safeParse(value);
  if (parsed && !parsed.success) console.warn(`[files] ${FILES_TREE_KEY} is not a valid value; every session's tree at its defaults`);
  if (!parsed?.success) return new Map();
  return new Map(
    Object.entries(parsed.data.sessions).map(([id, tree]): [AppSessionId, SessionTree] => [id as AppSessionId, { ...NEW_TREE, width: tree.width, folded: tree.folded, expanded: new Set(tree.expanded), restored: true }]),
  );
}

// Tests only: each store's way back to its first state (`resetTreeState`).
const resets = new WeakMap<object, () => void>();

export function createTreeStateStore(
  client: MawsBridge,
  options: { writeDelayMs?: number; knows?: (appSessionId: AppSessionId) => boolean } = {},
): UseBoundStore<StoreApi<TreeStateStore>> {
  const delay = options.writeDelayMs ?? TREE_WRITE_DELAY_MS;
  const knows = options.knows ?? (() => true);
  let reading: Promise<void> | null = null;
  let early: [AppSessionId, Patch][] = []; // the person's acts before the read answered, in order
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unloadHooked = false;

  const store = create<TreeStateStore>()((set, get) => {
    const write = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const kept = new Map([...get().trees].filter(([id]) => knows(id)));
      if (kept.size !== get().trees.size) set({ trees: kept });
      const value: FilesTree = {
        version: 1,
        sessions: Object.fromEntries([...kept].map(([id, tree]) => [id, { width: tree.width, folded: tree.folded, expanded: [...tree.expanded].slice(-FILES_TREE_EXPANDED_MAX) }])),
      };
      // Never a value the next read would refuse: that read would give every session its defaults.
      if (!FilesTreeSchema.safeParse(value).success) return console.error(`[files] ${FILES_TREE_KEY} not written: the value is not one its schema reads`);
      const failed = (error: unknown) => console.error(`[files] layout.set ${FILES_TREE_KEY} failed`, error);
      void client.invoke('layout.set', { key: FILES_TREE_KEY, value }).then((result) => void (!result.ok && failed(result.error)), failed);
    };
    const schedule = () => {
      if (!unloadHooked && typeof window !== 'undefined') {
        unloadHooked = true;
        window.addEventListener('beforeunload', () => timer !== null && write());
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(write, delay);
    };
    const apply = (trees: ReadonlyMap<AppSessionId, SessionTree>, id: AppSessionId, patch: Patch) => {
      const tree = treeOf({ trees }, id);
      return new Map(trees).set(id, { ...tree, ...patch(tree) });
    };
    // A change of this run only, drawn and never written
    const change = (id: AppSessionId, patch: Patch) => set({ trees: apply(get().trees, id, patch) });
    // A person's act on what is stored: drawn at once; written once the read has answered, else replayed over it
    const act = (id: AppSessionId, patch: Patch) => {
      change(id, patch);
      if (get().loaded) return schedule();
      early.push([id, patch]);
      void get().load();
    };
    const answered = (stored: unknown) => {
      let trees: ReadonlyMap<AppSessionId, SessionTree> = storedTrees(stored);
      for (const [id, tree] of get().trees) {
        const read = trees.get(id);
        if (read === undefined) trees = new Map(trees).set(id, tree); // drawn before the read
        else if (tree.filter !== '' || tree.finding !== null) trees = new Map(trees).set(id, { ...read, filter: tree.filter, finding: tree.finding }); // U6b-3b: a search begun before the read goes on
      }
      for (const [id, patch] of early) trees = apply(trees, id, patch);
      const acted = early.length > 0;
      early = [];
      set({ loaded: true, trees });
      if (acted) schedule();
    };
    const refused = (error: unknown) => {
      console.error(`[files] layout.get ${FILES_TREE_KEY} failed; every session's tree at its defaults`, error);
      answered(null);
    };

    return {
      loaded: false,
      trees: new Map(),

      load() {
        if (reading) return reading;
        let asked: Promise<CommandResult<'layout.get'>>;
        try {
          asked = client.invoke('layout.get', { key: FILES_TREE_KEY });
        } catch (error) {
          asked = Promise.reject(error);
        }
        reading = asked.then((result) => (result.ok ? answered(result.value.value) : refused(result.error)), refused);
        return reading;
      },
      toggle(id, path) {
        const open = !treeOf(get(), id).expanded.has(path);
        act(id, (tree) => ({ expanded: withFolder(tree.expanded, path, open) })); // the state the person saw it reach
      },
      setWidth(id, width) {
        const whole = width === null ? null : Math.round(width); // the stored width is a whole number of pixels
        act(id, () => ({ width: whole }));
      },
      setFolded(id, folded) {
        act(id, () => ({ folded }));
      },
      select(id, path) {
        change(id, (tree) => ({ selected: path, ...(tree.reveal !== null && tree.reveal !== path ? { reveal: null } : {}) })); // another selection ends the wait
      },
      scrolled(id, scrollTop) {
        change(id, () => ({ scrollTop }));
      },
      firstRoot(id, root) {
        const tree = treeOf(get(), id);
        if (tree.defaultRoot === root) return;
        const noted = tree.restored && tree.defaultRoot === null; // after a relaunch: the stored folders stand as the person left them
        change(id, (current) => ({ defaultRoot: root, ...(noted || current.expanded.has(root) ? {} : { expanded: new Set([...current.expanded, root]) }) }));
      },
      revealIn(id, path, ancestors) {
        const closed = [...ancestors, path].filter((folder) => !treeOf(get(), id).expanded.has(folder));
        if (closed.length > 0) act(id, (tree) => ({ expanded: closed.reduce((open, folder) => withFolder(open, folder, true), tree.expanded) }));
        change(id, () => ({ selected: path, reveal: path }));
      },
      revealed(id) {
        if (treeOf(get(), id).reveal !== null) change(id, () => ({ reveal: null }));
      },
      foldChanged(id, folded) {
        change(id, () => ({ changedFolded: folded }));
      },
      setFilter(id, text) {
        if (treeOf(get(), id).filter !== text) change(id, () => ({ filter: text }));
      },
      setFinding(id, tabId) {
        if (treeOf(get(), id).finding !== tabId) change(id, () => ({ finding: tabId }));
      },
    };
  });
  resets.set(store, () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    reading = null;
    early = [];
    store.setState({ loaded: false, trees: new Map() });
  });
  return store;
}

// A session the window no longer knows: this Mac's, with this Mac's sessions loaded and neither a record of it nor (an
// unstarted chat, the branch review's first finding) a setup intent. Another machine's session is never dropped for its
// absence (its machine may be away).
export function knownSession(id: AppSessionId): boolean {
  const local = ipc.localMachine;
  if (!isAddress(id) || machineOf(id) !== local || !useMachines.getState().loaded.has(local)) return true;
  return useSessions.getState().records.has(id) || useSetup.getState().intents.has(id);
}

export const useTreeState = createTreeStateStore(ipc, { knows: knownSession });

/** Tests only: the window's tree state as before its first read, its pending write dropped. */
export function resetTreeState(): void {
  resets.get(useTreeState)?.();
}
