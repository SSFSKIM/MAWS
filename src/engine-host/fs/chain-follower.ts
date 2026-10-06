// The chain follower (C4 execution document, "Chain follower and backfill"): one per transcript file, it keeps the
// transcript the model sees (root → leaf through `parentUuid`) as lines are appended, and turns the records that join
// the chain into X1 events through the backfill mapping. The tailer keeps a read cursor at the end of what it has read
// plus the trailing partial line; every poke reads `[offset, size)` once. Oversized partials retain only their start
// offset until a newline arrives, then re-read that one complete record for parsing. Rewinds arrive as `last-prompt {rewound: true}` anchors that cut the chain at
// once; the engine then continues from an attachment the cut removed, which the announced `rewind` state recognises.
// An unexplained cut changes conversation history, without proving who wrote it. If contested (W7: a
// foreign process holds it now) and the branch would replace records MAWS wrote with another writer's, in which case
// MAWS's branch stays in view and the other is held back until the holder exits and the follower re-folds. Every
// method is serialised behind one promise chain, so a watcher event, a reconcile tick and a follow request never
// interleave.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, EventId, MessageUuid, ParentToolUseId, SessionId } from '@shared/graph/ids';
import { branchName } from '@shared/sessions/branch';
import type { TranscriptSummary } from '@shared/wire/store';
import { TranscriptRecordSchema, type TranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, eventBase, recordToEvents, isTaskNotification, isHumanPrompt, isNoResponseMarker, localCommandKind, singleText, startsTurn, type BackfillContext, type SubagentLookup } from './backfill';
import { opensTurn } from './backfill'; // E7

export interface Skeleton {
  uuid: MessageUuid;
  parentUuid: MessageUuid | null;
  type: string;
  messageId: string | null; // assistant API response group; never the message payload
  sourceToolAssistantUuid: MessageUuid | null;
  isToolResult: boolean;
  agentId: string | null;
  isSidechain: boolean;
  isDiagnostic: boolean;
  delivery: 'tail' | 'interleave' | null;
  deliveryOwner: MessageUuid | null; // proved at adoption, never inferred across a branch
  localCommand: boolean;
  localTurnUuid: MessageUuid | null; // mapper turn owning the delivered local history
  humanPrompt: boolean; // includes blocked prompts and human queued-command attachments
  localCaveat: boolean;
  noResponse: boolean;
  isProgress: boolean;
  startsTurn: boolean; // a prompt that opens a turn (backfill's `startsTurn`): what the terminal-rewind rule reads boundaries by
  opensTurn: boolean; // E7: `startsTurn` or a peer message's record (backfill's `opensTurn`): what the unended-turn rule reads
  endsTurn: boolean; // a `system/turn_duration` record (backfill's `turn.ended`); not a blocked prompt's record, also written for a steer dropped mid-turn
  own: boolean; // holder-backed writer attribution at ingestion, not entrypoint alone
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
  emitted: Set<MessageUuid>; // delivered chain records plus silently retained local history; real cuts remove them
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
  // The live holders of this transcript's session now (the registry's live records naming it). Absent: none, so the
  // terminal-rewind reading is decided by the transcript's shape alone.
  holders?: () => number;
  // W7: whether a foreign process holds the session now (charter §4.3 as amended 2026-10-01). While it does, a sibling
  // branch another writer starts does not displace records MAWS wrote; absent, never.
  pinned?: () => boolean;
  isOwnRecord?: (record: TranscriptRecord) => boolean; // holder-backed writer attribution; absent, no ownership evidence
}

const PAGE_BYTES = 1024 * 1024;
const MAX_PARTIAL_BYTES = 8 * 1024 * 1024;
const BATCH_SIZE = 500;
const SYNC_ATTEMPTS = 3; // stat-then-read attempts per start or poke when reads meet a replaced or shrunk file
const NEWLINE = 0x0a;

// Non-uuid record types the engine writes that carry nothing for the graph (SPEC 35.5).
const KNOWN_SILENT_TYPES = new Set([
  'last-prompt', 'custom-title', 'ai-title', 'relocated', 'queue-operation', 'mode', 'permission-mode', 'atis-latch',
  'file-history-snapshot', 'file-history-delta', 'cost-state', 'summary', 'tag', 'history-suppression', 'ended-by-model',
  'continued-in', 'attribution-snapshot', 'fork-context-ref', 'observer-ref', 'worktree-state', 'pr-link', 'agent-setting',
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
  private deferredLine: number | null = null; // oversized unsealed line: keep its offset, not its bytes
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
  held = false; // W7: a sibling branch is being held back while the session is contested (its notice went out once)

  constructor(
    private readonly reader: FileReader,
    readonly ctx: BackfillContext,
    private readonly holders: () => number = () => 0,
    private readonly pinned: () => boolean = () => false,
    private readonly isOwnRecord: (record: TranscriptRecord) => boolean = () => false,
  ) {}

  // One chunk read at the cursor: dispatch every complete line, keep the remainder, advance the cursor.
  async consume(chunk: Buffer): Promise<void> {
    const buf = this.partial.length === 0 ? chunk : Buffer.concat([this.partial, chunk]);
    const base = this.offset - this.partial.length;
    let lineStart = 0;
    for (;;) {
      const newline = buf.indexOf(NEWLINE, lineStart);
      if (newline === -1) break;
      if (this.deferredLine !== null) {
        // Only a sealed record is materialised. Retained tail memory stays bounded even if a writer never seals it;
        // parsing a complete record costs O(record size), not O(file size), and never discards valid large documents.
        const length = base + newline - this.deferredLine;
        const line = await this.reader.read(this.deferredLine, length);
        if (line.length !== length) {
          this.interrupted = true;
          return;
        }
        await this.dispatchLine(line, this.deferredLine);
        this.deferredLine = null;
      } else {
        await this.dispatchLine(buf.subarray(lineStart, newline), base + lineStart);
      }
      lineStart = newline + 1;
    }
    this.offset += chunk.length;
    if (this.deferredLine !== null) return;
    this.partial = Buffer.from(buf.subarray(lineStart));
    if (this.partial.length > MAX_PARTIAL_BYTES) {
      this.deferredLine = this.offset - this.partial.length;
      this.partial = Buffer.alloc(0);
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
    const message = record.message as { id?: unknown; content?: unknown } | null | undefined;
    const humanPrompt = isHumanPrompt(record);
    const skeleton: Skeleton = {
      uuid,
      parentUuid: typeof record.parentUuid === 'string' ? (record.parentUuid as MessageUuid) : null,
      type: record.type,
      messageId: record.type === 'assistant' && typeof message?.id === 'string' ? message.id : null,
      sourceToolAssistantUuid: record.type === 'user' && typeof record.sourceToolAssistantUUID === 'string' ? record.sourceToolAssistantUUID as MessageUuid : null,
      isToolResult: record.type === 'user' && Array.isArray(message?.content) && message.content.some((block: unknown) => typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_result'),
      agentId: typeof record.agentId === 'string' ? record.agentId : null,
      isSidechain: record.isSidechain === true,
      isDiagnostic: record.type === 'assistant' && record.isApiErrorMessage === true,
      humanPrompt,
      delivery: humanPrompt || record.isCompactSummary === true || (record.type === 'system' && record.subtype === 'compact_boundary') ? null
        : record.type === 'attachment' || record.type === 'system' || isTaskNotification(record) ? 'interleave'
        : (record.type === 'user' && record.isMeta === true) || (record.type === 'assistant' && record.isApiErrorMessage === true) ? 'tail' : null,
      deliveryOwner: null,
      noResponse: isNoResponseMarker(record),
      localTurnUuid: null,
      localCaveat: localCommandKind(record) === 'caveat',
      localCommand: localCommandKind(record) === 'caveat' || localCommandKind(record) === 'output'
        || (localCommandKind(record) === 'echo' && typeof record.parentUuid === 'string' && this.skeletons.get(record.parentUuid as MessageUuid)?.localCaveat === true)
        || (record.type === 'user' && singleText(record) === '/compact'),
      isProgress: record.type === 'progress',
      startsTurn: startsTurn(record),
      opensTurn: opensTurn(record), // E7
      endsTurn: record.type === 'system' && record.subtype === 'turn_duration',
      own: this.isOwnRecord(record),
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : null,
      offset,
      length: lineBytes.length,
    };
    this.skeletons.set(uuid, skeleton);
    if (typeof record.gitBranch === 'string') this.facts.gitBranch = branchName(record.gitBranch); // W9 (H2): HEAD is no branch
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
      this.invalidateHiddenLocalHistory(segment);
      this.produce(null, { ...eventBase(this.ctx, `anchor:${offset}`), kind: 'boundary.rewind', targetMessageUuid, precedingAssistantUuid: leafUuid, prefillText });
    }
    this.rewind = { phase: 'announced', leafUuid, targetMessageUuid, prefillText, anchorOffset: offset };
  }

  private async handleRecord(record: TranscriptRecord, skeleton: Skeleton): Promise<void> {
    const parent = this.throughProgress(skeleton.parentUuid);
    if (parent === this.leaf) {
      const group = parent === null ? null : this.responseGroup(parent);
      if (group !== null && skeleton.delivery !== null && this.sameScope(skeleton, group)) skeleton.deliveryOwner = group.uuid;
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
      else if (this.skeletons.get(member)?.localCommand) await this.reemit(member, false);
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
    let newChain: MessageUuid[] = [uuid];
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
      if (this.onChain.has(current)) {
        // The adopted prefix can contain recovered parallel results outside raw parentUuid ancestry. Keep it;
        // a fork still removes every member after this ancestor, recovered records included.
        newChain = newChain.concat(this.chain.slice(0, this.chain.indexOf(current) + 1).reverse());
        gap = this.gap;
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
    // Attachments can be leaf siblings of the next tool result, not another writer's branch. An attachment-only
    // removal swaps silently, even when MAWS wrote the attachments: neither W7 nor the rewind heuristic reads it.
    const leafSibling = removed.length > 0 && removed.every((member) => this.skeletons.get(member)?.type === 'attachment');
    // FX6: split assistants share an API message id; each tool result parents on its issuing assistant (SPEC 11.2.2).
    // Like the engine's recovery (SPEC 35.12.3), retain the whole response group, in file order, without a boundary.
    // The incoming record must belong too: a prompt or a different response at an older tool is still a real fork.
    if (!leafSibling && parent !== null && this.onChain.has(parent) && removed.length > 0) {
      const group = this.responseGroup(parent);
      const incoming = this.skeletons.get(uuid)!;
      const delivery = group !== null && incoming.delivery === 'interleave' && this.sameScope(incoming, group)
        // Two delivery tails selecting the same older parent are ambiguous; only core siblings can be crossed.
        && removed.every((member) => this.skeletons.get(member)?.delivery === null || this.skeletons.get(member)?.type === 'attachment');
      if (group !== null && (this.inResponseGroup(uuid, group) || delivery) && removed.every((member) => this.inResponseGroup(member, group))) {
        if (delivery) incoming.deliveryOwner = group.uuid;
        this.extend(record, uuid);
        return;
      }
    }
    // FX8 C: these records are local history rather than model conversation; swapping them must not retract
    // their already-delivered output. Attachments may accompany a deferred bare /compact echo.
    const localOnly = removed.length > 0 && removed.every((member) => {
      const skeleton = this.skeletons.get(member)!;
      return skeleton.localCommand || (skeleton.type === 'attachment' && !skeleton.humanPrompt);
    });
    const noResponseOnly = removed.length > 0 && removed.every((member) => this.skeletons.get(member)?.noResponse === true);
    // FX8 E: a continuation can add previously off-chain ancestry without removing anything. Keep the
    // normal swap/re-delivery path (including a rejected rewind), but there is nothing to retract or announce.
    const silentSwap = removed.length === 0 || leafSibling || localOnly || noResponseOnly;
    // W7: decided before any reading of the branch as a rewind: while a foreign process holds the session, its branch
    // never retracts what MAWS wrote (after MAWS's exit one live holder is left, which the terminal-rewind reading would
    // otherwise accept). MAWS's branch stays in view; this record joins the skeletons only, and one notice says why.
    if (!silentSwap && this.holdsBack(record, removed)) {
      if (!this.held) this.produce(null, { ...eventBase(this.ctx, `branch:${uuid}:held`), kind: 'notice.posted', level: 'warning', text: HELD_NOTICE, key: 'transcript_branch_held' });
      this.held = true;
      return;
    }
    const terminal = !silentSwap && this.rewind === null ? this.terminalRewind(record, parent) : null;
    for (const member of removed) {
      // A silent local-history swap leaves these events visible. Keep their delivery identity if the
      // record later rejoins; conversational records removed by a real cut must still be mapped again.
      if (!(silentSwap && this.skeletons.get(member)?.localCommand)) this.emitted.delete(member);
    }
    if (!silentSwap && this.chain.length > 0) {
      if (terminal !== null) {
        this.invalidateHiddenLocalHistory(removed);
        this.produce(null, { ...eventBase(this.ctx, `branch:${uuid}:rewind`), kind: 'boundary.rewind', ...terminal, prefillText: null });
      } else if (this.rewind?.phase === 'unanchored') {
        const targetMessageUuid = removed.find((member) => this.skeletons.get(member)?.type === 'user') ?? null;
        if (targetMessageUuid !== null) {
          this.invalidateHiddenLocalHistory(removed);
          this.produce(null, { ...eventBase(this.ctx, `anchor:${this.rewind.anchorOffset}`), kind: 'boundary.rewind', targetMessageUuid, precedingAssistantUuid: this.rewind.leafUuid, prefillText: this.rewind.prefillText });
        }
      } else {
        // No anchor explains this, or the announced rewind rejected the parent. The cut does not prove contention.
        this.produce(null, { ...eventBase(this.ctx, `branch:${uuid}:retraction`), kind: 'boundary.retraction', retractedMessageUuids: removed, reason: 'transcript_branch', fallbackModel: null });
      }
    }
    const previousChain = this.onChain;
    this.chain = newChain;
    this.onChain = newSet;
    this.leaf = uuid;
    this.gap = gap;
    this.rewind = null;
    for (const member of newChain) {
      if (member === uuid) this.emit(record, uuid);
      else if (!this.emitted.has(member)) await this.reemit(member);
      else if (!previousChain.has(member) && this.skeletons.get(member)?.localCommand) await this.reemit(member, false);
    }
  }

  // Rewinds hide whole turns, including local history silently swapped off the chain. Restore its delivery
  // eligibility when its owning turn is hidden. An off-chain command can itself own a turn beneath a cut
  // prompt; follow only that local ownership ancestry, leaving earlier still-visible history delivered.
  private invalidateHiddenLocalHistory(removed: MessageUuid[]): void {
    const hiddenTurns = new Set(removed.filter((uuid) => this.skeletons.get(uuid)?.startsTurn));
    for (const uuid of this.emitted) {
      const local = this.skeletons.get(uuid);
      if (!local?.localCommand || this.onChain.has(uuid)) continue;
      let owner = local.localTurnUuid;
      for (let hops = 0; owner !== null && hops < this.skeletons.size; hops++) {
        if (hiddenTurns.has(owner)) {
          this.emitted.delete(uuid);
          break;
        }
        owner = this.skeletons.get(owner)?.parentUuid ?? null;
      }
    }
  }

  // A diagnostic never owns a response. Delivery ownership is recorded only on an unbranched extension or a
  // proved interleave; ancestry alone cannot turn an older prompt or a branched meta tail into a group member.
  private responseGroup(uuid: MessageUuid): Skeleton | null {
    const skeleton = this.skeletons.get(uuid);
    if (skeleton === undefined) return null;
    if (skeleton.type === 'assistant' && !skeleton.isDiagnostic) return skeleton.messageId === null ? null : skeleton;
    const source = skeleton.isToolResult ? skeleton.sourceToolAssistantUuid ?? skeleton.parentUuid : skeleton.deliveryOwner;
    const assistant = source === null ? undefined : this.skeletons.get(source);
    return assistant?.type === 'assistant' && !assistant.isDiagnostic && assistant.messageId !== null && this.sameScope(skeleton, assistant) ? assistant : null;
  }

  private sameScope(a: Skeleton, b: Skeleton): boolean {
    return a.agentId === b.agentId && a.isSidechain === b.isSidechain;
  }

  private inResponseGroup(uuid: MessageUuid, group: Skeleton): boolean {
    const owner = this.responseGroup(uuid);
    return owner !== null && owner.messageId === group.messageId && this.sameScope(owner, group);
  }

  // W7: a second writer's branch that would retract records MAWS wrote, while a foreign process holds the session. A
  // branch MAWS itself writes goes through (its own branch is the one kept in view), and so does any branch that leaves
  // MAWS's records where they are (two foreign writers flip as before).
  private holdsBack(record: TranscriptRecord, removed: MessageUuid[]): boolean {
    if (this.chain.length === 0 || this.isOwnRecord(record) || !this.pinned()) return false;
    return removed.some((member) => this.skeletons.get(member)?.own === true);
  }

  // A terminal `/rewind` (the interactive engine, 2.1.284) writes no anchor: the next prompt simply parents onto the
  // last record of the turn it rewound to. That shape is read as a rewind only when this record opens a turn, its
  // parent is on the current chain with a turn-opening prompt right after it (so the parent ended a turn), an assistant
  // record precedes the parent, and at most one process holds the session now (none: nobody is writing it; two or
  // more: a contested transcript, the second writer's).
  private terminalRewind(record: TranscriptRecord, parent: MessageUuid | null): { targetMessageUuid: MessageUuid; precedingAssistantUuid: MessageUuid } | null {
    if (parent === null || !startsTurn(record) || !this.onChain.has(parent)) return null;
    const at = this.chain.indexOf(parent);
    const next = this.chain[at + 1];
    if (next === undefined || this.skeletons.get(next)?.startsTurn !== true) return null;
    const precedingAssistantUuid = this.chain
      .slice(0, at + 1)
      .reverse()
      .find((member) => this.skeletons.get(member)?.type === 'assistant');
    if (precedingAssistantUuid === undefined || this.holders() > 1) return null;
    return { targetMessageUuid: next, precedingAssistantUuid };
  }

  // Once a re-read has met another file, no record's events from the rest of this pass are delivered or counted as
  // delivered: the reload that follows delivers every chain record not in `emitted`, in chain order, so none is lost or
  // delivered ahead of a record before it. Anchor- and branch-derived boundaries of the pass still go out: the chain
  // keeps their cuts, and the reload reconciles against that chain.
  private emit(record: TranscriptRecord, uuid: MessageUuid): void {
    if (this.interrupted) return;
    this.produce(uuid, ...recordToEvents(record, this.ctx));
    const skeleton = this.skeletons.get(uuid);
    if (skeleton?.localCommand) skeleton.localTurnUuid = this.ctx.lastTurnUserUuid;
    this.emitted.add(uuid);
  }

  private produce(source: MessageUuid | null, ...events: SessionEvent[]): void {
    const group = ++this.groups;
    for (const event of events) this.out.push({ source, group, event });
  }

  // A record that came onto the chain after its line was read: re-read it by offset (attachments carry no events, so
  // their bytes are not fetched). Silently retained local history restores mapper context on rejoin without
  // publishing its events again: its command turn, not the abandoned branch's turn, owns the continuation.
  private async reemit(uuid: MessageUuid, publish = true): Promise<void> {
    const skeleton = this.skeletons.get(uuid);
    if (skeleton === undefined || this.interrupted) return;
    if (skeleton.type === 'attachment') {
      this.emitted.add(uuid);
      return;
    }
    const record = parseLine(await this.reader.read(skeleton.offset, skeleton.length));
    if (record !== null && record.uuid === uuid) {
      if (publish) this.emit(record, uuid);
      else recordToEvents(record, this.ctx);
    }
    // The file changed under the read (a rename-over, or a rewrite in place): the record stays undelivered and the
    // retry reloads the file, which delivers it (a reload in progress is abandoned and retried at once).
    else this.interrupted = true;
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

  // The synthesised end of a transcript nobody is writing whose last turn on the chain never ended (C6's ask): the
  // process is gone and was not seen to go, so `process.exited { reason: 'unknown' }` at the last record's time, where a
  // synthetic `turn.ended` would invent a result. Null when the chain's last turn ended or none started.
  unendedTurnExit(): SessionEvent | null {
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const skeleton = this.skeletons.get(this.chain[i]);
      if (skeleton?.endsTurn) return null;
      if (!skeleton?.opensTurn) continue; // E7: a peer message's turn too
      const at = (this.leaf === null ? null : this.skeletons.get(this.leaf)?.timestamp) ?? this.ctx.lastAt;
      return {
        ...eventBase(this.ctx, `session:${this.ctx.sessionId}:exited`),
        at,
        agentId: null,
        kind: 'process.exited',
        code: null,
        signal: null,
        reason: 'unknown',
        lostAttentionCount: 0,
        budget: null, // C12
      };
    }
    return null;
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

export const HELD_NOTICE = 'Another process is writing a sibling branch into this transcript; MAWS keeps its own branch in view until that process exits';
export const REFOLD_NOTICE = 'The other process exited; this transcript now shows the branch a resume continues from';

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
  private backfillEnded = false; // the first complete read of this follow has happened

  constructor(
    private readonly reader: FileReader,
    private readonly sessionId: SessionId,
    private readonly agent: { agentId: AgentId; parentToolUseId: ParentToolUseId | null } | null,
    private readonly sink: (e: FollowerEvent) => void,
    private readonly options: ChainFollowerOptions = {},
  ) {
    this.core = this.freshCore();
  }

  // `following` is reported only once a read completed against a stable inode, so a snapshot never calls an
  // interrupted backfill complete; a start whose every attempt was interrupted stays `backfilling` for the next poke.
  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      this.report('backfilling');
      try {
        const outcome = await this.sync(true);
        if (outcome === 'complete' || outcome === 'absent') {
          this.endBackfill(); // a missing file ends it too: a transcript that appears later is being written now
          this.report('following'); // a missing file waits, following
        }
      } catch (error) {
        this.report('error', messageOf(error));
      }
    });
  }

  poke(): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      try {
        if ((await this.sync(false)) === 'complete') {
          this.endBackfill(); // a start whose every read was interrupted ends its backfill here
          this.report('following');
        }
      } catch (error) {
        this.report('error', messageOf(error));
      }
    });
  }

  // W7: the contest ended (the foreign holder exited). A follower that held a branch back reads the file again as it
  // stands and reconciles, as a rewrite does: the chain becomes the one the transcript ends on (the branch a resume
  // continues from, pass3/w7-collision), the records it leaves are one retraction, and a notice says why. A follower
  // that held nothing back has nothing to re-fold.
  refold(): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped || !this.core.held) return;
      try {
        const stat = await this.reader.stat();
        if (this.stopped || stat === null) return;
        if (await this.reload(stat, 'refold')) this.report('following');
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

  // After the backfill's last record, once per follow: a session's own transcript that no live process holds and whose
  // last turn never ended (SDK entrypoints write no `turn_duration`) gets the synthesised exit. A holder that appears
  // later changes nothing here; the live producer (C3) owns the session's ending from then on. An agent's transcript
  // carries none: the process is its parent session's.
  private endBackfill(): void {
    if (this.backfillEnded || this.stopped) return;
    this.backfillEnded = true;
    if (this.agent !== null || (this.options.holders?.() ?? 0) > 0) return;
    const exit = this.core.unendedTurnExit();
    if (exit !== null) this.deliver([{ source: null, group: 0, event: exit }]);
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
    return new FollowerCore(this.reader, createBackfillContext({ sessionId: this.sessionId, agent: this.agent, subagents: this.options.subagents }), this.options.holders, this.options.pinned, this.options.isOwnRecord);
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
    core.interrupted = false;
    while (core.offset < toSize) {
      const chunk = await this.reader.read(core.offset, Math.min(PAGE_BYTES, toSize - core.offset));
      if (this.stopped || chunk.length === 0) return false;
      await core.consume(chunk);
      if (this.stopped || core.interrupted) return false;
      if (flushEachPage) this.flush(core);
    }
    return !core.interrupted;
  }

  // One catch-up: stat, then read what was appended, or reload a rewritten file. A read interrupted by a replacement
  // or a shrink (`readForward` answers false) is retried from a fresh stat, up to SYNC_ATTEMPTS times: what was read
  // whole before the interruption is the old file's and is delivered; nothing of the new file is ever read under the
  // old inode's cursor. 'absent': no file (not there yet, or gone); 'interrupted': every attempt was.
  private async sync(flushEachPage: boolean): Promise<'complete' | 'interrupted' | 'absent' | 'stopped'> {
    let interrupted = false;
    for (let attempt = 0; attempt < SYNC_ATTEMPTS; attempt++) {
      const stat = await this.reader.stat();
      if (this.stopped) return 'stopped';
      if (stat === null) return 'absent';
      const core = this.core;
      // Nothing read yet (a start interrupted before its first byte): the new file is simply the file.
      const nothingRead = core.offset === 0 && core.skeletons.size === 0;
      if (nothingRead) core.ino = stat.ino;
      // After an interrupted attempt the file is reloaded whatever the stat says: a rewrite in place (same inode, same
      // or greater size) looks unchanged to it, and the interrupted pass holds chain records it never delivered.
      let whole: boolean;
      if (core.ino !== null && ((interrupted && !nothingRead) || stat.ino !== core.ino || stat.size < core.offset)) {
        whole = await this.reload(stat);
      } else {
        if (core.ino === null) core.ino = stat.ino;
        whole = stat.size > core.offset ? await this.readForward(core, stat.size, flushEachPage) : true;
        if (this.stopped) return 'stopped';
        this.flush(core);
      }
      if (this.stopped) return 'stopped';
      if (whole) return 'complete';
      interrupted = true;
    }
    return 'interrupted';
  }

  // The file was rewritten (GC, tombstone removal, hydration, relocation): run a cold start into a fresh core with
  // delivery suppressed, then reconcile the old delivered state against the fresh final state and nothing else.
  // Old-chain records missing from the fresh chain are one retraction; fresh-chain records the old follower had not
  // delivered are delivered in chain order. The fresh run's own anchor-, branch- and line-derived events describe
  // history the consumer already holds (a rewrite that shifts an anchor's byte offset changes its id, not its
  // meaning) and are never delivered.
  // A fresh run whose own read is interrupted (the file replaced again between the reload's stat and its read, or
  // shrunk) describes no file: it is abandoned, never reconciled — an empty fresh chain would retract everything the
  // consumer holds — the old state stands, and `sync` retries from a fresh stat. Answers whether it reconciled.
  // W7: a re-fold (`refold`) reconciles the same way, its retraction and a notice naming the contest's end.
  private async reload(stat: { ino: number; size: number }, cause: 'rewrite' | 'refold' = 'rewrite'): Promise<boolean> {
    this.report('reloading');
    const fresh = this.freshCore();
    fresh.ino = stat.ino;
    const whole = await this.readForward(fresh, stat.size, false);
    if (this.stopped || !whole) return false;
    const old = this.core;
    const freshChain = new Set(fresh.chain);
    const retracted = old.chain.filter((uuid) => !freshChain.has(uuid));
    const produced: Produced[] = [];
    if (retracted.length > 0) {
      const id = `${cause === 'refold' ? 'refold' : 'rewrite'}:${fresh.ino}:${fresh.offset}`;
      produced.push({ source: null, group: 0, event: { ...eventBase(fresh.ctx, id), kind: 'boundary.retraction', retractedMessageUuids: retracted, reason: cause === 'refold' ? 'transcript_branch' : 'transcript_rewritten', fallbackModel: null } });
      if (cause === 'refold') produced.push({ source: null, group: 0, event: { ...eventBase(fresh.ctx, `${id}:notice`), kind: 'notice.posted', level: 'info', text: REFOLD_NOTICE, key: 'transcript_refold' } });
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
    // The fresh pass suppresses off-chain events. Only local history actually delivered before the reload
    // may keep its silent-swap delivery identity; an unseen local record must still emit if it rejoins later.
    for (const uuid of fresh.emitted) {
      if (!freshChain.has(uuid) && !old.emitted.has(uuid)) fresh.emitted.delete(uuid);
    }
    fresh.out = [];
    this.core = fresh;
    this.deliver(produced);
    this.flush(fresh);
    return true;
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
