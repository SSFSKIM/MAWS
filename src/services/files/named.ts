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
//
// UX wave U6b-4c (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, Interfaces §E, decision 8, W3):
// `namesInAgent` is the same search over one subagent's transcript, for a follow that names the agent. Its file is found
// under the session's own transcript folder by reading directories alone, opened with no link anywhere on its way (only
// where an open can be confirmed to have followed none, `OPENS_CONFIRMED`), and read by the subagent's rule
// (`agentRowClaimSteps`: no `user` record of it counts). It takes the same slot, queue, patience and memory, keyed apart
// by the agent's id, and `names` never reads a subagent's file. The branch panel (2026-11-19): the follow names the
// conversation whose subagent drew the link (its engine session), which must be the transcript the session is bound to
// now, and only a record that carries that conversation's id and the agent's own counts, so a file put in the found
// file's place between the walk and the open, or one of another conversation, names nothing.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open as openFile, readdir, realpath, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { agentRowClaimSteps, callClass, needlesOf, PAUSE, rowClaimSteps, type PendingCall, type RowClaim } from '@shared/files/named';
import type { AppSessionId } from '@shared/graph/ids';
import { confirmOpened, NO_LINK, OPENS_CONFIRMED, walk, WALKED } from '../fs/no-link';

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
export const NAMED_AGENT_DIRS_MAX = 4096; // U6b-4c: directories read to find one agent's file; past it, not named
// U6b-4c: where a subagent's file is, as the engine host's walk reads it (src/engine-host/fs/subagents.ts: `MAX_DEPTH`
// and `AGENT_TRANSCRIPT`): `agent-<agentId>.jsonl` in `<session>/subagents/` or up to three directories below it (a
// workflow run's are under `subagents/workflows/<runId>/`). A suite holds the two readings together.
const AGENT_DEPTH_MAX = 3;
const agentFileName = (agentId: string) => `agent-${agentId}.jsonl`;
const TRANSCRIPT_EXTENSION = '.jsonl';
const isTranscriptName = (path: string) => path.endsWith(TRANSCRIPT_EXTENSION) && basename(path).length > TRANSCRIPT_EXTENSION.length;
// The conversation a transcript is of: its engine session, the file's name without `.jsonl` (`transcriptPathOf`)
const conversationOf = (transcript: string) => basename(transcript).slice(0, -TRANSCRIPT_EXTENSION.length);
// U6b-4c (the branch panel): a subagent's records, read by its rule, of which only those the engine wrote for this agent of
// this conversation are its own (every record of a subagent's file carries `sessionId`, the conversation, and `agentId`:
// test/fixtures/transcripts/…/subagents/). The open proves the way to the file; this proves the file is the one asked
// for, whatever took the found file's place between the walk and the open.
const agentReading = (conversation: string, agentId: string): Reading => ({
  rule: agentRowClaimSteps,
  own: (row) => (typeof row === 'object' && row !== null && (row as { sessionId?: unknown }).sessionId === conversation && (row as { agentId?: unknown }).agentId === agentId ? row : undefined),
});

// How a transcript is opened: read-only and without blocking (`O_RDONLY | O_NONBLOCK`), so a FIFO with no writer, or any
// other special file, opens at once and is refused on its descriptor's type before anything is read (the branch
// review's finding 6). Numeric flags, which `@shared/fs/read-tail`'s `OpenFile` does not take.
export type OpenTranscript = (path: string, flags: number) => Promise<FileHandle>;
const TRANSCRIPT_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK;

export interface NamedPathsOptions {
  transcript: (appSessionId: AppSessionId) => Promise<string | null>; // decision 13; null: the session has no transcript
  open?: OpenTranscript; // tests: the suite counts the bytes read
  bounds?: { scan?: number; chunk?: number; row?: number; entries?: number; waiting?: number; waitMs?: number; pending?: number; dirs?: number }; // tests
  // tests: after a job has opened the file and read its size; after a search, before its answer is proven and remembered;
  // U6b-4c: after the walk found a subagent's file, before it is opened; where the open walks first (Linux), between its
  // walk of the file's folders and the open
  hooks?: { at?(point: 'opened' | 'searched' | 'found' | 'walked', appSessionId: AppSessionId): Promise<void> };
}
// UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, decision 22): which kind of form
// names the path: a counted one (the person's message, the agent's own text, a tool call's input), only a result one
// (what a tool returned, or a `user` row someone other than the person wrote), or none.
export type Naming = 'counted' | 'result' | false;
// U6b-4c (the branch panel): the subagent a follow names, with the conversation (the engine session) whose transcript
// drew the link
export interface AgentOf {
  id: string;
  engineSessionId: string;
}
export interface NamedPaths {
  // U6b-4c (the branch panel): `located` as `namesInAgent`'s, for a follow whose Markdown source is admitted by name
  names(appSessionId: AppSessionId, path: string, signal?: AbortSignal, located?: () => void): Promise<Naming>;
  // U6b-4c (Interfaces §E): the search over the one transcript of the session's subagent `agent.id`, in the conversation
  // `agent.engineSessionId`, which must be the one the session's transcript is now (not named otherwise). `located` is
  // called exactly once, when the request's call of the transcript locator has settled (answered, thrown, or never made),
  // also after the request itself was answered: a follow keeps its place until then (decision 7).
  namesInAgent(appSessionId: AppSessionId, agent: AgentOf, path: string, signal?: AbortSignal, located?: () => void): Promise<Naming>;
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
  key: string; // the session, the transcript it was bound to when asked, (U6b-4c) the agent, and the path: who may join
  entry: string; // the session, (U6b-4c) the agent, and the path: what is remembered (an entry rests on the file's identity, not its name)
  appSessionId: AppSessionId;
  transcript: string;
  agentId: string | null; // U6b-4c: the subagent whose transcript, under the session's transcript folder, is searched; null: the session's own
  path: string;
  waiters: Set<Waiter>;
}
type Rule = typeof rowClaimSteps; // how one record names the path: the session's rule, or (U6b-4c) a subagent's
// How a job reads its file's records: the rule, and which parsed records are the file's own to read (U6b-4c, the branch
// panel: a subagent's are those that carry its conversation's id and its own; any other is passed over as unparsed)
interface Reading {
  rule: Rule;
  own(row: unknown): unknown;
}
const EVERY_ROW: Reading = { rule: rowClaimSteps, own: (row) => row };
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
async function claimOf(row: unknown, path: string, rule: Rule): Promise<RowClaim> {
  const steps = rule(row, path);
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
  const dirsMax = bounds.dirs ?? NAMED_AGENT_DIRS_MAX;
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
  async function lineAt(read: Read, { offset, length }: Span, reading: Reading): Promise<unknown> {
    if (length > rowBytes) return undefined;
    const from = offset === 0 ? 0 : offset - 1;
    const want = offset - from + length + 1;
    const bytes = await read(from, want);
    if (bytes.length !== want || bytes[bytes.length - 1] !== NEWLINE || (offset > 0 && bytes[0] !== NEWLINE)) return undefined;
    const line = bytes.subarray(offset - from, offset - from + length);
    return line.includes(NEWLINE) ? undefined : reading.own(await parse(line));
  }

  // A remembered or just-found name, read again from its record (and its call's): does it still name the path, by the
  // same kind of form?
  async function proves(read: Read, found: Found, path: string, kind: 'counted' | 'result', reading: Reading): Promise<boolean> {
    const claim = await claimOf(await lineAt(read, found.record, reading), path, reading.rule);
    if (claim.names) return kind === 'counted';
    if (kind === 'counted') return false;
    const { call } = found;
    if (call === null) return claim.other === true;
    if (!claim.pending.some((pending) => pending.toolUseId === call.toolUseId && pending.when === call.when)) return false;
    return callClass(await lineAt(read, call, reading), call.toolUseId) === call.when;
  }

  // The newest record of a region that names the path by a counted form (`found`), the newest result form whose call
  // resolves (`result`), and the calls the results it met wait for, newest first.
  function scanner(read: Read, path: string, reading: Reading) {
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
      const row = reading.own(await parse(line));
      const span = { offset: base + start, length };
      if (candidate) {
        const claim = await claimOf(row, path, reading.rule);
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
    const reading = job.agentId === null ? EVERY_ROW : agentReading(conversationOf(job.transcript), job.agentId);
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
      if (sameFile(entry, identity) && (await proves(read, entry, job.path, 'counted', reading))) {
        remember(job, entry);
        return 'counted';
      }
      entries.delete(job.entry);
    }
    // a remembered result form stands while its records prove it and its checkpoint holds
    let known: Found | null = null;
    if (entry?.kind === 'result') {
      if (sameFile(entry, identity) && (await proves(read, entry.found, job.path, 'result', reading))) known = entry.found;
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
    const { state, region } = scanner(read, job.path, reading);
    await region(from, fromIsLine, size, true, true, async (end) => {
      searchedTo = end;
      began = await fingerprint(read, end, NAMED_FINGERPRINT_BYTES);
    });
    // a result added since a checkpoint may wait for a call older than it; not looked for once a result form is in hand
    if (state.found === null && state.result === null && known === null && state.pending.size > 0 && from > bottom) await region(bottom, floor === 0, from, false, false);
    await hooks?.at?.('searched', job.appSessionId);

    if (state.found !== null) {
      if (!(await proves(read, state.found, job.path, 'counted', reading))) return false;
      remember(job, { kind: 'hit', ...state.found, ...identity });
      return 'counted';
    }
    const result = state.result ?? known;
    if (state.result !== null && !(await proves(read, state.result, job.path, 'result', reading))) return false;
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
      handle = job.agentId === null ? await open(job.transcript, TRANSCRIPT_FLAGS) : await openAgent(job, job.agentId);
      if (handle === null) return false;
      if (job.agentId !== null) stay(job); // U6b-4c: a subagent's descriptor is judged only for a job someone waits for
      return await decide(job, handle);
    } catch {
      return false;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  // U6b-4c (Interfaces §E): the transcript of the session's subagent `agentId`, opened inside the job's slot, or null. The
  // folder that holds the session's transcript `T` is taken by its real path `P`; the session's folder `S` is `P` and `T`'s
  // name without `.jsonl`, resolved no further, and `S` and `S/subagents` must each be a directory itself. The walk finds
  // the one file of that name; it does not prove the way to it, since a folder can be replaced by a link between two of
  // its reads. The open does: by its path under `P`, with no link anywhere on its way (../fs/no-link.ts; on Linux its
  // folders walked first and the descriptor's own path confirmed), so `S` and everything below it is inside the check.
  // A job whose last waiter has left starts no further stage on the disk (the branch's M3 review; W2 a, W3): a call that
  // stalls would hold the one slot for nobody.
  async function openAgent(job: Job, agentId: string): Promise<FileHandle | null> {
    const folder = join(await realpath(dirname(job.transcript)), basename(job.transcript).slice(0, -TRANSCRIPT_EXTENSION.length));
    stay(job);
    const subagents = join(folder, 'subagents');
    if (!(await lstat(folder)).isDirectory()) return null;
    stay(job);
    if (!(await lstat(subagents)).isDirectory()) return null;
    const found = await agentFileIn(subagents, agentFileName(agentId), job);
    if (found === null) return null;
    await hooks?.at?.('found', job.appSessionId);
    stay(job);
    if (WALKED) {
      await walk(dirname(found));
      await hooks?.at?.('walked', job.appSessionId);
      stay(job);
    }
    const handle = await open(found, TRANSCRIPT_FLAGS | NO_LINK);
    try {
      stay(job); // an open that answered for nobody is closed, nothing asked of its descriptor
      await confirmOpened(handle.fd, found);
    } catch {
      await handle.close().catch(() => {});
      return null;
    }
    return handle; // a regular file is judged on its descriptor, as the session's own transcript is (`decide`)
  }

  // The one regular file `name` in `top` or at most AGENT_DEPTH_MAX directories below it, by `readdir` with file types:
  // a folder is an entry that is a directory itself, the file an entry that is a regular file itself, and an entry seen
  // as a link is neither. Null for none, for two, or past `dirsMax` directories read; a directory that cannot be read
  // throws, which is not named. It stops once nobody waits for its job.
  async function agentFileIn(top: string, name: string, job: Job): Promise<string | null> {
    const unread: [dir: string, depth: number][] = [[top, 0]];
    let found: string | null = null;
    for (let read = 1; unread.length > 0; read += 1) {
      if (read > dirsMax) return null;
      stay(job);
      const [dir, depth] = unread.pop()!;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (depth < AGENT_DEPTH_MAX) unread.push([join(dir, entry.name), depth + 1]);
        } else if (entry.isFile() && entry.name === name) {
          if (found !== null) return null;
          found = join(dir, entry.name);
        }
      }
    }
    stay(job); // after the last read, too: what follows is the next stage
    return found;
  }
  // A job nobody waits for any more stops here, as its reads stop (`Left`)
  function stay(job: Job): void {
    if (job.waiters.size === 0) throw new Left();
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

  // The job a request joins once its session's transcript is known: the job of the same session, transcript, agent and
  // path, running or waiting, or a new waiting one; null when the queue is full. A subagent's job is keyed apart, by a
  // JSON array, which holds no raw NUL as every key of the session's own does, so the two never meet (decision 8).
  function jobFor(appSessionId: AppSessionId, located: string, path: string, agentId: string | null): Job | null {
    const key = agentId === null ? `${appSessionId}\u0000${located}\u0000${path}` : JSON.stringify(['agent', appSessionId, located, agentId, path]);
    const job = running !== null && running.key === key && running.waiters.size > 0 ? running : waiting.get(key);
    if (job !== undefined) return job;
    if (waiting.size >= waitingMax) return null; // the queue is full: the refusal at once
    const entry = agentId === null ? `${appSessionId}\u0000${path}` : JSON.stringify(['agent', appSessionId, agentId, path]);
    const created: Job = { key, entry, appSessionId, transcript: located, agentId, path, waiters: new Set() };
    waiting.set(key, created);
    return created;
  }

  // A request's patience and its client's signal run from the moment it is made, the locator's wait included (fix
  // round 1, item 3): it finds its session's transcript itself, before it looks for a job (decision 13; the branch
  // review's finding 5: `/clear` keeps the app session id and binds it to a new transcript, and a request never joins
  // a job that reads another transcript than the one its session is bound to when it is made), and then waits in the
  // queue only for what is left of its patience. A request that ended while the locator was asked queues nothing. No
  // transcript, a locator that throws, a full queue, a waiter that leaves: not named. U6b-4c: `located` is called once,
  // when the locator's call has settled, or at once when none is made, whatever the request has answered by then.
  function ask(appSessionId: AppSessionId, path: string, signal: AbortSignal | undefined, agent: AgentOf | null, located: () => void): Promise<Naming> {
    let settled = false;
    const locatorSettled = () => {
      if (settled) return;
      settled = true;
      located();
    };
    // `files.read` asks for a missing file's path too, which no `realpath` has bounded: past the bound, not named at
    // once, and no transcript looked for (the work meter's fix pass, item 2; the needles' pattern runs on the path)
    if (signal?.aborted || Buffer.byteLength(path) > NAMED_PATH_MAX) {
      locatorSettled();
      return Promise.resolve(false);
    }
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
      let locating: Promise<string | null>;
      try {
        locating = transcript(appSessionId);
      } catch (error) {
        locating = Promise.reject(error);
      }
      locating.then(
        (found) => {
          locatorSettled();
          if (answered) return; // it ended while the locator was asked
          // U6b-4c: a subagent's folder is named as the session's transcript without `.jsonl`, which it must end in; and
          // (the branch panel) that transcript must be the conversation that drew the link, else the follow is of one left
          // behind (`/clear`, Q11)
          const job = found === null || (agent !== null && !(isTranscriptName(found) && conversationOf(found) === agent.engineSessionId)) ? null : jobFor(appSessionId, found, path, agent?.id ?? null);
          if (job === null) return waiter.answer(false);
          joined = job;
          job.waiters.add(waiter);
          pump();
        },
        () => {
          locatorSettled();
          waiter.answer(false);
        },
      );
    });
  }

  const unlocated = () => {};
  return {
    names: (appSessionId, path, signal, located = unlocated) => ask(appSessionId, path, signal, null, located),
    // U6b-4c (Interfaces §E): where an open cannot be confirmed to have followed no link, no subagent's file is a source:
    // not named, nothing opened, and no locator asked
    namesInAgent: (appSessionId, agent, path, signal, located = unlocated) => {
      if (!OPENS_CONFIRMED) {
        located();
        return Promise.resolve(false);
      }
      return ask(appSessionId, path, signal, agent, located);
    },
  };
}
