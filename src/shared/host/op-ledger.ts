// RL4's operation ledger (O10 M7; RL §4.7; Interfaces §H): the one durable record an executing side keeps for each
// remote action's `opId`, bound to the operation and its sender, so an action runs once, never twice, and a lost
// acknowledgement resolves by `query`. The engine host keeps one for lane B (`<profile>/supervisor/ops.jsonl`) and the
// endpoint one for its own actions (`<stateDir>/ops.jsonl`); sminos keeps lane A's in its own code. O3's services in
// `mawsd` can keep theirs the same way when main's commands move there.
//
// One JSON record per line, appended and fsynced: the claim before the run, then its result, or a tombstone for an op a
// query answered `not-received`:
//   { opId, opCreated, at, claim: { member, device, fingerprint, target, name, context? } }
//   { opId, result }
//   { opId, opCreated, at, tombstone: true }
// Every entry binds its `opId` to one operation and one sender: a known id met again under another fingerprint or member
// is `op-conflict`, and nothing of the stored one is said. Everything is synchronous, so a caller's checks, the claim and
// the start of the run happen in one turn of the event loop, with no other request between them.
//
// At open the file is read whole and compacted: entries claimed more than KEPT_S ago go (by then any query for them is
// past the horizon, `expired`), and a torn last line (a crash mid-append) is cut, a whole last record that lost only its
// newline kept. A line before the last that doesn't parse, a record of no known shape, or a file that is a symlink, not
// this uid's, or open to others makes the ledger unreadable, and an unreadable ledger answers every op `unavailable`,
// never `not-received`: it can't say what it holds. So does one whose append failed (a claim, a result or a tombstone):
// the file may then hold a record the entries don't (an fsync that failed after the write) or a torn tail, and a later
// append would bury that tail mid-file. It stays closed until it is opened again (a restart of its owner), when the load
// reconciles it with the file as above; a restart is also where a claim left in progress is settled.
//
// What the file holds may have reached only the page cache (an fsync that failed in the last process), and a restart
// does not flush it: the open fsyncs the file and its directory before it serves a record, and one that can't stays
// closed. A closed ledger logs one line naming its file and why, and says why as a word (`closed`): `unreadable`,
// `unsynced` or `write-failed`, for its owner's status.
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { KEPT_S, OP_HORIZON_S } from 'org-protocol';

/** Who sent an operation and what it is: the binding a query is authorized against. `target` is the executor's own word
 * for what the op acts on (the engine host's appSessionId; null for the machine itself). */
export type OpClaim = { member: string; device: string; fingerprint: string; target: string | null; name: string; context?: unknown };

/** What a new act under a known id meets, or why it is refused before anything is claimed. */
export type OpAnswer = { state: 'done'; result: unknown } | { state: 'in-progress' } | { state: 'refused'; reason: string };

/** RL4's query answer, with the stored binding when the op is held. */
export type OpQueryAnswer =
  | ({ state: 'done'; outcome: unknown } & Omit<OpClaim, 'context'>)
  | ({ state: 'in-progress' } & Omit<OpClaim, 'context'>)
  | { state: 'not-received' | 'expired' | 'unavailable' };

/** Why a ledger is closed: its file can't be read, what it holds can't be made durable, or a write failed. */
export type OpLedgerClosed = 'unreadable' | 'unsynced' | 'write-failed';

type Entry = { opCreated: string; at: number; claim: OpClaim | null; result?: { value: unknown } };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function isClaim(value: unknown): value is OpClaim {
  return (
    isObject(value) &&
    isText(value.member) &&
    isText(value.device) &&
    isText(value.fingerprint) &&
    (value.target === null || isText(value.target)) &&
    isText(value.name)
  );
}

export class OpLedger {
  readonly #path: string;
  readonly #dir: string;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #entries = new Map<string, Entry>();
  #closed: OpLedgerClosed | null = null;

  private constructor(dir: string, name: string, options: { now?(): number; log?(line: string): void }) {
    this.#dir = dir;
    this.#path = join(dir, name);
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => {});
  }

  /** The ledger `dir/name`, read and compacted; nothing is created until the first record (then `dir` too, 0700). */
  static open(dir: string, name: string, options: { now?(): number; log?(line: string): void } = {}): OpLedger {
    const ledger = new OpLedger(dir, name, options);
    ledger.#load();
    return ledger;
  }

  /** Whether the ledger answers: not when its file could not be read or an append failed; every op is then `unavailable`. */
  get readable(): boolean {
    return this.#closed === null;
  }

  /** Why the ledger answers nothing until it is opened again, or null while it answers. */
  get closed(): OpLedgerClosed | null {
    return this.#closed;
  }

  /**
   * A new act under `opId`: a known id is answered from the ledger (its result, `in-progress` while only claimed, a
   * tombstone `tombstoned`, another fingerprint or member `op-conflict`); an op past the horizon is `expired`; then
   * `check` may refuse it (the executor's own checks: its context, its digest); else the claim is written and fsynced,
   * and the caller runs it and calls `finish`. Nothing is claimed for an op refused.
   */
  begin(opId: string, opCreated: string, claim: OpClaim, check: () => string | null): { kind: 'claimed' } | { kind: 'answered'; answer: OpAnswer } {
    const answered = (answer: OpAnswer) => ({ kind: 'answered' as const, answer });
    if (this.#closed !== null) return answered({ state: 'refused', reason: 'unavailable' });
    const known = this.#entries.get(opId);
    if (known !== undefined) {
      if (known.claim === null) return answered({ state: 'refused', reason: 'tombstoned' });
      if (known.claim.member !== claim.member || known.claim.fingerprint !== claim.fingerprint) return answered({ state: 'refused', reason: 'op-conflict' });
      return answered(known.result === undefined ? { state: 'in-progress' } : { state: 'done', result: known.result.value });
    }
    if (this.#expired(opCreated)) return answered({ state: 'refused', reason: 'expired' });
    const refusal = check();
    if (refusal !== null) return answered({ state: 'refused', reason: refusal });
    const at = this.#now();
    try {
      this.#append({ opId, opCreated, at, claim });
    } catch (error) {
      this.#failed('an operation could not be claimed', error);
      return answered({ state: 'refused', reason: 'unavailable' });
    }
    this.#entries.set(opId, { opCreated, at, claim });
    return { kind: 'claimed' };
  }

  /** The claimed op's result, appended; one that can't be written closes the ledger (logged), its op `in-progress` on disk. */
  finish(opId: string, result: unknown): void {
    const entry = this.#entries.get(opId);
    if (entry === undefined || entry.claim === null || entry.result !== undefined) return;
    entry.result = { value: result };
    try {
      this.#append({ opId, result });
    } catch (error) {
      this.#failed('the result of an operation could not be kept', error);
    }
  }

  /**
   * RL4's query: `expired` past the horizon by the asker's `opCreated`, whatever the ledger holds; the stored result
   * (`done`) or `in-progress`, each with its binding; else `not-received`, which with `tombstoneIfAbsent` is said only
   * once a tombstone is on disk, so a copy arriving later is refused and never runs.
   */
  query(opId: string, opCreated: string, tombstoneIfAbsent: boolean): OpQueryAnswer {
    if (this.#closed !== null) return { state: 'unavailable' };
    if (this.#expired(opCreated)) return { state: 'expired' };
    const entry = this.#entries.get(opId);
    if (entry?.claim != null) {
      const { member, device, fingerprint, target, name } = entry.claim;
      const binding = { member, device, fingerprint, target, name };
      return entry.result === undefined ? { state: 'in-progress', ...binding } : { state: 'done', outcome: entry.result.value, ...binding };
    }
    if (entry === undefined && tombstoneIfAbsent) {
      const at = this.#now();
      try {
        this.#append({ opId, opCreated, at, tombstone: true });
      } catch (error) {
        this.#failed('an operation could not be tombstoned', error);
        return { state: 'unavailable' };
      }
      this.#entries.set(opId, { opCreated, at, claim: null });
    }
    return { state: 'not-received' };
  }

  #expired(opCreated: string): boolean {
    const created = Date.parse(opCreated);
    return !Number.isFinite(created) || this.#now() - created > OP_HORIZON_S * 1000;
  }

  // ---- The file -----------------------------------------------------------------------------------------------------

  #load(): void {
    let text: string;
    try {
      const stat = lstatOrNull(this.#path);
      if (stat === null) return;
      if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error('is not a private regular file of this user');
      text = fs.readFileSync(this.#path, 'utf8');
    } catch (error) {
      return this.#close('unreadable', `it cannot be read (${(error as Error).message})`);
    }
    try {
      syncFile(this.#path);
      syncDirectory(this.#dir);
    } catch (error) {
      return this.#close('unsynced', `what it holds cannot be made durable (${(error as Error).message})`);
    }
    const raw = text.split('\n');
    const terminated = raw[raw.length - 1] === '';
    if (terminated) raw.pop();
    let tidy = !terminated;
    for (let i = 0; i < raw.length; i++) {
      let record: unknown;
      try {
        record = JSON.parse(raw[i]);
      } catch {
        // Only the last line may be torn: a crash mid-append. One before it means the file is not what was written.
        if (i === raw.length - 1 && !terminated) continue;
        return this.#close('unreadable', `line ${i + 1} does not parse`);
      }
      if (!this.#take(record)) return this.#close('unreadable', `line ${i + 1} is no ledger record`);
    }
    const cutoff = this.#now() - KEPT_S * 1000;
    for (const [opId, entry] of this.#entries) {
      if (entry.at < cutoff) {
        this.#entries.delete(opId);
        tidy = true;
      }
    }
    if (!tidy) return;
    try {
      this.#rewrite();
    } catch (error) {
      this.#close('write-failed', `its compaction cannot be written (${(error as Error).message})`);
    }
  }

  /** One record read into the entries; false for one of no known shape. A result for an op no longer held is dropped. */
  #take(record: unknown): boolean {
    if (!isObject(record) || !isText(record.opId)) return false;
    const { opId } = record;
    if ('result' in record) {
      const entry = this.#entries.get(opId);
      if (entry?.claim != null && entry.result === undefined) entry.result = { value: record.result };
      return true;
    }
    if (!isText(record.opCreated) || typeof record.at !== 'number') return false;
    if (record.tombstone === true) {
      if (!this.#entries.has(opId)) this.#entries.set(opId, { opCreated: record.opCreated, at: record.at, claim: null });
      return true;
    }
    if (!isClaim(record.claim)) return false;
    if (!this.#entries.has(opId)) this.#entries.set(opId, { opCreated: record.opCreated, at: record.at, claim: record.claim });
    return true;
  }

  /** The ledger closed: every op `unavailable` until it is opened again, said once in the log. */
  #close(why: OpLedgerClosed, detail: string): void {
    this.#closed = why;
    this.#entries.clear();
    this.#log(`the operation ledger ${this.#path} is closed (${why}): ${detail}; every operation is unavailable until its process restarts`);
  }

  /** A failed append: the ledger answers every op `unavailable` until it is opened again. */
  #failed(what: string, error: unknown): void {
    this.#close('write-failed', `${what} (${(error as Error).message})`);
  }

  /** The kept entries written whole to a temporary file, fsynced and renamed over the ledger. */
  #rewrite(): void {
    const out: string[] = [];
    for (const [opId, entry] of this.#entries) {
      if (entry.claim === null) out.push(JSON.stringify({ opId, opCreated: entry.opCreated, at: entry.at, tombstone: true }));
      else {
        out.push(JSON.stringify({ opId, opCreated: entry.opCreated, at: entry.at, claim: entry.claim }));
        if (entry.result !== undefined) out.push(JSON.stringify({ opId, result: entry.result.value }));
      }
    }
    const temporary = `${this.#path}.${randomBytes(6).toString('base64url')}.tmp`;
    try {
      writeAll(temporary, 'wx', out.map((line) => `${line}\n`).join(''));
      fs.renameSync(temporary, this.#path);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    syncDirectory(this.#dir);
  }

  #append(record: object): void {
    fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    const created = lstatOrNull(this.#path) === null;
    writeAll(this.#path, 'a', `${JSON.stringify(record)}\n`);
    if (created) syncDirectory(this.#dir);
  }
}

function lstatOrNull(path: string): fs.Stats | null {
  try {
    return fs.lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** `text` written to `path` (opened with `flags`, created 0600) and fsynced before the file is closed. */
function writeAll(path: string, flags: string, text: string): void {
  const fd = fs.openSync(path, flags, 0o600);
  try {
    const bytes = Buffer.from(text, 'utf8');
    let at = 0;
    while (at < bytes.length) at += fs.writeSync(fd, bytes, at, bytes.length - at);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function syncFile(path: string): void {
  const fd = fs.openSync(path, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function syncDirectory(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
