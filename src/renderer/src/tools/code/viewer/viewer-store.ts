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
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { FILES_READ_DEFAULT_LENGTH, type FilesChanged, type FilesReadOutput } from '@shared/ipc/schema/files';
import { ipc } from '../../../ipc/client';
import { useLayout } from '../../../stores/layout';
import { useFiles, type WatchHold } from '../files/store';
import { dirname, sameFile } from '../files/tree';
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
}

// What a view leaves behind when it unmounts; never rendered, so never reactive.
export interface ViewState {
  editor: unknown; // CodeMirror's EditorState, opaque here
  editorAt: { epoch: number; length: number } | null; // the text it holds
  codeScroll: number;
  renderedScroll: number;
  ratio: number | null; // the last view's scroll ratio, for the Source toggle
  ratioPending: boolean; // the next view to mount takes `ratio` rather than its own offset
}

export interface ViewerStore {
  entries: Map<string, ViewerEntry>;
  wrap: boolean; // the Wrap toggle, one for every code view
  mount(tabId: string, target: { appSessionId: AppSessionId; path: string; line: number | null }): () => void;
  loadMore(tabId: string): void;
  toggleSource(tabId: string): void;
  setWrap(wrap: boolean): void;
  jumped(tabId: string): void; // the code view landed (or gave up on) the pending line
  applyChanged(event: FilesChanged): void;
  reset(): void; // tests: forget every entry, release every hold
}

const views = new Map<string, ViewState>();
export function viewState(tabId: string): ViewState {
  let view = views.get(tabId);
  if (!view) views.set(tabId, (view = { editor: null, editorAt: null, codeScroll: 0, renderedScroll: 0, ratio: null, ratioPending: false }));
  return view;
}

async function settled<N extends 'files.read'>(call: Promise<CommandResult<N>>): Promise<CommandResult<N>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
  }
}

const isNotFound = (message: string) => message.startsWith('not found:');

export function createViewerStore(client: MawsBridge) {
  const holds = new Map<string, WatchHold>();
  // The latest load of each tab, from one counter that only grows (never reset, not even by `reset`), so a load of a
  // removed entry can never match the entry that replaced it.
  const generations = new Map<string, number>();
  let lastGeneration = 0;
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

    const remove = (tabId: string) => {
      holds.get(tabId)?.release();
      holds.delete(tabId);
      generations.delete(tabId);
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

    // Entries of tabs the layout no longer holds go; past the bound, the least recently used unmounted ones go.
    const prune = () => {
      const open = new Set(useLayout.getState().main.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id)));
      for (const tabId of get().entries.keys()) if (!open.has(tabId) && !mounted.get(tabId)) remove(tabId);
      const idle = [...get().entries.keys()].filter((tabId) => !mounted.get(tabId)).sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0));
      while (get().entries.size > VIEWER_ENTRIES_MAX && idle.length > 0) remove(idle.shift()!);
    };

    const fail = (tabId: string, message: string, reason: 'open' | 'change') => {
      const entry = get().entries.get(tabId);
      if (reason === 'change' && isNotFound(message) && entry?.status === 'ready') return patch(tabId, { removed: true, loadingMore: false });
      patch(tabId, { status: 'error', error: message, kind: null, text: '', base64: null, loaded: 0, complete: false, epoch: (entry?.epoch ?? 0) + 1, loadingMore: false });
    };

    // One load per tab at a time: a newer one (or the entry's removal) makes an older one's answers land nowhere. A
    // follow-the-file re-read (`change`) keeps the shown content until the new one is complete, then swaps it whole.
    // Whatever a load patches ends a Load more it superseded (`loadingMore` false), whose answer then lands nowhere.
    const load = async (tabId: string, reason: 'open' | 'change') => {
      const entry = get().entries.get(tabId);
      if (!entry) return;
      const generation = ++lastGeneration;
      generations.set(tabId, generation);
      const live = () => generations.get(tabId) === generation;
      // A re-read of a head covers what Load more had reached, not only the first chunk.
      const extent = reason === 'change' && entry.kind === 'head' ? Math.min(CODE_CAP, entry.loaded) : 0;
      const { appSessionId, path } = entry;
      const read = (offset: number, length: number) => settled(client.invoke('files.read', { appSessionId, path, offset, length }));

      const first = await read(0, FILES_READ_DEFAULT_LENGTH);
      if (!live()) return;
      if (!first.ok) return fail(tabId, first.error.message, reason);
      const head = first.value;
      const kind = kindOf({ name: path, mime: head.mime, bytes: head.bytes, encoding: head.encoding });
      const epoch = (get().entries.get(tabId)?.epoch ?? 0) + 1;
      const updated = (get().entries.get(tabId)?.updated ?? 0) + (reason === 'change' ? 1 : 0);
      const base = { status: 'ready' as const, error: null, kind, mime: head.mime, encoding: head.encoding, bytes: head.bytes, removed: false, epoch, updated, loadingMore: false };
      // A markdown file opened at a line is shown as its source, where the line exists.
      const sourceView = kind === 'markdown' && get().entries.get(tabId)?.pendingJump != null ? true : undefined;

      if (kind === 'external') return patch(tabId, { ...base, text: '', base64: null, loaded: 0, complete: true });
      if (kind === 'image') {
        let whole = head;
        if (head.truncated) {
          const all = await read(0, head.bytes);
          if (!live()) return;
          if (!all.ok) return fail(tabId, all.error.message, reason);
          whole = all.value;
        }
        const utf8 = whole.encoding === 'utf8';
        return patch(tabId, { ...base, text: utf8 ? whole.content : '', base64: utf8 ? null : whole.content, loaded: whole.length, complete: true });
      }

      let text = head.content;
      let loaded = head.offset + head.length;
      const wanted = () => kind !== 'head' || loaded < extent;
      let more = head.truncated && wanted();
      if (reason === 'open') patch(tabId, { ...base, text, base64: null, loaded, complete: !head.truncated, ...(sourceView ? { sourceView } : {}) });
      while (more && loaded < CODE_CAP) {
        const next = await read(loaded, kind === 'head' ? Math.min(FILES_READ_DEFAULT_LENGTH, extent - loaded) : FILES_READ_DEFAULT_LENGTH);
        if (!live()) return;
        // Mid-file: nothing of either version stays, except that a file gone during a re-read keeps its last content.
        if (!next.ok) return fail(tabId, next.error.message, reason);
        if (next.value.length === 0) break; // the file shrank under the read
        text += next.value.content;
        loaded = next.value.offset + next.value.length;
        more = next.value.truncated && wanted();
        if (reason === 'open') patch(tabId, { text, loaded, complete: !more });
      }
      if (reason === 'change') patch(tabId, { ...base, text, base64: null, loaded, complete: kind !== 'head' });
      else patch(tabId, { complete: kind !== 'head' });
    };

    const reload = (tabId: string) => {
      if (mounted.get(tabId)) void load(tabId, 'change');
      else stale.add(tabId); // read when next shown
    };

    return {
      entries: new Map(),
      wrap: false,

      mount(tabId, { appSessionId, path, line }) {
        used.set(tabId, ++clock);
        if (!unsubscribe) unsubscribe = useLayout.subscribe((state, prev) => state.main !== prev.main && prune());
        const entry = get().entries.get(tabId);
        if (!entry || entry.appSessionId !== appSessionId || entry.path !== path) {
          holds.get(tabId)?.release();
          views.delete(tabId);
          stale.delete(tabId);
          generations.set(tabId, ++lastGeneration); // an older load lands nowhere
          const fresh: ViewerEntry = {
            tabId, appSessionId, path, status: 'loading', error: null, kind: null, mime: '', encoding: 'utf8', bytes: 0, loaded: 0, complete: false,
            text: '', epoch: (entry?.epoch ?? 0) + 1, base64: null, removed: false, updated: 0, sourceView: false, line, pendingJump: line, loadingMore: false,
          };
          set((s) => ({ entries: new Map(s.entries).set(tabId, fresh) }));
          // The watch first, then the read: a change made while main's watcher restarts is read, not missed (M1 Surprises).
          const hold = useFiles.getState().watch(appSessionId, dirname(path));
          holds.set(tabId, hold);
          void hold.ready.then(() => {
            if (holds.get(tabId) === hold) void load(tabId, 'open');
          });
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
            if (hold && sameFile(event.path, directory)) void hold.ready.then(() => holds.get(tabId) === hold && reload(tabId));
          } else if (sameFile(event.path, entry.path) || (event.kind === 'changed' && sameFile(event.path, directory))) {
            reload(tabId); // an event naming only the directory may be the file's, coalesced; a re-read absorbs a spurious one
          }
        }
      },

      reset() {
        for (const hold of holds.values()) hold.release();
        holds.clear();
        generations.clear();
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
