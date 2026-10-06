// The Source control tool's data (E6 execution document, Design §1 and §5). The scope diffs the groups draw, held like
// Review's (C8c's review-store): one `git.diff` per (directory, scope) however many surfaces hold it, re-read 250 ms
// after C8a's git store takes a new status for the directory, split per file within REVIEW_SCOPE_BYTES_CAP and
// fetched a file at a time past it. An untracked file's diff (`git.diff`'s `untracked` scope) is held the same way for
// the one file a surface selects. The mutations (`scm.stage`, `unstage`, `discard`, `commit`) write only the tool's
// notice, last commit and draft: the lists move when the watcher's `git.changed` arrives, since main refreshes the
// watcher after every mutation, and a mutation's answered status written into `useGit` could overwrite a newer one the
// watcher would not repeat. The latest remote run per session is seeded from `scm.remote.last` while a body holds it
// and advanced by `scm.remote.output` by sequence number.
//
// The status and the watch that keeps it current are C8a's `useGit`; the tool's body holds its watch while mounted.
import type { StoreApi } from 'zustand/vanilla';
import { create, type UseBoundStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { GitDiff, GitDiffInput } from '@shared/ipc/schema/git';
import type { RemotePlan, ScmDiscardInput, ScmMutation, ScmRemoteOutput } from '@shared/ipc/schema/scm';
import { ipc } from '../../ipc/client';
import { queryClient } from '../../ipc/query';
import { useGit } from '../../stores/git';
import { REVIEW_SCOPE_BYTES_CAP, splitPatch } from '../code/review/review-model';
import type { FileDiff, ScopeDiff } from '../code/review/review-store';
import { PR_STATE_QUERIES } from './queries';
import { advanceRun, runFromSnapshot, runStarted, type RemoteRun } from './remote-run';
import type { ScmUi } from './view-state';

export const SCM_REFRESH_MS = 250; // trailing, as Review's

export type ScmDiffTarget = { directory: string; scope: 'staged' | 'worktree' } | { directory: string; scope: 'untracked'; path: string };
export type ScmMutationResult = CommandResult<'scm.stage'>; // every mutation answers ScmMutation

export interface ScmStore {
  diffs: ReadonlyMap<string, ScopeDiff>; // by diffKey
  files: ReadonlyMap<string, FileDiff>; // by fileKey: one file of a scope past its cap
  runs: ReadonlyMap<AppSessionId, RemoteRun | null>; // while a body resumes the session: null when main holds no run
  hold(target: ScmDiffTarget): () => void; // ref-counted; the first reads, the last forgets
  statusChanged(directory: string): void; // a new status for the directory: every held diff of it re-reads, trailing
  loadFile(target: ScmDiffTarget, path: string): void; // a staged or worktree scope past its cap; an untracked diff is whole
  stage(ui: StoreApi<ScmUi>, appSessionId: AppSessionId, paths: string[]): Promise<ScmMutationResult>;
  unstage(ui: StoreApi<ScmUi>, appSessionId: AppSessionId, paths: string[]): Promise<ScmMutationResult>;
  discard(ui: StoreApi<ScmUi>, appSessionId: AppSessionId, entries: ScmDiscardInput['entries']): Promise<ScmMutationResult>;
  commit(ui: StoreApi<ScmUi>, appSessionId: AppSessionId): Promise<ScmMutationResult>; // the session's draft and Skip hooks
  resume(appSessionId: AppSessionId): () => void; // ref-counted: seeds the run from `scm.remote.last` and follows its events
  started(appSessionId: AppSessionId, plan: RemotePlan): void; // `scm.push`/`scm.pr.create` answered `started` for the plan
  reset(): void; // tests
}

const diffKey = (t: ScmDiffTarget) => `${t.directory}\0${t.scope}${t.scope === 'untracked' ? `\0${t.path}` : ''}`;
const fileKey = (t: ScmDiffTarget, path: string) => `${diffKey(t)}\0\0${path}`;

export const diffOf = (s: Pick<ScmStore, 'diffs'>, t: ScmDiffTarget) => s.diffs.get(diffKey(t));
export const fileDiffOf = (s: Pick<ScmStore, 'files'>, t: ScmDiffTarget, path: string) => s.files.get(fileKey(t, path));

const diffInput = (t: ScmDiffTarget, path?: string): GitDiffInput =>
  t.scope === 'untracked' ? { directory: t.directory, scope: 'untracked', path: t.path } : { directory: t.directory, scope: t.scope, ...(path !== undefined ? { path } : {}) };

// The whole patch is kept split per file within the cap; past it, only the list (each file fetched on selection).
function answered(diff: GitDiff): ScopeDiff {
  if (diff.patch.length > REVIEW_SCOPE_BYTES_CAP) return { status: 'ok', files: diff.files, patch: null };
  return { status: 'ok', files: diff.files, patch: new Map(splitPatch(diff.patch).map((file) => [file.path, file])) };
}

// A bridge that throws (not a command's failure answer) is a failure too, so nothing stays in flight.
export async function settled<N extends CommandName>(call: Promise<CommandResult<N>>): Promise<CommandResult<N>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
  }
}

interface Held {
  target: ScmDiffTarget;
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
  reading: boolean;
  again: boolean;
}

interface Resumed {
  count: number;
  off: () => void;
  pending: ScmRemoteOutput[] | null; // events that came before the snapshot answered
}

function mapWith<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  return new Map(map).set(key, value);
}
function mapWithout<K, V>(map: ReadonlyMap<K, V>, drop: (key: K) => boolean): Map<K, V> {
  return new Map([...map].filter(([key]) => !drop(key)));
}

export interface ScmStoreOptions {
  git?: typeof useGit; // C8a's store, whose new statuses re-read the held diffs
}

export function createScmStore(client: MawsBridge, options: ScmStoreOptions = {}): UseBoundStore<StoreApi<ScmStore>> {
  const held = new Map<string, Held>();
  const fileLoads = new Map<string, symbol>();
  const resumed = new Map<AppSessionId, Resumed>();

  const store = create<ScmStore>()((set, get) => {
    const read = async (key: string) => {
      const h = held.get(key);
      if (!h) return;
      if (h.reading) {
        h.again = true;
        return;
      }
      h.reading = true;
      const result = await settled(client.invoke('git.diff', diffInput(h.target)));
      h.reading = false;
      if (held.get(key) !== h) return; // released meanwhile
      const next: ScopeDiff = result.ok ? answered(result.value) : { status: 'error', message: result.error.message };
      set((s) => ({ diffs: mapWith(s.diffs, key, next), files: mapWithout(s.files, (k) => k.startsWith(`${key}\0\0`)) }));
      for (const k of [...fileLoads.keys()]) if (k.startsWith(`${key}\0\0`)) fileLoads.delete(k);
      if (h.again) {
        h.again = false;
        void read(key);
      }
    };

    const schedule = (h: Held, key: string) => {
      if (h.timer !== null) clearTimeout(h.timer);
      h.timer = setTimeout(() => {
        h.timer = null;
        void read(key);
      }, SCM_REFRESH_MS);
    };

    // A mutation's answer is for the session it was asked for: a pinned tool that moved on meanwhile keeps its own, and
    // only `elsewhere` (the commit's parked draft) touches the state then. `ok` clears the last notice; a refusal or a
    // failed call becomes it.
    type Landed = Extract<ScmMutation, { ok: true }>;
    const mutate = async (
      ui: StoreApi<ScmUi>,
      appSessionId: AppSessionId,
      call: Promise<CommandResult<'scm.stage'>>,
      landed?: { here(answer: Landed): Partial<ScmUi>; elsewhere(): Partial<ScmUi> },
    ) => {
      const result = await settled(call);
      if (ui.getState().session !== appSessionId) {
        if (landed && result.ok && !('refused' in result.value)) ui.setState(landed.elsewhere());
        return result;
      }
      if (!result.ok) ui.setState({ notice: { kind: 'error', text: result.error.message, output: '' } });
      else if ('refused' in result.value) ui.setState({ notice: { kind: result.value.refused, text: result.value.detail, output: result.value.output } });
      else ui.setState({ notice: null, ...landed?.here(result.value) });
      return result;
    };

    const setRun = (appSessionId: AppSessionId, run: RemoteRun | null) => {
      if (get().runs.get(appSessionId) !== run) set((s) => ({ runs: mapWith(s.runs, appSessionId, run) }));
    };

    return {
      diffs: new Map(),
      files: new Map(),
      runs: new Map(),

      hold(target) {
        const key = diffKey(target);
        let h = held.get(key);
        if (h) h.count += 1;
        else {
          h = { target, count: 1, timer: null, reading: false, again: false };
          held.set(key, h);
          set((s) => ({ diffs: mapWith(s.diffs, key, { status: 'loading' }) }));
          void read(key);
        }
        const mine = h;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (--mine.count > 0) return;
          if (mine.timer !== null) clearTimeout(mine.timer);
          held.delete(key);
          for (const k of [...fileLoads.keys()]) if (k.startsWith(`${key}\0\0`)) fileLoads.delete(k);
          set((s) => ({ diffs: mapWithout(s.diffs, (k) => k === key), files: mapWithout(s.files, (k) => k.startsWith(`${key}\0\0`)) }));
        };
      },

      statusChanged(directory) {
        for (const [key, h] of held) if (h.target.directory === directory) schedule(h, key);
      },

      loadFile(target, path) {
        const key = fileKey(target, path);
        if (target.scope === 'untracked' || !held.has(diffKey(target)) || fileLoads.has(key)) return;
        const generation = Symbol();
        fileLoads.set(key, generation);
        set((s) => ({ files: mapWith(s.files, key, { status: 'loading' }) }));
        void settled(client.invoke('git.diff', diffInput(target, path))).then((result) => {
          if (fileLoads.get(key) !== generation) return; // the scope re-read or was released meanwhile
          const next: FileDiff = result.ok ? { status: 'ok', file: splitPatch(result.value.patch)[0] ?? null } : { status: 'error', message: result.error.message };
          set((s) => ({ files: mapWith(s.files, key, next) }));
        });
      },

      stage: (ui, appSessionId, paths) => mutate(ui, appSessionId, client.invoke('scm.stage', { appSessionId, paths })),
      unstage: (ui, appSessionId, paths) => mutate(ui, appSessionId, client.invoke('scm.unstage', { appSessionId, paths })),
      discard: (ui, appSessionId, entries) => mutate(ui, appSessionId, client.invoke('scm.discard', { appSessionId, entries })),

      // The commit takes the session's draft; once it lands the draft is cleared, unless it was edited meanwhile, and
      // Skip hooks goes back off (it is a decision per commit, as `--no-verify` is in a terminal).
      commit(ui, appSessionId) {
        const { message, noVerify } = ui.getState();
        return mutate(ui, appSessionId, client.invoke('scm.commit', { appSessionId, message, noVerify }), {
          here: (answer) => ({ lastCommit: answer.commit ?? null, noVerify: false, ...(ui.getState().message === message ? { message: '' } : {}) }),
          // Landed while a pinned tool shows another session: the committed draft parked for this one goes, unless it
          // was edited before the switch.
          elsewhere: () => {
            const { drafts } = ui.getState();
            if (drafts.get(appSessionId)?.message !== message) return {};
            const next = new Map(drafts);
            next.delete(appSessionId);
            return { drafts: next };
          },
        });
      },

      // A session's run is the checkout's latest, which another session on the same checkout may have started: an
      // event is the session's when it names the session or the run it holds. Events that arrive before the snapshot
      // answers are either folded into it (its run, at or below its `seq`) or from a run before it (main's latest run
      // is the newest one when it answers): only its own run's later events are kept. With no run in main, whatever
      // the session's own runs sent is a run that started since.
      resume(appSessionId) {
        let r = resumed.get(appSessionId);
        if (r) r.count += 1;
        else {
          const entry: Resumed = { count: 1, off: () => {}, pending: [] };
          r = entry;
          resumed.set(appSessionId, entry);
          entry.off = client.on('scm.remote.output', (event) => {
            if (entry.pending) return void entry.pending.push(event);
            const run = get().runs.get(appSessionId) ?? null;
            if (event.appSessionId !== appSessionId && event.token !== run?.token) return;
            setRun(appSessionId, advanceRun(run, event));
          });
          void settled(client.invoke('scm.remote.last', { appSessionId })).then((result) => {
            if (resumed.get(appSessionId) !== entry) return; // released meanwhile
            const pending = entry.pending ?? [];
            entry.pending = null;
            const seeded = result.ok ? runFromSnapshot(result.value) : null;
            let run = seeded;
            for (const event of pending) if (seeded === null ? event.appSessionId === appSessionId : event.token === seeded.token) run = advanceRun(run, event);
            set((s) => ({ runs: mapWith(s.runs, appSessionId, run) }));
          });
        }
        const mine = r;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (--mine.count > 0) return;
          mine.off();
          resumed.delete(appSessionId);
          set((s) => ({ runs: mapWithout(s.runs, (k) => k === appSessionId) }));
        };
      },

      started(appSessionId, plan) {
        if (!resumed.has(appSessionId)) return;
        setRun(appSessionId, runStarted(get().runs.get(appSessionId) ?? null, plan));
      },

      reset() {
        for (const h of held.values()) if (h.timer !== null) clearTimeout(h.timer);
        for (const r of resumed.values()) r.off();
        held.clear();
        fileLoads.clear();
        resumed.clear();
        set({ diffs: new Map(), files: new Map(), runs: new Map() });
      },
    };
  });

  // A new status C8a's store took for a directory (its git.changed) re-reads the diffs held over that directory; a
  // watch's first answer does not, since the holds read on their own when they start (as Review's). Its status objects
  // are replaced, never mutated, so a reference change is a new status.
  if (options.git) {
    const git = options.git;
    git.subscribe((state, prev) => {
      if (state.entries === prev.entries) return;
      for (const [directory, entry] of state.entries) {
        const before = prev.entries.get(directory);
        if (entry.status && before?.status && entry.status !== before.status) store.getState().statusChanged(directory);
      }
    });
  }
  return store;
}

export const useScm = createScmStore(ipc, { git: useGit });

// A push moves the upstream and a PR run creates the PR, and main drops its PR cache for the checkout when a run ends
// (Design §6): every PR state is read again at a run's `exit` chunk. One listener for the window's life, connected by
// App.tsx's E6 block, not one per resumed session: a run that ends while no Source control body is mounted (the owner
// on the Session overview) still reaches the summary's row.
export function connectScmRunEnds(client: MawsBridge = ipc): () => void {
  return client.on('scm.remote.output', (event) => {
    if (event.kind === 'exit') void queryClient.invalidateQueries({ queryKey: PR_STATE_QUERIES });
  });
}

// A link out of the app (a PR, gh's install page) through main's `layout.openExternal`.
export function openLink(url: string): void {
  void settled(ipc.invoke('layout.openExternal', { url })).then((result) => {
    if (!result.ok) console.error('[scm] layout.openExternal failed', result.error);
  });
}
