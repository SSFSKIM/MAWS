// X17's storage port (P2-A execution document §5.5): one file per app session at
// `<userData>/engine-host/state/<appSessionId>.observed.json`, beside the state file and never a key in it, so the state
// store's strict reader is untouched. Every write is a per-field merge into what the file holds (`mergeObservedFacts`),
// written to a temp file and renamed; operations on one id run in the order they were issued (one chain per id, as
// FileSessionStateStore runs its own), so a write issued at a process's exit is seen by any read issued after it.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import { mergeObservedFacts, readObservedFacts, type ObservedFacts } from '@shared/engine/observed-facts';
import type { AppSessionId } from '@shared/graph/ids';

export interface ObservedFactsMergeOptions {
  keepLaunches?: ReadonlySet<string>; // the launches still worth listing (the journal's and the live one); absent, all
}

export interface ObservedFactsStore {
  load(id: AppSessionId): Promise<ObservedFacts | null>;
  merge(id: AppSessionId, facts: ObservedFacts, opts?: ObservedFactsMergeOptions): Promise<ObservedFacts>;
  forget(id: AppSessionId): Promise<void>;
}

export function observedFactsPath(userData: string, id: AppSessionId): string {
  assertSafeAppSessionId(id);
  return join(userData, 'engine-host', 'state', `${id}.observed.json`);
}

const mergeInto = (current: ObservedFacts | null, facts: ObservedFacts, opts: ObservedFactsMergeOptions | undefined): ObservedFacts => {
  const merged = current ? mergeObservedFacts(current, facts) : facts;
  return opts?.keepLaunches ? { ...merged, launches: merged.launches.filter((launchId) => opts.keepLaunches!.has(launchId)) } : merged;
};

export class FileObservedFactsStore implements ObservedFactsStore {
  private readonly chains = new Map<AppSessionId, Promise<unknown>>();

  constructor(private readonly userData: string) {}

  load(id: AppSessionId): Promise<ObservedFacts | null> {
    return this.run(id, () => this.read(id));
  }

  merge(id: AppSessionId, facts: ObservedFacts, opts?: ObservedFactsMergeOptions): Promise<ObservedFacts> {
    return this.run(id, async () => {
      const next = mergeInto(await this.read(id), facts, opts);
      const file = observedFactsPath(this.userData, id);
      await mkdir(join(this.userData, 'engine-host', 'state'), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(next)}\n`);
      await rename(temp, file);
      return next;
    });
  }

  forget(id: AppSessionId): Promise<void> {
    return this.run(id, () => rm(observedFactsPath(this.userData, id), { force: true }));
  }

  // The file as the tolerant reader takes it; none, or one it cannot read, is unknown (and an unreadable file stays
  // where it is: the next write replaces it).
  private async read(id: AppSessionId): Promise<ObservedFacts | null> {
    try {
      return readObservedFacts(await readFile(observedFactsPath(this.userData, id), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private run<T>(id: AppSessionId, op: () => Promise<T>): Promise<T> {
    try {
      assertSafeAppSessionId(id);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const previous = this.chains.get(id) ?? Promise.resolve();
    const next = previous.then(op, op);
    const settled = next.catch(() => {});
    this.chains.set(id, settled);
    void settled.then(() => {
      if (this.chains.get(id) === settled) this.chains.delete(id);
    });
    return next;
  }
}

// In memory: the host's default when it is built without a userData store (tests), and a test double.
export class MemoryObservedFactsStore implements ObservedFactsStore {
  readonly files = new Map<AppSessionId, ObservedFacts>();

  async load(id: AppSessionId): Promise<ObservedFacts | null> {
    assertSafeAppSessionId(id);
    return structuredClone(this.files.get(id) ?? null);
  }
  async merge(id: AppSessionId, facts: ObservedFacts, opts?: ObservedFactsMergeOptions): Promise<ObservedFacts> {
    assertSafeAppSessionId(id);
    const next = mergeInto(this.files.get(id) ?? null, structuredClone(facts), opts);
    this.files.set(id, next);
    return structuredClone(next);
  }
  async forget(id: AppSessionId): Promise<void> {
    assertSafeAppSessionId(id);
    this.files.delete(id);
  }
}
