// The signing store (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M3's "The signing file";
// Interfaces §K): the one writer of `<userData>/org/signing.json`, which holds the pending slot, the delivery
// obligations, the abandoned proposals and the weekly asking's dates. The signer, the weekly asking and the deliveries
// share one store, built by the session over M1's commit queue, so no change replaces another's with an older snapshot:
// each `update` runs in the queue as read, change, write.
//
// - Nothing inside an update waits on the network or on a held view's adoption: the change is a synchronous function of
//   the file, and adoption's anchor write itself waits on the same queue.
// - It fails closed, unlike §C's other files. registration.json gains `signing: true` before signing.json is first
//   written; from then a missing or malformed signing.json reads `damaged`, every update is refused, and only `reset`
//   (the owner's `org.resetSigning`) writes a fresh file. Read as absent instead, an unanswered post's slot would be
//   lost, and a second successor of the same parent could be signed.
// - A write that fails leaves the file's contents unknown (the rename may have landed), so the store reads it back: a
//   file that reads is what the store holds from then, and one that doesn't is `damaged`.
//
// Electron-free: vitest's node project runs it.
import { canonicalize, stateHash, type SignedOrgState } from '../../../apps/org-protocol/src/index.ts';
import { isSigningFile, isStoredSigningFile, SIGNING_FILE, type OrgFiles, type SigningFile } from './files';

export type { Abandoned, Obligation, Pending, SigningFile } from './files';

/** An update or a read of a damaged file: `problem: 'signing'` until the owner resets it. */
export class SigningDamaged extends Error {
  constructor() {
    super('signing.json is missing or does not read: nothing is signed until it is reset');
  }
}

export interface SigningStore {
  /** The file as last read or written; `damaged` → `problem: 'signing'`. Never mutate what it returns. */
  get(): SigningFile | 'damaged';
  /**
   * In the commit queue: `fn` is given a private copy of the file as it stands at its turn, and its `next` is written
   * (unless unchanged) before the update resolves. Throws `SigningDamaged` on a damaged file, and a write's error.
   */
  update<T>(fn: (file: SigningFile) => { next: SigningFile; value: T }): Promise<T>;
  /** A fresh file, whatever was held: `org.resetSigning`'s, which the signer allows only on a damaged file. */
  reset(): Promise<void>;
}

export const emptySigningFile = (): SigningFile => ({ version: 1, pending: null, deliveries: [], abandoned: [], lastAsked: null, lastNotified: null });

export async function createSigningStore(deps: {
  files: OrgFiles;
  /** M1's commit queue (org-session.ts's `commit`). */
  commit<T>(body: () => Promise<T>): Promise<T>;
  /** The registration as it stands; its `signing` flag says signing.json was written. */
  registration(): { signing?: true } | null;
  /**
   * Writes `signing: true` into registration.json (read, change, write, keeping every other field). Called inside the
   * queue's turn, before signing.json's first write, so it must not queue a commit of its own.
   */
  markRegistration(): Promise<void>;
  log?(line: string): void;
}): Promise<SigningStore> {
  const { files, commit } = deps;
  const log = (line: string) => deps.log?.(`signing: ${line}`);
  const flagged = () => deps.registration()?.signing === true;

  /**
   * The file on disk as the store judges it: absent before the first write is a fresh file; anything else unread is
   * damaged. The pending slot's `hash` is the package's `stateHash` of its state, computed here whatever the file says
   * (a slot kept before the field existed has none), so `get()` names the slot synchronously.
   */
  async function read(): Promise<SigningFile | 'damaged'> {
    const raw = await files.read(SIGNING_FILE);
    if (raw === null && !flagged()) return emptySigningFile();
    if (isStoredSigningFile(raw)) return { ...raw, pending: raw.pending === null ? null : { ...raw.pending, hash: await stateHash(raw.pending.signed.state) } };
    log(`${SIGNING_FILE} is ${raw === null ? 'missing or unreadable' : 'malformed'} after its first write: nothing is signed until it is reset`);
    return 'damaged';
  }

  let file = await commit(read);

  async function persist(next: SigningFile): Promise<void> {
    if (!isSigningFile(next)) throw new TypeError(`an update would write a ${SIGNING_FILE} that does not read back`);
    if (!flagged()) await deps.markRegistration();
    try {
      await files.write(SIGNING_FILE, next);
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
        if (file === 'damaged') throw new SigningDamaged();
        const { next, value } = fn(structuredClone(file));
        if (JSON.stringify(next) !== JSON.stringify(file)) await persist(next);
        return value;
      });
    },
    reset: () => commit(() => persist(emptySigningFile())),
  };
}

/**
 * Inside an update: `file` (the update's private copy) with the pending slot's exposure grown by `where`, when the slot
 * holds `signed`: `{hub: true}` before its POST, `{machine}` before an `endpoint.state` act that carries it (the
 * deliveries'). Written before the send, so a send whose answer never came counts as exposed.
 */
export function withExposure(file: SigningFile, signed: SignedOrgState, where: { hub: true } | { machine: string }): SigningFile {
  const pending = file.pending;
  if (pending === null || canonicalize(pending.signed.state) !== canonicalize(signed.state)) return file;
  if ('hub' in where) pending.exposed.hub = true;
  else if (!pending.exposed.machines.includes(where.machine)) pending.exposed.machines.push(where.machine);
  return file;
}
