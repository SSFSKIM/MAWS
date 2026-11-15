// The search for a file the transcript names, its memory and its queue (UX wave U6c,
// docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §B; decisions 6 to 8 and 17). `names` answers
// whether some record among the newest `NAMED_SCAN_BYTES` of the session's transcript names the path by the rule
// (`@shared/files/named`), calls resolved, and by which kind of form (UX wave U6e,
// docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B and decision 22): it stops at the first
// counted form, and passes a result form, noting the newest whose call resolves, to look on for a counted one to its
// bound. The transcript is read from its end backwards through a read-only handle, as
// `readRestoredCost` reads one; a line is parsed only when its bytes hold every needle of the path (or the id of a call
// a result waits for), and never when it is one of the engine's request records. One job runs at a time for the whole
// daemon, and it gives the event loop back after every read, every parsed line and every few steps of the rule on a
// line, so a search of the whole bound does not hold the daemon's other work. It never throws, puts no path in a
// message, and writes nothing.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open as openFile, type FileHandle } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { callClass, needlesOf, PAUSE, rowClaimSteps, type PendingCall, type RowClaim } from '@shared/files/named';
import type { AppSessionId } from '@shared/graph/ids';

export const NAMED_SCAN_BYTES = 1024 ** 3; // read back from the transcript's end, at most: completeness, not cost
export const NAMED_CHUNK_BYTES = 1024 * 1024; // one read
export const NAMED_ROW_BYTES = 4 * 1024 * 1024; // a longer line is passed over, its bytes not kept
export const NAMED_CACHE_ENTRIES = 256;
export const NAMED_WAITING_MAX = 8; // distinct jobs waiting behind the running one
export const NAMED_WAIT_MS = 8_000; // a waiter's patience, inside a host request's ten seconds
export const NAMED_FINGERPRINT_BYTES = 4096; // as the engine host's search (`fingerprint`, src/engine-host/fs/search-text.ts)
export const NAMED_PENDING_MAX = 256; // results waiting for their calls in one search; an older one past it is not waited for
export const NAMED_PATH_MAX = 4096; // bytes of an asked path at most (the largest PATH_MAX of the platforms); a longer one is not named
export const NAMED_CLAIM_STEPS = 64; // steps of the rule on one row between two turns of the event loop (the branch review's finding 2)

// How a transcript is opened: read-only and without blocking (`O_RDONLY | O_NONBLOCK`), so a FIFO with no writer, or any
// other special file, opens at once and is refused on its descriptor's type before anything is read (the branch
// review's finding 6). Numeric flags, which `@shared/fs/read-tail`'s `OpenFile` does not take.
export type OpenTranscript = (path: string, flags: number) => Promise<FileHandle>;
const TRANSCRIPT_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK;

export interface NamedPathsOptions {
  transcript: (appSessionId: AppSessionId) => Promise<string | null>; // decision 13; null: the session has no transcript
  open?: OpenTranscript; // tests: the suite counts the bytes read
  bounds?: { scan?: number; chunk?: number; row?: number; entries?: number; waiting?: number; waitMs?: number; pending?: number }; // tests
  hooks?: { at?(point: 'opened' | 'searched', appSessionId: AppSessionId): Promise<void> }; // tests: after a job has opened the file and read its size; after a search, before its answer is proven and remembered
}
// UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, decision 22): which kind of form
// names the path: a counted one (the person's message, the agent's own text, a tool call's input), only a result one
// (what a tool returned, or a `user` row someone other than the person wrote), or none.
export type Naming = 'counted' | 'result' | false;
export interface NamedPaths {
  names(appSessionId: AppSessionId, path: string, signal?: AbortSignal): Promise<Naming>;
}

const NEWLINE = 0x0a;
const REQUEST_RECORD = Buffer.from('{"type":"api-request'); // the engine's per-request records, skipped unparsed as TranscriptJobs skips them
const EMPTY: Buffer = Buffer.alloc(0);
const NO_CALLS: string[] = [];
const CALL_ID = Buffer.from('"id":"'); // how the engine writes a tool_use block's id (pinned over test/fixtures/transcripts/)
const QUOTE = 0x22;

interface Span {
  offset: number; // of the line's first byte
  length: number; // without its newline
}
interface Identity {
  dev: bigint;
  ino: bigint;
}
interface Found {
  record: Span; // the naming record
  call: (Span & PendingCall) | null; // the call's record, when the name rests on a result form that waits for one
}
interface Checkpoint {
  offset: number; // how far the file was searched (the end of a whole line)
  fingerprint: string; // of the bytes before that offset
}
// A hit: where the counted form's record is. A result: where the result form's records are, and the checkpoint up to
// which no counted form was found. A miss: the checkpoint up to which nothing was found.
type Entry = ({ kind: 'hit' } & Found & Identity) | ({ kind: 'result'; found: Found } & Checkpoint & Identity) | ({ kind: 'miss' } & Checkpoint & Identity);

interface Waiter {
  answer(value: Naming): void;
}
interface Job {
  key: string; // the session, the transcript it was bound to when asked, and the path: who may join
  entry: string; // the session and the path: what is remembered (an entry rests on the file's identity, not its name)
  appSessionId: AppSessionId;
  transcript: string;
  path: string;
  waiters: Set<Waiter>;
}
type Read = (position: number, length: number) => Promise<Buffer>;

class Left extends Error {} // every waiter of the running job left: it stops at its next read

const sameFile = (entry: Identity, identity: Identity) => entry.dev === identity.dev && entry.ino === identity.ino;

// One parse, then the event loop given back. A line that does not parse is undefined, which names nothing.
async function parse(line: Buffer): Promise<unknown> {
  let value: unknown;
  try {
    value = JSON.parse(line.toString('utf8'));
  } catch {
    value = undefined;
  }
  await nextTurn();
  return value;
}

// The rule on one parsed row, given the event loop back at every pause of its scan (each 64 KiB of the scan's metered
// work, Decision Log 24) and every NAMED_CLAIM_STEPS of its other steps (a value looked at, a link met): a row under the
// row bound may hold a great many links. It stops at the first that names the path.
async function claimOf(row: unknown, path: string): Promise<RowClaim> {
  const steps = rowClaimSteps(row, path);
  for (let n = 1; ; n += 1) {
    const step = steps.next();
    if (step.done) return step.value;
    if (step.value === PAUSE || n % NAMED_CLAIM_STEPS === 0) await nextTurn();
  }
}

// The digest of the first and the last `span` bytes before `offset`, as the engine host's search takes one.
async function fingerprint(read: Read, offset: number, span: number): Promise<string> {
  const hash = createHash('sha1');
  const spans: [number, number][] = offset <= span ? [[0, offset]] : [[0, span], [offset - span, offset]];
  for (const [from, to] of spans) if (to > from) hash.update(await read(from, to - from));
  return hash.digest('hex');
}

export function createNamedPaths({ transcript, open = openFile, bounds = {}, hooks }: NamedPathsOptions): NamedPaths {
  const scanBytes = bounds.scan ?? NAMED_SCAN_BYTES;
  const chunkBytes = bounds.chunk ?? NAMED_CHUNK_BYTES;
  const rowBytes = bounds.row ?? NAMED_ROW_BYTES;
  const entriesMax = bounds.entries ?? NAMED_CACHE_ENTRIES;
  const waitingMax = bounds.waiting ?? NAMED_WAITING_MAX;
  const waitMs = bounds.waitMs ?? NAMED_WAIT_MS;
  const pendingMax = bounds.pending ?? NAMED_PENDING_MAX;

  const entries = new Map<string, Entry>(); // per session and path, the least recently asked first
  const waiting = new Map<string, Job>(); // in the order asked
  let running: Job | null = null;

  function remember(job: Job, entry: Entry): void {
    if (job.waiters.size === 0) return; // a job nobody waits for remembers nothing
    entries.delete(job.entry);
    entries.set(job.entry, entry);
    for (const key of entries.keys()) {
      if (entries.size <= entriesMax) break;
      entries.delete(key);
    }
  }

  // The line at `span`, parsed, if those bytes are still one whole line there: read with the byte before and the byte
  // after, each a newline (or the file's start).
  async function lineAt(read: Read, { offset, length }: Span): Promise<unknown> {
    if (length > rowBytes) return undefined;
    const from = offset === 0 ? 0 : offset - 1;
    const want = offset - from + length + 1;
    const bytes = await read(from, want);
    if (bytes.length !== want || bytes[bytes.length - 1] !== NEWLINE || (offset > 0 && bytes[0] !== NEWLINE)) return undefined;
    const line = bytes.subarray(offset - from, offset - from + length);
    return line.includes(NEWLINE) ? undefined : parse(line);
  }

  // A remembered or just-found name, read again from its record (and its call's): does it still name the path, by the
  // same kind of form?
  async function proves(read: Read, found: Found, path: string, kind: 'counted' | 'result'): Promise<boolean> {
    const claim = await claimOf(await lineAt(read, found.record), path);
    if (claim.names) return kind === 'counted';
    if (kind === 'counted') return false;
    const { call } = found;
    if (call === null) return claim.other === true;
    if (!claim.pending.some((pending) => pending.toolUseId === call.toolUseId && pending.when === call.when)) return false;
    return callClass(await lineAt(read, call), call.toolUseId) === call.when;
  }

  // The newest record of a region that names the path by a counted form (`found`), the newest result form whose call
  // resolves (`result`), and the calls the results it met wait for, newest first.
  function scanner(read: Read, path: string) {
    const needles = needlesOf(path).map((needle) => Buffer.from(needle));
    const pending = new Map<string, { when: PendingCall['when']; record: Span }[]>(); // per call id, the newest results waiting for it
    const state = { found: null as Found | null, result: null as Found | null, pending };
    const note = (result: Found) => {
      if (state.result === null || result.record.offset > state.result.record.offset) state.result = result;
    };

    // The waited-for call ids a line holds, in one pass over it however many wait: each `"id":"…"` read and looked up.
    function waitedIdsIn(line: Buffer): string[] {
      const ids: string[] = [];
      for (let at = line.indexOf(CALL_ID); at !== -1; at = line.indexOf(CALL_ID, at + CALL_ID.length)) {
        const close = line.indexOf(QUOTE, at + CALL_ID.length);
        if (close === -1) break;
        const id = line.toString('utf8', at + CALL_ID.length, close);
        if (pending.has(id) && !ids.includes(id)) ids.push(id);
      }
      return ids;
    }

    // One whole line of `buffer`, [start, end), whose first byte is at `base + start` in the file.
    async function consider(buffer: Buffer, start: number, end: number, base: number, names: boolean): Promise<void> {
      const length = end - start;
      if (length === 0 || length > rowBytes) return;
      const line = buffer.subarray(start, end);
      if (line.subarray(0, REQUEST_RECORD.length).equals(REQUEST_RECORD)) return;
      const candidate = names && needles.every((needle) => line.includes(needle));
      const calls = pending.size === 0 ? NO_CALLS : waitedIdsIn(line);
      if (!candidate && calls.length === 0) return;
      const row = await parse(line);
      const span = { offset: base + start, length };
      if (candidate) {
        const claim = await claimOf(row, path);
        if (claim.names) {
          state.found = { record: span, call: null };
          return;
        }
        if (claim.other) note({ record: span, call: null }); // a `user` row someone other than the person wrote (Decision Log 8)
        for (const { toolUseId, when } of claim.pending) {
          const waits = pending.get(toolUseId);
          if (waits === undefined) {
            if (pending.size >= pendingMax) continue; // past the bound an older result is not waited for: the refusal
            pending.set(toolUseId, [{ when, record: span }]);
          } else if (!waits.some((wait) => wait.when === when)) waits.push({ when, record: span }); // the newest result of each form
        }
      }
      for (const id of calls) {
        const found = callClass(row, id);
        if (found === null) continue; // not the call's record (the result itself, say)
        const match = pending.get(id)!.find((wait) => wait.when === found);
        pending.delete(id); // the nearest older call decides
        if (match) note({ record: match.record, call: { ...span, toolUseId: id, when: match.when } });
      }
    }

    // The whole lines of [low, high), newest first, until a counted form is found. `top`: `high` is the file's size, and
    // the bytes after its last newline are a line with no end, passed over; `onTop` learns where the whole lines end.
    // Else `high` is a line's start. `lowIsLine`: `low` is a line's start (else the bytes before its first newline there
    // are the end of a line that began earlier, and are passed over). `names`: look for names, not only for calls; a
    // region that looks only for calls ends once none is waited for.
    async function region(low: number, lowIsLine: boolean, high: number, top: boolean, names: boolean, onTop?: (end: number) => Promise<void>): Promise<void> {
      const done = () => state.found !== null || (!names && pending.size === 0);
      let end = high;
      let head = EMPTY; // the end of a line that began before `end`, with its newline, carried to the next read
      let overlong = false; // the line that ends at `end` is longer than the row bound: its bytes are not kept
      let seeking = top; // still in the line with no end
      while (end > low && !done()) {
        const start = Math.max(low, end - chunkBytes);
        const chunk = await read(start, end - start);
        if (chunk.length !== end - start) throw new Error('the transcript shrank while it was read');
        let buffer: Buffer = head.length > 0 ? Buffer.concat([chunk, head]) : chunk;
        let limit = buffer.length;
        if (seeking || overlong) {
          const last = chunk.lastIndexOf(NEWLINE);
          end = start;
          if (last === -1) continue;
          limit = last + 1;
          if (seeking) await onTop?.(start + limit);
          seeking = overlong = false;
          buffer = chunk;
        }
        const first = start === low && lowIsLine ? 0 : buffer.indexOf(NEWLINE) + 1;
        let lineEnd = limit - 1; // the newline that ends the line in hand
        while (lineEnd >= first && !done()) {
          const newline = lineEnd === 0 ? -1 : buffer.lastIndexOf(NEWLINE, lineEnd - 1);
          await consider(buffer, newline + 1, lineEnd, start, names);
          lineEnd = newline;
        }
        head = first > 0 ? buffer.subarray(0, first) : EMPTY;
        if (head.length - 1 > rowBytes) {
          head = EMPTY;
          overlong = true;
        }
        end = start;
      }
    }

    return { state, region };
  }

  async function decide(job: Job, handle: FileHandle): Promise<Naming> {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) return false; // judged on the descriptor, before any read
    await hooks?.at?.('opened', job.appSessionId);
    const identity = { dev: stat.dev, ino: stat.ino };
    const size = Number(stat.size);
    const read: Read = async (position, length) => {
      if (job.waiters.size === 0) throw new Left();
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      await nextTurn();
      return buffer.subarray(0, bytesRead);
    };

    const entry = entries.get(job.entry);
    if (entry?.kind === 'hit') {
      if (sameFile(entry, identity) && (await proves(read, entry, job.path, 'counted'))) {
        remember(job, entry);
        return 'counted';
      }
      entries.delete(job.entry);
    }
    // a remembered result form stands while its records prove it and its checkpoint holds
    let known: Found | null = null;
    if (entry?.kind === 'result') {
      if (sameFile(entry, identity) && (await proves(read, entry.found, job.path, 'result'))) known = entry.found;
      else entries.delete(job.entry);
    }

    // The window: the newest `scanBytes`, read from one byte before so that a line starting exactly there is whole.
    const floor = Math.max(0, size - scanBytes);
    const bottom = floor > 0 ? floor - 1 : 0;
    let from = bottom;
    let fromIsLine = floor === 0;
    let verified: string | null = null;
    const checkpoint = entry?.kind === 'miss' || (entry?.kind === 'result' && known !== null) ? entry : null;
    if (checkpoint !== null) {
      if (sameFile(checkpoint, identity) && checkpoint.offset >= floor && checkpoint.offset <= size && (await fingerprint(read, checkpoint.offset, NAMED_FINGERPRINT_BYTES)) === checkpoint.fingerprint) {
        from = checkpoint.offset;
        fromIsLine = true;
        verified = checkpoint.fingerprint;
      } else {
        entries.delete(job.entry);
        known = null;
      }
    }

    let searchedTo: number | null = fromIsLine ? from : null;
    let began: string | null = verified; // the fingerprint before `searchedTo`, as the search began
    const { state, region } = scanner(read, job.path);
    await region(from, fromIsLine, size, true, true, async (end) => {
      searchedTo = end;
      began = await fingerprint(read, end, NAMED_FINGERPRINT_BYTES);
    });
    // a result added since a checkpoint may wait for a call older than it; not looked for once a result form is in hand
    if (state.found === null && state.result === null && known === null && state.pending.size > 0 && from > bottom) await region(bottom, floor === 0, from, false, false);
    await hooks?.at?.('searched', job.appSessionId);

    if (state.found !== null) {
      if (!(await proves(read, state.found, job.path, 'counted'))) return false;
      remember(job, { kind: 'hit', ...state.found, ...identity });
      return 'counted';
    }
    const result = state.result ?? known;
    if (state.result !== null && !(await proves(read, state.result, job.path, 'result'))) return false;
    // the checkpoint up to which no counted form stands, if the file is still the one searched
    let reached: Checkpoint | null = null;
    if (searchedTo !== null && began !== null) {
      const offset: number = searchedTo;
      const now = await handle.stat({ bigint: true });
      const ended = offset === from && verified !== null ? verified : await fingerprint(read, offset, NAMED_FINGERPRINT_BYTES);
      if (Number(now.size) >= size && ended === began) reached = { offset, fingerprint: began };
    }
    if (result !== null) {
      if (reached !== null) remember(job, { kind: 'result', found: result, ...reached, ...identity });
      return 'result';
    }
    if (reached !== null) remember(job, { kind: 'miss', ...reached, ...identity });
    return false;
  }

  // A job never throws: every failure (an unreadable transcript, a read error, a waiter that left) is "not named", and
  // nothing of it is remembered. A file system call that never returns (a mount that stopped answering) keeps the one
  // job slot until the daemon restarts: ruled, since freeing it would let each later search hold one more of the
  // daemon's few file system threads.
  async function run(job: Job): Promise<Naming> {
    let handle: FileHandle | null = null;
    try {
      handle = await open(job.transcript, TRANSCRIPT_FLAGS);
      return await decide(job, handle);
    } catch {
      return false;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  function pump(): void {
    if (running !== null) return;
    const next = waiting.values().next();
    if (next.done) return;
    const job = next.value;
    waiting.delete(job.key);
    running = job;
    void run(job).then((value) => {
      running = null;
      for (const waiter of [...job.waiters]) waiter.answer(value);
      pump();
    });
  }

  // The job a request joins once its session's transcript is known: the job of the same session, transcript and path,
  // running or waiting, or a new waiting one; null when the queue is full.
  function jobFor(appSessionId: AppSessionId, located: string, path: string): Job | null {
    const key = `${appSessionId}\u0000${located}\u0000${path}`;
    const job = running !== null && running.key === key && running.waiters.size > 0 ? running : waiting.get(key);
    if (job !== undefined) return job;
    if (waiting.size >= waitingMax) return null; // the queue is full: the refusal at once
    const created: Job = { key, entry: `${appSessionId}\u0000${path}`, appSessionId, transcript: located, path, waiters: new Set() };
    waiting.set(key, created);
    return created;
  }

  return {
    // A request's patience and its client's signal run from the moment it is made, the locator's wait included (fix
    // round 1, item 3): it finds its session's transcript itself, before it looks for a job (decision 13; the branch
    // review's finding 5: `/clear` keeps the app session id and binds it to a new transcript, and a request never joins
    // a job that reads another transcript than the one its session is bound to when it is made), and then waits in the
    // queue only for what is left of its patience. A request that ended while the locator was asked queues nothing. No
    // transcript, a locator that throws, a full queue, a waiter that leaves: not named.
    names(appSessionId: AppSessionId, path: string, signal?: AbortSignal): Promise<Naming> {
      if (signal?.aborted) return Promise.resolve(false);
      // `files.read` asks for a missing file's path too, which no `realpath` has bounded: past the bound, not named at
      // once, and no transcript looked for (the work meter's fix pass, item 2; the needles' pattern runs on the path)
      if (Buffer.byteLength(path) > NAMED_PATH_MAX) return Promise.resolve(false);
      return new Promise<Naming>((resolve) => {
        let joined: Job | null = null;
        let answered = false;
        const waiter: Waiter = {
          answer(value) {
            if (answered) return;
            answered = true;
            joined?.waiters.delete(waiter);
            clearTimeout(timer);
            signal?.removeEventListener('abort', leave);
            resolve(value);
          },
        };
        // A waiter that leaves (its client ended, or its patience ran out) is answered not named; a waiting job left with
        // no waiter is dropped, and a running one stops at its next read.
        const leave = () => {
          const job = joined;
          waiter.answer(false);
          if (job !== null && job.waiters.size === 0 && waiting.get(job.key) === job) waiting.delete(job.key);
        };
        const timer = setTimeout(leave, waitMs);
        signal?.addEventListener('abort', leave, { once: true });
        transcript(appSessionId).then(
          (located) => {
            if (answered) return; // it ended while the locator was asked
            const job = located === null ? null : jobFor(appSessionId, located, path);
            if (job === null) return waiter.answer(false);
            joined = job;
            job.waiters.add(waiter);
            pump();
          },
          () => waiter.answer(false),
        );
      });
    },
  };
}
