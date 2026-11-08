// The grants store (P5 O8 M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's *Grants*; Interfaces
// §R): the one writer of `<userData>/org/grants.json`, every grant this app signed, the latest per (machine, member), with
// how its delivery stands. It is built by the session over M1's commit queue, so each `update` runs in the queue as read,
// change, write, and none replaces another's with an older snapshot.
//
// It fails closed by the signing store's rule (signing-store.ts): registration.json gains `grants: true` before
// grants.json is first written; from then a missing or malformed file reads `damaged`, every update is refused, and no
// grant is signed. Read as absent instead, a pending grant would be forgotten and the issued record's version floor lost.
// A write that fails leaves the file's contents unknown (the rename may have landed), so the store reads it back.
//
// Electron-free: vitest's node project runs it.
import { GRANTS_FILE, isGrantsFile, type GrantsFile, type IssuedGrant, type OrgFiles } from './files';

export type { GrantsFile, IssuedGrant } from './files';

/** An update of a damaged file: no grant is signed until the file reads again. */
export class GrantsDamaged extends Error {
  constructor() {
    super('grants.json is missing or does not read: no grant is signed');
  }
}

export interface GrantsStore {
  /** The file as last read or written; never mutate what it returns. */
  get(): GrantsFile | 'damaged';
  /**
   * In the commit queue: `fn` is given a private copy of the file as it stands at its turn, and its `next` is written
   * (unless unchanged) before the update resolves. Throws `GrantsDamaged` on a damaged file, and a write's error. `fn` is
   * a synchronous, side-effect-free function of the file and what it reads: before the first write it runs again after
   * the registration's mark, and that run's `next` and `value` are the ones written and returned.
   */
  update<T>(fn: (file: GrantsFile) => { next: GrantsFile; value: T }): Promise<T>;
}

export const emptyGrantsFile = (): GrantsFile => ({ version: 1, issued: [] });

/** The issued grant for (machine, member) in `file`, if any. */
export const issuedFor = (file: GrantsFile, machine: string, member: string): IssuedGrant | undefined =>
  file.issued.find((i) => i.signed.body.machine === machine && i.signed.body.member === member);

export async function createGrantsStore(deps: {
  files: OrgFiles;
  /** M1's commit queue (org-session.ts's `commit`). */
  commit<T>(body: () => Promise<T>): Promise<T>;
  /** The registration as it stands; its `grants` flag says grants.json was written. */
  registration(): { grants?: true } | null;
  /** Writes `grants: true` into registration.json inside the queue's turn, before grants.json's first write. */
  markRegistration(): Promise<void>;
  log?(line: string): void;
}): Promise<GrantsStore> {
  const { files, commit } = deps;
  const log = (line: string) => deps.log?.(`grants: ${line}`);
  const flagged = () => deps.registration()?.grants === true;

  /** Absent before the first write is a fresh file; anything else unread is damaged. */
  async function read(): Promise<GrantsFile | 'damaged'> {
    const raw = await files.read(GRANTS_FILE);
    if (raw === null && !flagged()) return emptyGrantsFile();
    if (isGrantsFile(raw)) return raw;
    log(`${GRANTS_FILE} is ${raw === null ? 'missing or unreadable' : 'malformed'} after its first write: no grant is signed`);
    return 'damaged';
  }

  let file = await commit(read);

  async function persist(next: GrantsFile): Promise<void> {
    try {
      await files.write(GRANTS_FILE, next);
      file = next;
    } catch (error) {
      file = await read().catch(() => 'damaged' as const);
      log(`a write failed (${(error as Error).message}); the store now holds ${file === 'damaged' ? 'nothing it can trust' : 'the file as it reads back'}`);
      throw error;
    }
  }

  return {
    get: () => file,
    update(fn) {
      return commit(async () => {
        if (file === 'damaged') throw new GrantsDamaged();
        const held = file;
        let { next, value } = fn(structuredClone(held));
        const changes = (n: GrantsFile) => JSON.stringify(n) !== JSON.stringify(held);
        if (!changes(next)) return value;
        if (!isGrantsFile(next)) throw new TypeError(`an update would write a ${GRANTS_FILE} that does not read back`);
        if (!flagged()) {
          // The first write: registration.json is marked first, so the file fails closed from its first byte. `fn`'s
          // checks (a sign-in that ended) may not hold after that await, so it decides again before the write; once
          // marked, a file is written whatever it decides.
          await deps.markRegistration();
          ({ next, value } = fn(structuredClone(held)));
          if (!changes(next)) next = held;
        }
        await persist(next);
        return value;
      });
    },
  };
}
