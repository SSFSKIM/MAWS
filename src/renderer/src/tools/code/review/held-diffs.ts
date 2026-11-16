// The held-diff cache of Review's store (P4 W2-B, tracker 2026-10-06 E6 · C8c: Review and the acting Source control
// pane each carried a copy, until the pane left in UX wave U5b-2). One `git.diff` per key however many surfaces hold it,
// ref-counted: the first hold reads, the last release forgets the diff and its files. One read in flight per key: a
// re-read asked meanwhile runs once it answers. A new status re-reads trailing, HELD_DIFF_REFRESH_MS after the last. The
// whole patch is kept split per file within REVIEW_SCOPE_BYTES_CAP; past it only the list, each file fetched on its own
// and dropped when the scope re-reads. The store brings its key shape and its `git.diff` input.
//
// UX wave U5b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, §E and §G): a target may be read
// with another command than `git.diff` (the working-tree read, a commit's diff; `read`), whose answer carries the new
// files' counts or the commit; and a target may be kept (a commit's diff, decision 17): once it answered, neither a new
// status nor a refresh reads it again, and a failed one, or a failed file of it, is asked again only by `retryFailed`
// and a file's Retry.
//
// The branch's max panel (the document's Decision Log 49 and 50): a read may be refused for now (`may`: the machine does
// not serve the command at present); the refusal asks nothing and changes nothing drawn, and the read is owed until
// `resume` finds it allowed. A target held by several holders is read for the earliest still holding it, so a holder
// that left does not go on addressing its reads (its session, gone with it, would be named on another machine's reads).
import type { CommandName, CommandResult, IpcError, MawsBridge } from '@shared/ipc/schema';
import type { GitChangesSinceInput, GitCommit, GitCommitDiffInput, GitDiff, GitDiffFile, GitDiffInput, GitUntrackedCount } from '@shared/ipc/schema/git';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { pathTarget } from '../../../ipc/machine';
import type { useGit } from '../../../stores/git';
import { REVIEW_SCOPE_BYTES_CAP, splitPatch, type PatchFile } from './review-model';

export const HELD_DIFF_REFRESH_MS = 250; // trailing, like C8a's GIT_DIFF_DELAY_MS

// A failed read: its message, and (UX wave U5b-2) the code and the refusal's word where they tell its kind (`readFailure`)
export type DiffError = { status: 'error'; message: string; code?: string; refusal?: string };
export type ScopeDiff =
  | { status: 'loading' }
  | {
      status: 'ok';
      files: GitDiffFile[];
      patch: ReadonlyMap<string, PatchFile> | null; // null past the scope cap
      untracked?: ReadonlyMap<string, GitUntrackedCount>; // UX wave U5b-2: the working-tree read's counted new files, by path
      commit?: { commit: GitCommit; onHead: boolean }; // UX wave U5b-2: a commit's diff, the commit it is and whether HEAD held it
    }
  | DiffError;
export type FileDiff = { status: 'loading' } | { status: 'ok'; file: PatchFile | null } | DiffError;

// UX wave U5b-2: the command a target, or one file of it, is read with
export type DiffRead = { name: 'git.diff'; input: GitDiffInput } | { name: 'git.changesSince'; input: GitChangesSinceInput } | { name: 'git.commitDiff'; input: GitCommitDiffInput };

export interface HeldDiffState {
  diffs: ReadonlyMap<string, ScopeDiff>; // by the key's diff
  files: ReadonlyMap<string, FileDiff>; // by the key's file: one file of a scope past its cap
}

// A store's key shape: a target's diff under `diff(target)`, a file of it under `${diff(target)}${fileSep}${path}`.
export interface DiffKeys<T> {
  diff(target: T): string;
  file(target: T, path: string): string;
  fileSep: string;
}
export function diffKeys<T>(diff: (target: T) => string, fileSep: string): DiffKeys<T> {
  return { diff, file: (target, path) => `${diff(target)}${fileSep}${path}`, fileSep };
}

export interface HeldDiffSpec<T> {
  keys: DiffKeys<T>;
  input(target: T, path?: string): GitDiffInput; // `path`: one file of the scope
  // UX wave U5b-2: the command a target (or, with `path`, one file of it) is read with; absent, `git.diff` with `input`
  read?(target: T, path?: string): DiffRead;
  // UX wave U5b-2 (decision 17): a target whose answer is kept once it answered: `reread` and `refresh` leave it
  kept?(target: T): boolean;
  // Decision Log 49: whether a new read of the target may be asked now; absent, always. A read it refuses is owed (`resume`)
  may?(target: T): boolean;
}

export interface HeldDiffs<T> {
  hold(target: T): () => void; // ref-counted; the first reads, the last forgets
  refresh(target: T): void; // re-read now, if held
  reread(match: (target: T) => boolean): void; // every held target that matches, trailing
  // one file of a held scope past its cap; `input`, the file's own read where it is not the scope's (an untracked file)
  loadFile(target: T, path: string, input?: GitDiffInput | DiffRead): void;
  // the same read asked again, whatever it answered (UX wave U5b: Retry in a file's row; the store asks it of a failure)
  reloadFile(target: T, path: string, input?: GitDiffInput | DiffRead): void;
  // UX wave U5b-2 (§G): a held target that failed is read again, and each file of it whose own read failed (Review shown
  // again; its machine heard again); a target, or a file, that answered is not asked
  retryFailed(target: T): void;
  resume(): void; // Decision Log 49: every read `may` refused, of a target still held, asked now where it allows it
  clear(): void; // forgets every hold and file load; the store's reset empties its maps
}

interface Held<T> {
  target: T; // the earliest holder's still holding it: what its reads are addressed by (Decision Log 50)
  holders: { target: T }[]; // in the order they came
  timer: ReturnType<typeof setTimeout> | null;
  reading: boolean;
  again: boolean;
  answered: boolean; // it answered once: a kept target is not read again (UX wave U5b-2)
  failed: boolean; // its last read failed (UX wave U5b-2: what `retryFailed` and a kept target's refresh ask again)
  owed: boolean; // a read `may` refused (Decision Log 49), asked by `resume`
}

// A bridge that throws (not a command's failure answer) is a failure too, so nothing stays in flight.
export async function settled<N extends CommandName>(call: Promise<CommandResult<N>>): Promise<CommandResult<N>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
  }
}

export function mapWith<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  return new Map(map).set(key, value);
}
export function mapWithout<K, V>(map: ReadonlyMap<K, V>, drop: (key: K) => boolean): Map<K, V> {
  return new Map([...map].filter(([key]) => !drop(key)));
}

// The whole patch is kept split per file within the cap; past it, only the list (each file fetched on selection). The
// working-tree read adds its counted new files, a commit's diff the commit (UX wave U5b-2).
function answered(diff: GitDiff & { untracked?: GitUntrackedCount[]; commit?: GitCommit; onHead?: boolean }): ScopeDiff {
  const extra = {
    ...(diff.untracked !== undefined && { untracked: new Map(diff.untracked.map((entry) => [entry.path, entry])) }),
    ...(diff.commit !== undefined && { commit: { commit: diff.commit, onHead: diff.onHead ?? true } }),
  };
  if (diff.patch.length > REVIEW_SCOPE_BYTES_CAP) return { status: 'ok', files: diff.files, patch: null, ...extra };
  return { status: 'ok', files: diff.files, patch: new Map(splitPatch(diff.patch).map((file) => [file.path, file])), ...extra };
}

// A failed read as it is kept: its message, and its code and refusal's word only where they tell its kind apart, so a
// failure of `internal` with no refusal is `{ status, message }` as before (UX wave U5b-2).
export function failedWith(error: IpcError): DiffError {
  const refusal = (error.issues as { refusal?: unknown } | undefined)?.refusal;
  return { status: 'error', message: error.message, ...(error.code !== 'internal' && { code: error.code }), ...(typeof refusal === 'string' && { refusal }) };
}

// A read's call on the bridge, by its command (each with its own input's type).
const invokeRead = (client: MawsBridge, read: DiffRead, options: ReturnType<typeof pathTarget>): Promise<CommandResult<DiffRead['name']>> =>
  read.name === 'git.diff' ? client.invoke('git.diff', read.input, options) : read.name === 'git.changesSince' ? client.invoke('git.changesSince', read.input, options) : client.invoke('git.commitDiff', read.input, options);
const asRead = (input: GitDiffInput | DiffRead): DiffRead => ('name' in input ? input : { name: 'git.diff', input });

// `set` is the owning store's: the cache writes only its `diffs` and `files`.
// P5 O7 M4: a target made from a session names it on its reads (another machine's checkout is read by its session).
export function createHeldDiffs<T extends { machine: MachineRef; session?: AppSessionId }>(client: MawsBridge, set: (update: (s: HeldDiffState) => Partial<HeldDiffState>) => void, spec: HeldDiffSpec<T>): HeldDiffs<T> {
  const { keys } = spec;
  const held = new Map<string, Held<T>>();
  const fileLoads = new Map<string, symbol>();
  const failedFiles = new Map<string, { path: string; read: DiffRead }>(); // by file key: an own read that failed, for `retryFailed`
  const owedFiles = new Map<string, { path: string; read: DiffRead }>(); // by file key: an own read `may` refused, for `resume`
  const fileOf = (key: string) => (k: string) => k.startsWith(`${key}${keys.fileSep}`);

  const readOf = (target: T, path?: string): DiffRead => spec.read?.(target, path) ?? { name: 'git.diff', input: spec.input(target, path) };
  const keeps = (h: Held<T>): boolean => spec.kept?.(h.target) ?? false;
  const allowed = (target: T): boolean => spec.may?.(target) ?? true;

  const read = async (key: string) => {
    const h = held.get(key);
    if (!h) return;
    if (h.reading) {
      h.again = true;
      return;
    }
    if (!allowed(h.target)) {
      h.owed = true; // nothing asked and nothing drawn changes: what it answered stays
      return;
    }
    h.owed = false;
    h.reading = true;
    const result = await settled(invokeRead(client, readOf(h.target), pathTarget(h.target.machine, h.target.session)));
    h.reading = false;
    if (held.get(key) !== h) return; // released meanwhile
    if (result.ok) h.answered = true;
    h.failed = !result.ok;
    const next: ScopeDiff = result.ok ? answered(result.value) : failedWith(result.error);
    const ofKey = fileOf(key);
    set((s) => ({ diffs: mapWith(s.diffs, key, next), files: mapWithout(s.files, ofKey) }));
    for (const k of [...fileLoads.keys()]) if (ofKey(k)) fileLoads.delete(k);
    for (const k of [...failedFiles.keys()]) if (ofKey(k)) failedFiles.delete(k);
    for (const k of [...owedFiles.keys()]) if (ofKey(k)) owedFiles.delete(k);
    if (h.again) {
      h.again = false;
      if (!(keeps(h) && h.answered)) void read(key);
    }
  };

  const schedule = (h: Held<T>, key: string) => {
    if (h.timer !== null) clearTimeout(h.timer);
    h.timer = setTimeout(() => {
      h.timer = null;
      void read(key);
    }, HELD_DIFF_REFRESH_MS);
  };

  const loadFile = (target: T, path: string, input?: GitDiffInput | DiffRead): void => {
    const key = keys.file(target, path);
    const h = held.get(keys.diff(target));
    if (!h || fileLoads.has(key)) return;
    const own = input === undefined ? readOf(h.target, path) : asRead(input);
    if (!allowed(h.target)) {
      owedFiles.set(key, { path, read: own });
      return;
    }
    const generation = Symbol();
    fileLoads.set(key, generation);
    failedFiles.delete(key);
    owedFiles.delete(key);
    set((s) => ({ files: mapWith(s.files, key, { status: 'loading' }) }));
    void settled(invokeRead(client, own, pathTarget(h.target.machine, h.target.session))).then((result) => {
      if (fileLoads.get(key) !== generation) return; // the scope re-read or was released meanwhile
      const next: FileDiff = result.ok ? { status: 'ok', file: splitPatch(result.value.patch)[0] ?? null } : failedWith(result.error);
      if (!result.ok) failedFiles.set(key, { path, read: own });
      set((s) => ({ files: mapWith(s.files, key, next) }));
    });
  };

  return {
    hold(target) {
      const key = keys.diff(target);
      const holder = { target };
      let h = held.get(key);
      if (h) h.holders.push(holder);
      else {
        h = { target, holders: [holder], timer: null, reading: false, again: false, answered: false, failed: false, owed: false };
        held.set(key, h);
        set((s) => ({ diffs: mapWith(s.diffs, key, { status: 'loading' }) }));
        void read(key);
      }
      const mine = h;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        mine.holders.splice(mine.holders.indexOf(holder), 1);
        if (mine.holders.length > 0) {
          mine.target = mine.holders[0].target; // addressed by a holder still there (Decision Log 50)
          return;
        }
        if (mine.timer !== null) clearTimeout(mine.timer);
        if (held.get(key) !== mine) return; // forgotten meanwhile (`clear`): a later hold of the key is not this one
        held.delete(key);
        const ofKey = fileOf(key);
        for (const k of [...fileLoads.keys()]) if (ofKey(k)) fileLoads.delete(k);
        for (const k of [...failedFiles.keys()]) if (ofKey(k)) failedFiles.delete(k);
        for (const k of [...owedFiles.keys()]) if (ofKey(k)) owedFiles.delete(k);
        set((s) => ({ diffs: mapWithout(s.diffs, (k) => k === key), files: mapWithout(s.files, ofKey) }));
      };
    },

    refresh(target) {
      const key = keys.diff(target);
      const h = held.get(key);
      if (h && (!keeps(h) || h.failed)) void read(key); // a kept target only when its read failed
    },

    reread(match) {
      for (const [key, h] of held) if (match(h.target) && !keeps(h)) schedule(h, key); // a kept target never on a new status
    },

    loadFile,

    reloadFile(target, path, input) {
      fileLoads.delete(keys.file(target, path));
      loadFile(target, path, input);
    },

    retryFailed(target) {
      const key = keys.diff(target);
      const h = held.get(key);
      if (!h || h.reading) return;
      if (h.failed) {
        void read(key);
        return;
      }
      const ofKey = fileOf(key);
      for (const [fileKey, failed] of [...failedFiles]) {
        if (!ofKey(fileKey)) continue;
        fileLoads.delete(fileKey);
        loadFile(target, failed.path, failed.read);
      }
    },

    resume() {
      for (const [key, h] of held) {
        if (!allowed(h.target)) continue;
        if (h.owed) void read(key);
        for (const [fileKey, owed] of [...owedFiles]) if (fileOf(key)(fileKey)) loadFile(h.target, owed.path, owed.read);
      }
    },

    clear() {
      for (const h of held.values()) if (h.timer !== null) clearTimeout(h.timer);
      held.clear();
      fileLoads.clear();
      failedFiles.clear();
      owedFiles.clear();
    },
  };
}

// A new status C8a's store took for a directory (its git.changed) calls `changed` with the store's key for it,
// `checkoutKey(machine, directory)` (P5 O6 M4); a watch's first answer does not, since the holds read on their own when
// they start. Its status objects are replaced, never mutated, so a reference change is a new status.
export function followGitStatus(git: typeof useGit, changed: (checkout: string) => void): void {
  git.subscribe((state, prev) => {
    if (state.entries === prev.entries) return;
    for (const [checkout, entry] of state.entries) {
      const before = prev.entries.get(checkout);
      if (entry.status && before?.status && entry.status !== before.status) changed(checkout);
    }
  });
}
