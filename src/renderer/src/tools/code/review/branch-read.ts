// The branch read in the window (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// §E; decision 18): one store of `git.branchCommits` answers, which Review's "This branch" (its base and merge base) and
// Source control's Commits part both hold, so one fact never has two values. Keyed by machine and repository root;
// ref-counted by its holders in view. Asked when a holder comes into view (the first, or one again); when `git.changed`
// says the checkout's `head` or `refs` moved, while held (`renderer/src/ipc/events.ts`); and two minutes after the last
// answer, while held. With no holder in view nothing is asked and the last answer is kept. One ask in flight per key: an
// ask meanwhile makes one more when it answers. A failure keeps the last answer and says which kind it was (`readFailure`
// over it, §H); the next event asks again.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { GitBranchCommits } from '@shared/ipc/schema/git';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../../../ipc/client';
import { checkoutKey, pathTarget } from '../../../ipc/machine';
import { failedWith, mapWith, settled, type DiffError } from './held-diffs';

export const BRANCH_READ_LIMIT = 50; // the newest commits the read lists (Source control's list shows at most 50)
export const BRANCH_READ_EVERY_MS = 2 * 60_000; // asked again this long after the last answer, while held in view

export interface BranchReadTarget {
  machine: MachineRef;
  repoRoot: string; // the key, with the machine
  directory: string; // what the read is addressed by: the holder's working folder
  session?: AppSessionId; // the session the read is made for (another machine reads a checkout only for a session of it)
}

export interface BranchRead {
  answer: GitBranchCommits | null; // the last answer, kept through a failure and while no holder is in view
  failure: DiffError | null; // the last ask failed: its message, and its code and refusal's word (`readFailure`)
}

export interface BranchReadsStore {
  reads: ReadonlyMap<string, BranchRead>; // by `checkoutKey(machine, repoRoot)`
  hold(target: BranchReadTarget): () => void; // a holder in view: asks; the release ends its hold, the answer stays
  changed(machine: MachineRef, repoRoot: string): void; // the checkout's `head` or `refs` moved: asks, if held
  reset(): void; // tests
}

export const branchReadKey = (machine: MachineRef, repoRoot: string): string => checkoutKey(machine, repoRoot);
export const branchReadOf = (s: Pick<BranchReadsStore, 'reads'>, machine: MachineRef, repoRoot: string): BranchRead | undefined => s.reads.get(branchReadKey(machine, repoRoot));

interface Held {
  target: BranchReadTarget;
  count: number;
  reading: boolean;
  again: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createBranchReads(client: MawsBridge): UseBoundStore<StoreApi<BranchReadsStore>> {
  const held = new Map<string, Held>();

  return create<BranchReadsStore>()((set, get) => {
    const ask = async (key: string): Promise<void> => {
      const h = held.get(key);
      if (!h) return;
      if (h.reading) {
        h.again = true;
        return;
      }
      h.reading = true;
      if (h.timer !== null) clearTimeout(h.timer);
      h.timer = null;
      const { machine, directory, session } = h.target;
      const result = await settled(client.invoke('git.branchCommits', { directory, limit: BRANCH_READ_LIMIT }, pathTarget(machine, session)));
      h.reading = false;
      const last = get().reads.get(key);
      const next: BranchRead = result.ok ? { answer: result.value, failure: null } : { answer: last?.answer ?? null, failure: failedWith(result.error) };
      set((s) => ({ reads: mapWith(s.reads, key, next) }));
      if (held.get(key) !== h) return; // no holder in view now: the answer stays, nothing more is asked
      if (h.again) {
        h.again = false;
        void ask(key);
        return;
      }
      h.timer = setTimeout(() => {
        h.timer = null;
        void ask(key);
      }, BRANCH_READ_EVERY_MS);
    };

    return {
      reads: new Map(),

      hold(target) {
        const key = branchReadKey(target.machine, target.repoRoot);
        let h = held.get(key);
        if (h) h.count += 1;
        else {
          h = { target, count: 1, reading: false, again: false, timer: null };
          held.set(key, h);
        }
        void ask(key);
        const mine = h;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (--mine.count > 0) return;
          if (mine.timer !== null) clearTimeout(mine.timer);
          mine.timer = null;
          held.delete(key);
        };
      },

      changed(machine, repoRoot) {
        const key = branchReadKey(machine, repoRoot);
        if (held.has(key)) void ask(key);
      },

      reset() {
        for (const h of held.values()) if (h.timer !== null) clearTimeout(h.timer);
        held.clear();
        set({ reads: new Map() });
      },
    };
  });
}

export const useBranchReads = createBranchReads(ipc);
