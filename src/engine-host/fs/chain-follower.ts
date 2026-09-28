// The chain follower (C4 execution document, "Chain follower and backfill"): one per transcript file, it keeps the
// transcript the model sees (root → leaf through `parentUuid`) as lines are appended, and turns the records that join
// the chain into X1 events through the backfill mapping. The tailer keeps a read cursor at the end of what it has read
// plus the trailing partial line; every poke reads `[offset, size)` once, so the ranges read over a file's life are
// contiguous, ascending and disjoint. Rewinds arrive as `last-prompt {rewound: true}` anchors that cut the chain at
// once; the engine then continues from an attachment the cut removed, which the announced `rewind` state recognises.
// A branch nothing explains is a second writer: retraction plus a warning. Every method is serialised behind one
// promise chain, so a watcher event, a reconcile tick and a follow request never interleave.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, EventId, MessageUuid, ParentToolUseId, SessionId } from '@shared/graph/ids';
import type { TranscriptSummary } from '@shared/wire/store';
import { TranscriptRecordSchema, type TranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, eventBase, recordToEvents, type BackfillContext, type SubagentLookup } from './backfill';

export interface Skeleton {
  uuid: MessageUuid;
  parentUuid: MessageUuid | null;
  type: string;
  isProgress: boolean;
  timestamp: string | null;
  offset: number; // byte position of the line (leading NULs included); re-reading [offset, offset + length) yields the record
  length: number;
}

export type RewindState =
  | null // no anchor outstanding
  | { phase: 'unanchored'; leafUuid: MessageUuid; prefillText: string | null; anchorOffset: number } // anchor seen, its leafUuid not on the chain; waits for the branch
  | { phase: 'announced'; leafUuid: MessageUuid; targetMessageUuid: MessageUuid | null; prefillText: string | null; anchorOffset: number }; // chain cut and boundary.rewind emitted; awaiting the continuation

export interface FollowerState {
  path: string;
  ino: number | null;
  offset: number; // read cursor: the byte position up to which the file has been read
  partial: Buffer; // the bytes of [offset - partial.length, offset): everything after the last '\n' read so far
  skeletons: Map<MessageUuid, Skeleton>; // every uuid-bearing record, chain or not; payloads are not retained
  chain: MessageUuid[]; // root → leaf
  leaf: MessageUuid | null;
  emitted: Set<MessageUuid>; // chain records whose events have been delivered (a cut removes them)
  rewind: RewindState;
  skippedLines: number;
  gap: { parentUuid: string; childUuid: string } | null;
}

export type FollowState = 'backfilling' | 'following' | 'reloading' | 'stopped' | 'error';
export type FollowerFacts = Partial<Pick<TranscriptSummary, 'customTitle' | 'aiTitle' | 'relocatedCwd' | 'gitBranch' | 'engineVersion' | 'leafUuid' | 'lastRecordAt'>>;

export type FollowerEvent =
  | { t: 'events'; events: SessionEvent[] } // in chain order, batched
  | { t: 'facts'; facts: FollowerFacts }
  | { t: 'state'; state: FollowState; chainLength: number; leafUuid: MessageUuid | null; gap: FollowerState['gap']; skippedLines: number; message: string | null };

export interface FileReader {
  readonly path?: string;
  stat(): Promise<{ ino: number; size: number } | null>; // null: the file does not exist (yet)
  read(offset: number, length: number): Promise<Buffer>;
}

export interface ChainFollowerOptions {
  subagents?: SubagentLookup; // the sidecar metas the backfill consults for `Agent` tool uses
}

const PAGE_BYTES = 1024 * 1024;
const MAX_PARTIAL_BYTES = 8 * 1024 * 1024;
const BATCH_SIZE = 500;
const RELOAD_ATTEMPTS = 3;
const NEWLINE = 0x0a;

// Non-uuid record types the engine writes that carry nothing for the graph (SPEC 35.5).
const KNOWN_SILENT_TYPES = new Set([
  'last-prompt', 'custom-title', 'ai-title', 'relocated', 'queue-operation', 'mode', 'permission-mode', 'atis-latch',
  'file-history-snapshot', 'file-history-delta', 'cost-state', 'summary', 'tag', 'history-suppression', 'ended-by-model',
  'continued-in', 'attribution-snapshot', 'fork-context-ref', 'observer-ref',
  'agent-name', 'bridge-session', // a teammate's display name (SPEC 35 AgentNameRecord); remote-control bridge bookkeeping
]);

interface Produced {
  source: MessageUuid | null; // the record the event derives from; null for anchor-, branch- and line-derived events
  group: number; // one `emit` call: the events of one record mapped once; a re-delivery is a new group
  event: SessionEvent;
}

// The per-file state and its line dispatch. A reload builds a fresh core over the rewritten file and the follower
// reconciles the two, which is why the state lives apart from the follower's delivery bookkeeping.
class FollowerCore {
  ino: number | null = null;
  offset = 0;
  partial: Buffer = Buffer.alloc(0);
  readonly skeletons = new Map<MessageUuid, Skeleton>();
  chain: MessageUuid[] = [];
  onChain = new Set<MessageUuid>();
  leaf: MessageUuid | null = null;
  readonly emitted = new Set<MessageUuid>();
  rewind: RewindState = null;
  skippedLines = 0;
  gap: FollowerState['gap'] = null;
  out: Produced[] = [];
  facts: FollowerFacts = {};
  private groups = 0;
  interrupted = false; // a by-offset re-read met another file: this core's picture of the file is incomplete

  constructor(
    private readonly reader: FileReader,
    readonly ctx: BackfillContext,
  ) {}

  // One chunk read at the cursor: dispatch every complete line, keep the remainder, advance the cursor.
  async consume(chunk: Buffer): Promise<void> {
    const buf = this.partial.length === 0 ? chunk : Buffer.concat([this.partial, chunk]);
    const base = this.offset - this.partial.length;
    let lineStart = 0;
    for (;;) {
      const newline = buf.indexOf(NEWLINE, lineStart);
      if (newline === -1) break;
      await this.dispatchLine(buf.subarray(lineStart, newline), base + lineStart);
      lineStart = newline + 1;
    }
    this.partial = Buffer.from(buf.subarray(lineStart));
    this.offset += chunk.length;
    if (this.partial.length > MAX_PARTIAL_BYTES) {
      // A single record this size is a torn tail in practice: drop it, the cursor stays, the bytes up to the next
      // newline then parse as garbage once more.
      this.partial = Buffer.alloc(0);
      this.skippedLines += 1;
    }
  }

  private async dispatchLine(lineBytes: Buffer, offset: number): Promise<void> {
    const record = parseLine(lineBytes);
    if (record === null) {
      if (lineBytes.length > 0) this.skippedLines += 1;
      return;
    }
    if (typeof record.uuid !== 'string') {
      this.handleAnonymous(record, offset);
      return;
    }
    const uuid = record.uuid as MessageUuid;
    if (this.skeletons.has(uuid)) return; // the engine's dedup-transcript rule: a uuid is written once
    const skeleton: Skeleton = {
      uuid,
      parentUuid: typeof record.parentUuid === 'string' ? (record.parentUuid as MessageUuid) : null,
      type: record.type,
      isProgress: record.type === 'progress',
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : null,
      offset,
      length: lineBytes.length,
    };
    this.skeletons.set(uuid, skeleton);
    if (typeof record.gitBranch === 'string') this.facts.gitBranch = record.gitBranch;
    if (typeof record.version === 'string') this.facts.engineVersion = record.version;
    if (skeleton.timestamp !== null) this.facts.lastRecordAt = skeleton.timestamp;
    if (skeleton.isProgress) return; // never the leaf, no event; a child naming it as parent walks through it
    await this.handleRecord(record, skeleton);
  }

  private handleAnonymous(record: TranscriptRecord, offset: number): void {
    switch (record.type) {
      case 'last-prompt':
        this.handleAnchor(record, offset);
        return;
      case 'custom-title':
        if (typeof record.customTitle === 'string') this.facts.customTitle = record.customTitle === '' ? null : record.customTitle;
        return;
      case 'ai-title':
        if (typeof record.aiTitle === 'string') this.facts.aiTitle = record.aiTitle;
        return;
      case 'relocated':
        if (typeof record.relocatedCwd === 'string') this.facts.relocatedCwd = record.relocatedCwd;
        return;
      default:
        if (KNOWN_SILENT_TYPES.has(record.type)) return;
        this.produce(null, { ...eventBase(this.ctx, `line:${offset}`), kind: 'frame.unknown', frameType: `transcript:${record.type}`, subtype: null });
    }
  }

  private handleAnchor(record: TranscriptRecord, offset: number): void {
    const leafUuid = typeof record.leafUuid === 'string' ? (record.leafUuid as MessageUuid) : null;
    if (leafUuid === null) return;
    this.facts.leafUuid = leafUuid;
    if (record.rewound !== true) return;
    const prefillText = typeof record.lastPrompt === 'string' ? record.lastPrompt : null;
    if (!this.onChain.has(leafUuid)) {
      this.rewind = { phase: 'unanchored', leafUuid, prefillText, anchorOffset: offset };
      return;
    }
    if (leafUuid === this.leaf) {
      this.rewind = null;
      return;
    }
    // Cut: the chain members after leafUuid leave the chain now, before the continuation arrives.
    const segment = this.chain.splice(this.chain.indexOf(leafUuid) + 1);
    for (const uuid of segment) {
      this.onChain.delete(uuid);
      this.emitted.delete(uuid);
    }
    this.leaf = leafUuid;
    const targetMessageUuid = segment.find((uuid) => this.skeletons.get(uuid)?.type === 'user') ?? null;
    if (targetMessageUuid !== null) {
      // A cut segment with no user record is attachments only, invisible to consumers: no boundary.
      this.produce(null, { ...eventBase(this.ctx, `anchor:${offset}`), kind: 'boundary.rewind', targetMessageUuid, precedingAssistantUuid: leafUuid, prefillText });
    }
    this.rewind = { phase: 'announced', leafUuid, targetMessageUuid, prefillText, anchorOffset: offset };
  }

  private async handleRecord(record: TranscriptRecord, skeleton: Skeleton): Promise<void> {
    const parent = this.throughProgress(skeleton.parentUuid);
    if (parent === this.leaf) {
      this.extend(record, skeleton.uuid);
      return;
    }
    if (this.rewind?.phase === 'announced') {
      const walked = this.walkToAnnouncedLeaf(parent, this.rewind.leafUuid);
      if (walked !== null) {
        await this.rejoin(walked, record, skeleton.uuid);
        return;
      }
    }
    if (parent === null && this.chain.length > 0 && record.type === 'system' && record.subtype === 'compact_boundary') {
      // The compaction boundary is written with `parentUuid: null` (SPEC 35.5.13): the chain restarts at it, the
      // history before it stays delivered, and the boundary.compaction event carries `logicalParentUuid`.
      this.restart(record, skeleton.uuid);
      return;
    }
    await this.branch(record, skeleton.uuid, parent);
  }

  private extend(record: TranscriptRecord, uuid: MessageUuid): void {
    this.chain.push(uuid);
    this.onChain.add(uuid);
    this.leaf = uuid;
    this.emit(record, uuid);
    this.rewind = null;
  }

  // Rewind continuation: the walked records rejoin (mapped again, though attachments carry nothing), then this record.
  private async rejoin(walked: MessageUuid[], record: TranscriptRecord, uuid: MessageUuid): Promise<void> {
    for (const member of walked) {
      this.chain.push(member);
      this.onChain.add(member);
      if (!this.emitted.has(member)) await this.reemit(member);
    }
    this.extend(record, uuid);
  }

  private restart(record: TranscriptRecord, uuid: MessageUuid): void {
    for (const member of this.chain) this.emitted.delete(member);
    this.chain = [];
    this.onChain = new Set();
    this.gap = null;
    this.extend(record, uuid);
  }

  // Branch: walk this record's ancestry through the skeletons; the walk is the new chain (C1's gap rule: stop at a
  // missing parent, report, never bridge). The old chain's members not on it are retracted.
  private async branch(record: TranscriptRecord, uuid: MessageUuid, parent: MessageUuid | null): Promise<void> {
    const newChain: MessageUuid[] = [uuid];
    const visited = new Set<MessageUuid>([uuid]);
    let gap: FollowerState['gap'] = null;
    let child: MessageUuid = uuid;
    let current = parent;
    while (current !== null) {
      const ancestor = this.skeletons.get(current);
      if (ancestor === undefined || visited.has(current)) {
        gap = { parentUuid: current, childUuid: child };
        break;
      }
      visited.add(current);
      if (!ancestor.isProgress) newChain.push(current);
      child = current;
      current = ancestor.parentUuid;
    }
    newChain.reverse();
    const newSet = new Set(newChain);
    const removed = this.chain.filter((member) => !newSet.has(member));
    for (const member of removed) this.emitted.delete(member);
    if (this.chain.length > 0) {
      if (this.rewind?.phase === 'unanchored') {
        const targetMessageUuid = removed.find((member) => this.skeletons.get(member)?.type === 'user') ?? null;
        if (targetMessageUuid !== null) {
          this.produce(null, { ...eventBase(this.ctx, `anchor:${this.rewind.anchorOffset}`), kind: 'boundary.rewind', targetMessageUuid, precedingAssistantUuid: this.rewind.leafUuid, prefillText: this.rewind.prefillText });
        }
      } else {
        // No anchor explains this, or the announced rewind rejected the parent: a second writer (pass-2 item 10).
        this.produce(null, { ...eventBase(this.ctx, `branch:${uuid}:retraction`), kind: 'boundary.retraction', retractedMessageUuids: removed, reason: 'transcript_branch', fallbackModel: null });
        this.produce(null, { ...eventBase(this.ctx, `branch:${uuid}:notice`), kind: 'notice.posted', level: 'warning', text: 'Another process wrote a sibling branch into this transcript', key: 'transcript_branch' });
      }
    }
    this.chain = newChain;
    this.onChain = newSet;
    this.leaf = uuid;
    this.gap = gap;
    this.rewind = null;
    for (const member of newChain) {
      if (member === uuid) this.emit(record, uuid);
      else if (!this.emitted.has(member)) await this.reemit(member);
    }
  }

  private emit(record: TranscriptRecord, uuid: MessageUuid): void {
    this.produce(uuid, ...recordToEvents(record, this.ctx));
    this.emitted.add(uuid);
  }

  private produce(source: MessageUuid | null, ...events: SessionEvent[]): void {
    const group = ++this.groups;
    for (const event of events) this.out.push({ source, group, event });
  }

  // A record that came onto the chain after its line was read: re-read it by offset (attachments carry no events, so
  // their bytes are not fetched).
  private async reemit(uuid: MessageUuid): Promise<void> {
    const skeleton = this.skeletons.get(uuid);
    if (skeleton === undefined) return;
    if (skeleton.type === 'attachment') {
      this.emitted.add(uuid);
      return;
    }
    const record = parseLine(await this.reader.read(skeleton.offset, skeleton.length));
    if (record !== null && record.uuid === uuid) this.emit(record, uuid);
    else {
      // The file changed under the read; the next poke's stat sees the rewrite (a reload in progress retries at once).
      this.emitted.add(uuid);
      this.interrupted = true;
    }
  }

  // The engine re-points a record whose parent is a progress record to that record's parent (SPEC 35.12.3).
  private throughProgress(parentUuid: MessageUuid | null): MessageUuid | null {
    let current = parentUuid;
    for (let hops = 0; current !== null && hops < this.skeletons.size; hops++) {
      const skeleton = this.skeletons.get(current);
      if (skeleton === undefined || !skeleton.isProgress) break;
      current = skeleton.parentUuid;
    }
    return current;
  }

  // The rewind continuation walk: from `parent` up through the skeletons to the announced leaf without crossing a
  // `user` record; the walked records in root → leaf order, or null when this is not a continuation.
  private walkToAnnouncedLeaf(parent: MessageUuid | null, leafUuid: MessageUuid): MessageUuid[] | null {
    const walked: MessageUuid[] = [];
    const visited = new Set<MessageUuid>();
    let current = parent;
    while (current !== null && current !== leafUuid) {
      const skeleton = this.skeletons.get(current);
      if (skeleton === undefined || visited.has(current) || skeleton.type === 'user') return null;
      visited.add(current);
      if (!skeleton.isProgress) walked.push(current);
      current = skeleton.parentUuid;
    }
    return current === null ? null : walked.reverse();
  }
}

// One line's bytes to a record: leading NULs stripped, unparseable lines are null (the engine's own reader rule).
function parseLine(lineBytes: Buffer): TranscriptRecord | null {
  let start = 0;
  while (start < lineBytes.length && lineBytes[start] === 0) start++;
  if (start === lineBytes.length) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(lineBytes.subarray(start).toString('utf8'));
  } catch {
    return null;
  }
  const result = TranscriptRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export class ChainFollower {
  private core: FollowerCore;
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private phase: FollowState = 'backfilling';
  private lastReported: string | null = null;
  private lastFactsLeaf: MessageUuid | null = null;
  private readonly delivered: SessionEvent[] = [];
  // Deliveries per record uuid and per synthesised base id over the follower's life (reset only by `stop`): a record
  // delivered again after a boundary removed it carries `<uuid>@<g>`, a boundary or notice whose base id was already
  // delivered carries `<base>@<g>`, so the delivery log never holds an id twice and a consumer deduplicates by id alone.
  private readonly deliveries = new Map<string, number>();
  private startedDelivered = false; // `session.started` goes out at most once per follow

  constructor(
    private readonly reader: FileReader,
    private readonly sessionId: SessionId,
    private readonly agent: { agentId: AgentId; parentToolUseId: ParentToolUseId | null } | null,
    private readonly sink: (e: FollowerEvent) => void,
    private readonly options: ChainFollowerOptions = {},
  ) {
    this.core = this.freshCore();
  }

  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      this.report('backfilling');
      try {
        const stat = await this.reader.stat();
        if (this.stopped) return;
        if (stat !== null) {
          this.core.ino = stat.ino;
          await this.readForward(this.core, stat.size, true);
          if (this.stopped) return;
        }
        this.flush(this.core);
        this.report('following');
      } catch (error) {
        this.report('error', messageOf(error));
      }
    });
  }

  poke(): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      try {
        const stat = await this.reader.stat();
        if (this.stopped) return;
        if (stat === null) return; // a file not there yet, or gone: wait for it
        const core = this.core;
        if (core.ino !== null && (stat.ino !== core.ino || stat.size < core.offset)) {
          await this.reload(stat);
          return;
        }
        if (core.ino === null) core.ino = stat.ino;
        if (stat.size > core.offset) {
          await this.readForward(core, stat.size, false);
          if (this.stopped) return;
        }
        this.flush(core);
        this.report('following');
      } catch (error) {
        this.report('error', messageOf(error));
      }
    });
  }

  // Effective across awaits: work in flight finds `stopped` when its read resolves and delivers nothing; the skeleton
  // and the materialised list are discarded.
  stop(): void {
    this.stopped = true;
    this.core = this.freshCore();
    this.delivered.length = 0;
    this.deliveries.clear();
    this.startedDelivered = false;
    this.report('stopped');
  }

  snapshot(): FollowerState {
    const core = this.core;
    return {
      path: this.reader.path ?? '',
      ino: core.ino,
      offset: core.offset,
      partial: Buffer.from(core.partial),
      skeletons: new Map(core.skeletons),
      chain: [...core.chain],
      leaf: core.leaf,
      emitted: new Set(core.emitted),
      rewind: core.rewind === null ? null : { ...core.rewind },
      skippedLines: core.skippedLines,
      gap: core.gap === null ? null : { ...core.gap },
    };
  }

  // Every event delivered so far, in order, for the snapshot command.
  materialized(): SessionEvent[] {
    return [...this.delivered];
  }

  private freshCore(): FollowerCore {
    return new FollowerCore(this.reader, createBackfillContext({ sessionId: this.sessionId, agent: this.agent, subagents: this.options.subagents }));
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // Read [core.offset, toSize) in pages through the line dispatch; the ranges stay contiguous and no byte is read twice.
  // Answers whether the whole range was read: a read that returns no bytes (the file was replaced or shrank since the
  // stat) ends it early, and the caller's next stat sees the new file.
  private async readForward(core: FollowerCore, toSize: number, flushEachPage: boolean): Promise<boolean> {
    while (core.offset < toSize) {
      const chunk = await this.reader.read(core.offset, Math.min(PAGE_BYTES, toSize - core.offset));
      if (this.stopped || chunk.length === 0) return false;
      await core.consume(chunk);
      if (this.stopped) return false;
      if (flushEachPage) this.flush(core);
    }
    return !core.interrupted;
  }

  // The file was rewritten (GC, tombstone removal, hydration, relocation): run a cold start into a fresh core with
  // delivery suppressed, then reconcile the old delivered state against the fresh final state and nothing else.
  // Old-chain records missing from the fresh chain are one retraction; fresh-chain records the old follower had not
  // delivered are delivered in chain order. The fresh run's own anchor-, branch- and line-derived events describe
  // history the consumer already holds (a rewrite that shifts an anchor's byte offset changes its id, not its
  // meaning) and are never delivered.
  // A fresh run whose own read is interrupted (the file replaced again between the reload's stat and its read, or
  // shrunk) describes no file: it is abandoned, never reconciled — an empty fresh chain would retract everything the
  // consumer holds — and the reload starts over from a fresh stat, up to RELOAD_ATTEMPTS times; after that the old
  // state stands and the next poke tries again.
  private async reload(first: { ino: number; size: number }): Promise<void> {
    this.report('reloading');
    let stat: { ino: number; size: number } | null = first;
    let fresh: FollowerCore | null = null;
    for (let attempt = 0; attempt < RELOAD_ATTEMPTS && stat !== null; attempt++) {
      const candidate = this.freshCore();
      candidate.ino = stat.ino;
      const whole = await this.readForward(candidate, stat.size, false);
      if (this.stopped) return;
      if (whole) {
        fresh = candidate;
        break;
      }
      stat = await this.reader.stat();
      if (this.stopped) return;
    }
    if (fresh === null) {
      this.report('following'); // the old state stands; nothing was delivered
      return;
    }
    const old = this.core;
    const freshChain = new Set(fresh.chain);
    const retracted = old.chain.filter((uuid) => !freshChain.has(uuid));
    const produced: Produced[] = [];
    if (retracted.length > 0) {
      produced.push({ source: null, group: 0, event: { ...eventBase(fresh.ctx, `rewrite:${fresh.ino}:${fresh.offset}`), kind: 'boundary.retraction', retractedMessageUuids: retracted, reason: 'transcript_rewritten', fallbackModel: null } });
    }
    // One event group per record, its final mapping: the suppressed fresh run may have mapped a record more than once
    // while branching away from it and rejoining; only the last group, the one standing on the final chain, counts.
    const byRecord = new Map<MessageUuid, Produced[]>();
    for (const item of fresh.out) {
      if (item.source === null) continue;
      const list = byRecord.get(item.source);
      if (list === undefined || list[0].group !== item.group) byRecord.set(item.source, [item]);
      else list.push(item);
    }
    for (const uuid of fresh.chain) {
      if (!old.emitted.has(uuid)) produced.push(...(byRecord.get(uuid) ?? []));
    }
    fresh.out = [];
    this.core = fresh;
    this.deliver(produced);
    this.flush(fresh);
    this.report('following');
  }

  private flush(core: FollowerCore): void {
    if (this.stopped) return;
    if (core.out.length > 0) {
      this.deliver(core.out);
      core.out = [];
    }
    if (core.leaf !== this.lastFactsLeaf) {
      core.facts.leafUuid = core.leaf;
      this.lastFactsLeaf = core.leaf;
    }
    if (Object.keys(core.facts).length > 0) {
      this.sink({ t: 'facts', facts: core.facts });
      core.facts = {};
    }
  }

  // Ids name delivery occurrences: a record's first delivery keeps the backfill's ids; each later one (a rewind
  // continuation, a branch flip, a reload) carries `<uuid>@<g>` / `<uuid>@<g>#<n>` with `g` its delivery count.
  private deliver(produced: Produced[]): void {
    if (this.stopped || produced.length === 0) return;
    const events: SessionEvent[] = [];
    let currentGroup: { source: MessageUuid; group: number; g: number } | null = null;
    for (const item of produced) {
      if (item.event.kind === 'session.started') {
        if (this.startedDelivered) continue;
        this.startedDelivered = true;
        events.push(item.event);
        continue;
      }
      if (item.source === null) {
        // A synthesised boundary or notice: its base id counts as its own occurrence key.
        const g: number = (this.deliveries.get(item.event.id) ?? 0) + 1;
        this.deliveries.set(item.event.id, g);
        events.push(g === 1 ? item.event : { ...item.event, id: `${item.event.id}@${g}` as EventId });
        continue;
      }
      if (currentGroup === null || currentGroup.source !== item.source || currentGroup.group !== item.group) {
        const g: number = (this.deliveries.get(item.source) ?? 0) + 1;
        this.deliveries.set(item.source, g);
        currentGroup = { source: item.source, group: item.group, g };
      }
      events.push(currentGroup.g === 1 ? item.event : { ...item.event, id: occurrenceId(item.event.id, item.source, currentGroup.g) });
    }
    this.delivered.push(...events);
    for (let i = 0; i < events.length; i += BATCH_SIZE) this.sink({ t: 'events', events: events.slice(i, i + BATCH_SIZE) });
  }

  // State is reported on every transition and whenever the chain's shape changed since the last report; nothing
  // after `stopped`.
  private report(state: FollowState, message: string | null = null): void {
    if (this.stopped && state !== 'stopped') return;
    const core = this.core;
    const payload: FollowerEvent = { t: 'state', state, chainLength: core.chain.length, leafUuid: core.leaf, gap: core.gap, skippedLines: core.skippedLines, message };
    const key = JSON.stringify(payload);
    if (state === this.phase && key === this.lastReported) return;
    this.phase = state;
    this.lastReported = key;
    this.sink(payload);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// `<uuid>` → `<uuid>@<g>`, `<uuid>#<n>` → `<uuid>@<g>#<n>`; an id of another form (the synthetic start) gets `@<g>`.
function occurrenceId(id: EventId, uuid: MessageUuid, g: number): EventId {
  const plain: string = id;
  if (plain === (uuid as string)) return `${uuid}@${g}` as EventId;
  if (plain.startsWith(`${uuid}#`)) return `${uuid}@${g}${plain.slice(uuid.length)}` as EventId;
  return `${plain}@${g}` as EventId;
}
