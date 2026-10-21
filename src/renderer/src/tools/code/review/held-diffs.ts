// The held-diff cache Review's store and Source control's share (P4 W2-B, tracker 2026-10-06 E6 · C8c: each carried a
// copy). One `git.diff` per key however many surfaces hold it, ref-counted: the first hold reads, the last release
// forgets the diff and its files. One read in flight per key: a re-read asked meanwhile runs once it answers. A new
// status re-reads trailing, HELD_DIFF_REFRESH_MS after the last. The whole patch is kept split per file within
// REVIEW_SCOPE_BYTES_CAP; past it only the list, each file fetched on its own and dropped when the scope re-reads.
// Each store brings its key shape and its `git.diff` input; Source control adds the hook that drops an answer one of
// its mutations overtook (E11).
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { GitDiff, GitDiffFile, GitDiffInput } from '@shared/ipc/schema/git';
import type { useGit } from '../../../stores/git';
import { REVIEW_SCOPE_BYTES_CAP, splitPatch, type PatchFile } from './review-model';

export const HELD_DIFF_REFRESH_MS = 250; // trailing, like C8a's GIT_DIFF_DELAY_MS

export type ScopeDiff =
  | { status: 'loading' }
  | { status: 'ok'; files: GitDiffFile[]; patch: ReadonlyMap<string, PatchFile> | null } // patch null past the scope cap
  | { status: 'error'; message: string };
export type FileDiff = { status: 'loading' } | { status: 'ok'; file: PatchFile | null } | { status: 'error'; message: string };

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
  // Asked as a read goes out; the check it returns is asked when the answer lands with the hold still current, and true
  // drops the answer: the diff and its files keep what they showed, and a re-read asked meanwhile still runs.
  overtaken?(target: T): () => boolean;
}

export interface HeldDiffs<T> {
  hold(target: T): () => void; // ref-counted; the first reads, the last forgets
  refresh(target: T): void; // re-read now, if held
  reread(match: (target: T) => boolean): void; // every held target that matches, trailing
  loadFile(target: T, path: string): void; // one file of a held scope past its cap
  clear(): void; // forgets every hold and file load; the store's reset empties its maps
}

interface Held<T> {
  target: T;
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
  reading: boolean;
  again: boolean;
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

// The whole patch is kept split per file within the cap; past it, only the list (each file fetched on selection).
function answered(diff: GitDiff): ScopeDiff {
  if (diff.patch.length > REVIEW_SCOPE_BYTES_CAP) return { status: 'ok', files: diff.files, patch: null };
  return { status: 'ok', files: diff.files, patch: new Map(splitPatch(diff.patch).map((file) => [file.path, file])) };
}

// `set` is the owning store's: the cache writes only its `diffs` and `files`.
export function createHeldDiffs<T>(client: MawsBridge, set: (update: (s: HeldDiffState) => Partial<HeldDiffState>) => void, spec: HeldDiffSpec<T>): HeldDiffs<T> {
  const { keys } = spec;
  const held = new Map<string, Held<T>>();
  const fileLoads = new Map<string, symbol>();
  const fileOf = (key: string) => (k: string) => k.startsWith(`${key}${keys.fileSep}`);

  const read = async (key: string) => {
    const h = held.get(key);
    if (!h) return;
    if (h.reading) {
      h.again = true;
      return;
    }
    h.reading = true;
    const overtaken = spec.overtaken?.(h.target);
    const result = await settled(client.invoke('git.diff', spec.input(h.target)));
    h.reading = false;
    if (held.get(key) !== h) return; // released meanwhile
    if (!overtaken?.()) {
      const next: ScopeDiff = result.ok ? answered(result.value) : { status: 'error', message: result.error.message };
      const ofKey = fileOf(key);
      set((s) => ({ diffs: mapWith(s.diffs, key, next), files: mapWithout(s.files, ofKey) }));
      for (const k of [...fileLoads.keys()]) if (ofKey(k)) fileLoads.delete(k);
    }
    if (h.again) {
      h.again = false;
      void read(key);
    }
  };

  const schedule = (h: Held<T>, key: string) => {
    if (h.timer !== null) clearTimeout(h.timer);
    h.timer = setTimeout(() => {
      h.timer = null;
      void read(key);
    }, HELD_DIFF_REFRESH_MS);
  };

  return {
    hold(target) {
      const key = keys.diff(target);
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
        const ofKey = fileOf(key);
        for (const k of [...fileLoads.keys()]) if (ofKey(k)) fileLoads.delete(k);
        set((s) => ({ diffs: mapWithout(s.diffs, (k) => k === key), files: mapWithout(s.files, ofKey) }));
      };
    },

    refresh(target) {
      const key = keys.diff(target);
      if (held.has(key)) void read(key);
    },

    reread(match) {
      for (const [key, h] of held) if (match(h.target)) schedule(h, key);
    },

    loadFile(target, path) {
      const key = keys.file(target, path);
      if (!held.has(keys.diff(target)) || fileLoads.has(key)) return;
      const generation = Symbol();
      fileLoads.set(key, generation);
      set((s) => ({ files: mapWith(s.files, key, { status: 'loading' }) }));
      void settled(client.invoke('git.diff', spec.input(target, path))).then((result) => {
        if (fileLoads.get(key) !== generation) return; // the scope re-read or was released meanwhile
        const next: FileDiff = result.ok ? { status: 'ok', file: splitPatch(result.value.patch)[0] ?? null } : { status: 'error', message: result.error.message };
        set((s) => ({ files: mapWith(s.files, key, next) }));
      });
    },

    clear() {
      for (const h of held.values()) if (h.timer !== null) clearTimeout(h.timer);
      held.clear();
      fileLoads.clear();
    },
  };
}

// A new status C8a's store took for a directory (its git.changed) calls `changed` with it; a watch's first answer does
// not, since the holds read on their own when they start. Its status objects are replaced, never mutated, so a
// reference change is a new status.
export function followGitStatus(git: typeof useGit, changed: (directory: string) => void): void {
  git.subscribe((state, prev) => {
    if (state.entries === prev.entries) return;
    for (const [directory, entry] of state.entries) {
      const before = prev.entries.get(directory);
      if (entry.status && before?.status && entry.status !== before.status) changed(directory);
    }
  });
}
