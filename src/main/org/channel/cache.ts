// A project's held log and its cache (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's *The
// cache*): the events the Project socket brought, by offset, each with its verdict (verify.ts), bounded to the newest
// CHANNEL_CACHE_EVENTS or CHANNEL_CACHE_BYTES (UTF-8) by offset, whichever binds first; the offset to resume after; "as of", the
// time of the last `caught-up`; and each DX1 writer's checkpoint, which is never evicted.
//
// - Verdicts are kept with the events so a channel opened signed out draws them as they were judged. Signed in, the
//   file is judged again at load: each checkpoint's record by its signer and binding (`recheckCheckpoint`), then every
//   event against the held head. The channel judges every event again at each adopted head (`rejudge`).
// - Migrated history outlives the bound: a checkpoint, made once a writer's attestation verifies over its events from
//   seq 1, keeps the hash of each event that passed, so an event of that writer reads `migrated` only when its own bytes
//   are those, at any offset, after any eviction or reload.
// - Withheld tombstones are not kept. An event that fails is kept, counted (`unverified`) and judged again.
// - The project's sessions outlive the bound too: each session's latest lifecycle event of each kind (address.ts) that
//   didn't fail is kept beside the events, in the file, judged again with them and dropped when it fails; a later one
//   that fails displaces nothing, and one held that verifies at a later head enters (the latest offset wins). At most
//   CHANNEL_CACHE_SESSIONS sessions, the most recently named.
// - A file that doesn't read as one of this project's (absent, damaged, another project's, another org's when the org
//   is known) gives an empty log, read from offset 0, which recomputes every checkpoint from the full prefix.
//
// The file is `<userData>/org/channel/<project>.json` (`channelStore`), written by the channel through the org
// session's commit queue.
//
// Electron-free.
import { join } from 'node:path';
import { isHistoryAttestation, isLogSeq, isSigned, streamOf, writerMachine, type HistoryAttestation, type Signed, type StoredEvent } from '../../../../apps/org-protocol/src/index.ts';
import type { ChannelEvent, ChannelSession, OrgMember } from '@shared/ipc/schema/org';
import { lifecycleOf, projectSessions } from './address';
import { privateFiles, type OrgFiles } from '../files';
import type { LoggedEvent } from './project-socket';
import { attestationSigned, checkpointOf, isDx1, judgeEvent, recheckCheckpoint, type Checkpoint, type Judging, type Verdict } from './verify';

/** What a judgment reads besides the log's own checkpoints. */
export type Ground = Omit<Judging, 'checkpoints'>;
/** `sessions`: the most sessions the lifecycle keeps (CHANNEL_CACHE_SESSIONS by default). */
export type ChannelLimits = { events: number; bytes: number; sessions?: number };
export const CHANNEL_CACHE_SESSIONS = 500;
export type CachedEvent = { offset: number; event: StoredEvent; verdict: Verdict };
export type ChannelCacheFile = {
  version: 1;
  org: string;
  project: string;
  after: number;
  asOf: string | null;
  events: CachedEvent[];
  checkpoints: Checkpoint[];
  /** Each session's latest lifecycle event of each kind that didn't fail, past the bound. */
  lifecycle: CachedEvent[];
};

export interface HeldLog {
  /** The org whose events these are. */
  readonly org: string;
  /** The offset the socket resumes after. */
  after(): number;
  /** The last `caught-up`'s time; null until one. */
  asOf(): string | null;
  /** Judges and keeps each event it doesn't hold; true when anything it draws changed. */
  add(events: readonly LoggedEvent[], ground: Ground): Promise<boolean>;
  caughtUp(offset: number, at: string): void;
  /**
   * The project's history attestations: a checkpoint for each writer whose record verifies over its held events, DX1
   * verdicts judged again; true when a checkpoint changed. Kept, and tried again as more of a writer's events arrive.
   */
  attest(records: readonly Signed<HistoryAttestation>[], ground: Ground): Promise<boolean>;
  /** Every checkpoint's signer and every event, against a new head. */
  rejudge(ground: Ground): Promise<void>;
  /** A DX1 writer's events have passed every attestation held since they were last read: read them again. */
  attestationsDue(): boolean;
  /** The events that draw, oldest first. */
  events(): ChannelEvent[];
  /** The project's sessions, as their lifecycle held past the bound names them. */
  sessions(): ChannelSession[];
  unverified(): number;
  file(): ChannelCacheFile;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isOffset = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isMember = (value: unknown): value is OrgMember => isObject(value) && typeof value.id === 'string' && (value.email === null || typeof value.email === 'string') && typeof value.name === 'string';

function isVerdict(value: unknown): value is Verdict {
  if (!isObject(value)) return false;
  if (typeof value.failed === 'string') return true;
  if (value.label === 'legacy') return true;
  if (value.label === 'migrated') return typeof value.by === 'string';
  return value.label === 'verified' && (value.author === undefined || isMember(value.author)) && (value.owners === undefined || (Array.isArray(value.owners) && value.owners.every(isMember)));
}

function isCheckpoint(value: unknown): value is Checkpoint {
  if (!isObject(value) || typeof value.writer !== 'string' || !isLogSeq(value.upTo) || !isObject(value.by) || !isObject(value.hashes)) return false;
  return typeof value.by.ref === 'string' && typeof value.by.name === 'string' && isSigned(value.record, isHistoryAttestation) && Object.values(value.hashes).every((h) => typeof h === 'string');
}

const isCached = (value: unknown): value is CachedEvent =>
  isObject(value) && isOffset(value.offset) && isObject(value.event) && typeof value.event.writer === 'string' && isLogSeq(value.event.seq) && isVerdict(value.verdict);

function isCacheFile(value: unknown, project: string): value is ChannelCacheFile {
  if (!isObject(value) || value.version !== 1 || typeof value.org !== 'string' || value.project !== project || !isOffset(value.after)) return false;
  if (value.asOf !== null && typeof value.asOf !== 'string') return false;
  if (!Array.isArray(value.lifecycle) || !value.lifecycle.every(isCached)) return false;
  return Array.isArray(value.events) && value.events.every(isCached) && Array.isArray(value.checkpoints) && value.checkpoints.every(isCheckpoint);
}

/** The bytes an entry takes in the file (UTF-8), near enough to bound it. */
const sizeOf = (entry: CachedEvent): number => Buffer.byteLength(JSON.stringify(entry), 'utf8');

/** The session a machine's writer is: `<machine>/<session>`, or its audience stream (`streamOf`); null for `hub/`, `legacy/`. */
function sessionOf(writer: string): string | null {
  if (writerMachine(writer) === null) return null;
  const { base } = streamOf(writer);
  return base.slice(base.indexOf('/') + 1);
}

function drawn(entry: CachedEvent): ChannelEvent | null {
  const { verdict } = entry;
  if ('failed' in verdict) return null;
  const event: Record<string, unknown> = { ...entry.event };
  delete event.mac;
  delete event.sig;
  const out: ChannelEvent = { offset: entry.offset, writer: entry.event.writer, seq: entry.event.seq, event, label: verdict.label };
  const session = sessionOf(entry.event.writer);
  if (session !== null) out.session = session;
  if (verdict.label === 'migrated') out.by = verdict.by;
  if (verdict.label === 'verified' && verdict.author !== undefined) out.author = verdict.author;
  if (verdict.label === 'verified' && verdict.owners !== undefined) out.owners = verdict.owners;
  return out;
}

function makeLog(org: string, project: string, limits: ChannelLimits, held: ChannelCacheFile | null): HeldLog {
  const entries = new Map<number, CachedEvent>((held?.events ?? []).map((e) => [e.offset, e]));
  const sizes = new Map<number, number>([...entries.values()].map((e) => [e.offset, sizeOf(e)]));
  let bytes = [...sizes.values()].reduce((sum, n) => sum + n, 0);
  const checkpoints = new Map<string, Checkpoint>((held?.checkpoints ?? []).map((c) => [c.writer, c]));
  let after = held?.after ?? 0;
  let asOf = held?.asOf ?? null;
  /** The last attestations read whose signer verified, newest per writer by `upTo`, tried again as a writer's events arrive. */
  let records = new Map<string, Signed<HistoryAttestation>>();
  /** Each DX1 writer's highest seq when the attestations were last read. */
  const asked = new Map<string, number>();
  /** The log caught up since the attestations were read: a writer they cover that hasn't verified by then never will. */
  let settled = true;

  /** By `<session>\n<kind>`: the latest of each that didn't fail. */
  const lifecycle = new Map<string, CachedEvent>();
  const keyOf = (event: StoredEvent): string | null => {
    const named = lifecycleOf(event);
    return named === null ? null : `${named.session}\n${named.kind}`;
  };
  /** At most `limits.sessions` sessions: those named longest ago go first. */
  const boundSessions = () => {
    const latest = new Map<string, number>();
    for (const [key, entry] of lifecycle) {
      const session = key.slice(0, key.indexOf('\n'));
      latest.set(session, Math.max(latest.get(session) ?? -1, entry.offset));
    }
    const cap = limits.sessions ?? CHANNEL_CACHE_SESSIONS;
    if (latest.size <= cap) return;
    const dropped = new Set([...latest].sort((a, b) => a[1] - b[1]).slice(0, latest.size - cap).map(([session]) => session));
    for (const key of [...lifecycle.keys()]) if (dropped.has(key.slice(0, key.indexOf('\n')))) lifecycle.delete(key);
  };
  /** An event judged: the lifecycle it is, if it is the latest of its kind and didn't fail. */
  const note = (entry: CachedEvent) => {
    const key = keyOf(entry.event);
    if (key === null || 'failed' in entry.verdict) return;
    const held = lifecycle.get(key);
    if (held !== undefined && held.offset > entry.offset) return;
    lifecycle.set(key, entry);
    if (held === undefined) boundSessions();
  };
  for (const entry of held?.lifecycle ?? []) note(entry);

  const judging = (ground: Ground): Judging => ({ ...ground, checkpoints });
  /** The lifecycle (of `writers`, or all) judged again: an event held at the same offset gives its verdict; one that fails is dropped. */
  async function rejudgeLifecycle(ground: Ground, writers?: ReadonlySet<string>): Promise<void> {
    for (const [key, entry] of [...lifecycle]) {
      if (writers !== undefined && !writers.has(entry.event.writer)) continue;
      const verdict = entries.get(entry.offset)?.verdict ?? (await judgeEvent(entry.event, judging(ground)));
      if (verdict === null || 'failed' in verdict) lifecycle.delete(key);
      else lifecycle.set(key, { ...entry, verdict });
    }
  }
  const keep = (entry: CachedEvent) => {
    const size = sizeOf(entry);
    bytes += size - (sizes.get(entry.offset) ?? 0);
    sizes.set(entry.offset, size);
    entries.set(entry.offset, entry);
  };
  /**
   * A DX1 event an authenticated attestation covers past its writer's checkpoint, before the log has caught up: it stays
   * past the bound, since `verifyHistoryAttestation` needs every one from seq 1, which an evicted prefix no longer gives.
   * Only up to the record's `upTo`: the writer's later events are bounded as any others.
   */
  const awaited = (event: StoredEvent) => {
    const record = records.get(event.writer);
    return !settled && record !== undefined && event.seq <= record.body.upTo && (checkpoints.get(event.writer)?.upTo ?? 0) < record.body.upTo;
  };
  /**
   * Evicts the oldest entries while either bound is passed, but an awaited DX1 event: one per writer and seq, the first
   * held (the lowest offset), so replayed or conflicting copies are bounded as any others. The newest always stays.
   */
  const bound = () => {
    if (entries.size <= limits.events && bytes <= limits.bytes) return;
    const offsets = [...entries.keys()].sort((a, b) => a - b);
    const spared = new Set<string>();
    for (const offset of offsets) {
      if (entries.size <= 1 || (entries.size <= limits.events && bytes <= limits.bytes)) break;
      const { event } = entries.get(offset)!;
      const position = `${event.writer}\n${event.seq}`;
      if (isDx1(event) && awaited(event) && !spared.has(position)) {
        spared.add(position);
        continue;
      }
      entries.delete(offset);
      bytes -= sizes.get(offset) ?? 0;
      sizes.delete(offset);
    }
  };
  const writerEvents = (writer: string) => [...entries.values()].filter((e) => e.event.writer === writer).map((e) => e.event);
  const highestDx1 = () => {
    const highest = new Map<string, number>();
    for (const { event } of entries.values()) if (isDx1(event)) highest.set(event.writer, Math.max(highest.get(event.writer) ?? 0, event.seq));
    return highest;
  };

  /** Each held record whose writer has no checkpoint up to it, verified over the writer's events when they cover it. */
  async function checkpoint(ground: Ground, writers: Iterable<string>): Promise<Set<string>> {
    const made = new Set<string>();
    for (const writer of writers) {
      const record = records.get(writer);
      const kept = checkpoints.get(writer);
      if (record === undefined || (kept !== undefined && kept.upTo >= record.body.upTo)) continue;
      const events = writerEvents(writer);
      if (new Set(events.map((e) => e.seq).filter((seq) => seq <= record.body.upTo)).size < record.body.upTo) continue;
      const next = await checkpointOf(record, events, judging(ground));
      if (next === null) continue;
      checkpoints.set(writer, next);
      made.add(writer);
    }
    return made;
  }

  async function rejudgeWriters(ground: Ground, writers: ReadonlySet<string>): Promise<void> {
    for (const entry of [...entries.values()]) {
      if (!writers.has(entry.event.writer)) continue;
      const verdict = await judgeEvent(entry.event, judging(ground));
      if (verdict === null) continue;
      keep({ ...entry, verdict });
      note({ ...entry, verdict });
    }
    await rejudgeLifecycle(ground, writers);
  }

  return {
    org,
    after: () => after,
    asOf: () => asOf,
    async add(events, ground) {
      let changed = false;
      const dx1 = new Set<string>();
      for (const { offset, event } of events) {
        after = Math.max(after, offset);
        if (entries.has(offset)) continue;
        const verdict = await judgeEvent(event, judging(ground));
        if (verdict === null) continue;
        keep({ offset, event, verdict });
        note({ offset, event, verdict });
        if (isDx1(event)) dx1.add(event.writer);
        changed = true;
      }
      const made = await checkpoint(ground, dx1);
      if (made.size > 0) await rejudgeWriters(ground, made);
      bound();
      return changed;
    },
    caughtUp(offset, at) {
      after = Math.max(after, offset);
      asOf = at;
      settled = true;
      bound();
    },
    async attest(list, ground) {
      const next = new Map<string, Signed<HistoryAttestation>>();
      for (const record of list) {
        if (!isSigned(record, isHistoryAttestation) || record.body.project !== project) continue;
        if (!(await attestationSigned(record, judging(ground)))) continue; // the hub's word alone spares nothing
        const prior = next.get(record.body.writer);
        if (prior === undefined || record.body.upTo > prior.body.upTo) next.set(record.body.writer, record);
      }
      records = next;
      settled = false;
      for (const [writer, seq] of highestDx1()) asked.set(writer, seq);
      const made = await checkpoint(ground, records.keys());
      if (made.size > 0) await rejudgeWriters(ground, made);
      return made.size > 0;
    },
    async rejudge(ground) {
      for (const [writer, kept] of [...checkpoints]) if (!(await recheckCheckpoint(kept, judging(ground)))) checkpoints.delete(writer);
      for (const entry of [...entries.values()]) {
        const verdict = await judgeEvent(entry.event, judging(ground));
        if (verdict === null) {
          entries.delete(entry.offset);
          bytes -= sizes.get(entry.offset) ?? 0;
          sizes.delete(entry.offset);
        } else {
          keep({ ...entry, verdict });
          note({ ...entry, verdict }); // a lifecycle event verifying now enters the sessions, latest offset winning
        }
      }
      await rejudgeLifecycle(ground);
    },
    attestationsDue() {
      for (const [writer, seq] of highestDx1()) {
        const covered = Math.max(checkpoints.get(writer)?.upTo ?? 0, records.get(writer)?.body.upTo ?? 0);
        if (seq > covered && seq > (asked.get(writer) ?? 0)) return true;
      }
      return false;
    },
    events: () =>
      [...entries.values()]
        .sort((a, b) => a.offset - b.offset)
        .map(drawn)
        .filter((e): e is ChannelEvent => e !== null),
    sessions: () => projectSessions(lifecycle.values()),
    unverified: () => [...entries.values()].filter((e) => 'failed' in e.verdict).length,
    file: () => ({
      version: 1,
      org,
      project,
      after,
      asOf,
      events: [...entries.values()].sort((a, b) => a.offset - b.offset),
      checkpoints: [...checkpoints.values()],
      lifecycle: [...lifecycle.values()].sort((a, b) => a.offset - b.offset),
    }),
  };
}

/** A log of nothing yet, read from offset 0. */
export function emptyLog(org: string, project: string, limits: ChannelLimits): HeldLog {
  return makeLog(org, project, limits, null);
}

/**
 * The cache as read: `org` is the signed-in org (null signed out: the file's own stands), `ground` the held head to
 * judge it against again (null signed out: the stored verdicts stand). Anything that isn't this project's log reads as
 * an empty log of `org`.
 */
export async function loadLog(raw: unknown, input: { org: string | null; project: string; limits: ChannelLimits; ground: Ground | null; log(line: string): void }): Promise<HeldLog> {
  const { org, project, limits, ground } = input;
  if (raw !== null && !isCacheFile(raw, project)) input.log(`the cache of ${project} is damaged: read from offset 0`);
  if (!isCacheFile(raw, project) || (org !== null && raw.org !== org)) return emptyLog(org ?? '', project, limits);
  const log = makeLog(raw.org, project, limits, raw);
  if (ground !== null) await log.rejudge(ground);
  return log;
}

export interface ChannelStore {
  read(project: string): Promise<unknown | null>;
  write(project: string, file: ChannelCacheFile): Promise<void>;
}

/** `<org>/channel/`: made (0700) beside the org's own files only once `org/` itself passes its checks. */
export function channelStore(files: OrgFiles, log: (line: string) => void): ChannelStore {
  const dir = privateFiles({ dir: join(files.dir, 'channel'), log });
  return {
    read: async (project) => ((await dir.check()) === null ? null : dir.read(`${project}.json`)),
    async write(project, file) {
      const org = await files.check();
      if (org === null || !org.ok) throw new Error(org === null ? `${files.dir} does not exist` : org.detail);
      const made = await dir.ensure();
      if (!made.ok) throw new Error(made.detail);
      await dir.write(`${project}.json`, file);
    },
  };
}
