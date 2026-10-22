// The session plane of one recorded session, served through DC5's DX3 double (the DC6 plan's Decision Log, "The
// double's fixture"): it answers each `subscribe` the browser sends for the session's main transcript with the snapshot
// at the playhead, plays the live script (chunks, `block-row`, rows, synthesized from the recording) to every open
// subscription as the suite advances it, and answers `rows` with older pages. The double answers `diff` itself (with
// `diff`, below), numbering it on the subscription, so every message here goes through the double's own numbering
// (`sendSub`). The main transcript's snapshot carries the session's last `usage`, and `sendUsage` plays one after a turn. Each subagent's transcript is a track of
// its own (`agent(id)`), with its own script, playhead, and subscriptions, as DX3 scopes a subscription by `agentId`.
// The double itself is used as it stands: the player reads the frames it records (`hub.up`) and sends through
// `hub.sendSession`. A `read` on the main transcript's subscription is answered with `status` as an M0 bridge answers
// `read status`, every other kind `unsupported`; with `status` null the player passes reads by, as an older machine does.
import type { JsonObject, SessionBodies, SessionMessage, StatusRead, SubagentMeta } from 'desk-hub/protocol';
import type { HubDouble } from '../test/double/hub-double';
import { readRecording, rowsBefore, scriptOf, snapshotAt, withTextAnswer, type LiveItem, type ScriptOptions } from '../test/double/session-stream';

type Open = { sub: string };

export type PlayerOptions = ScriptOptions & {
  project: string;
  machine: string;
  session: string;
  /** Rows before the main transcript's own (a row the suite stages, as a hostile one). */
  extraRows?: JsonObject[];
  /** The newest rows a snapshot carries at most; older ones are paged in. */
  limit?: number;
  /**
   * The main transcript's tree grows as the agents start (a `subagents` message as each `Agent` call is written; the
   * snapshot holds the agents started by the playhead). Without it every snapshot carries the whole tree.
   */
  growTree?: boolean;
};

export class DepthPlayer {
  readonly script: LiveItem[];
  /** How many items of the script have been played. */
  playhead = 0;
  /** The next subscription's snapshot is taken this many items back: they are sent again after it, as a producer whose snapshot already held them would. */
  overlapNext = 0;
  /** Holds each `rows` answer until `releaseRows`, so a suite can look at the column while a page is on its way. */
  holdRows = false;
  /** Holds each new subscription's snapshot until `releaseSubscriptions`. */
  holdSubscriptions = false;
  /** The next this-many subscriptions are ended before their snapshot (`end {discontinuity}` at n 0). */
  endBeforeSnapshot = 0;
  /** What a main-transcript snapshot carries as `usage` (null: no bridge, or none yet). */
  usage: SessionBodies['usage'] | null = null;
  /** How many `diff` requests the browser sent. */
  diffsAsked = 0;
  /** What a `read status` is answered with (null: passed by); how many reads the browser sent. */
  status: StatusRead | null = null;
  readsAsked = 0;
  private held: Array<() => void> = [];
  private readonly open: Open[] = [];
  private cursor = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly subagents: SubagentMeta[];
  private readonly agents = new Map<string, AgentTrack>();

  constructor(
    private readonly hub: HubDouble,
    private readonly options: PlayerOptions,
  ) {
    const recording = readRecording();
    this.subagents = recording.subagents.map(({ agentId, meta }) => ({ agentId, meta }));
    this.script = scriptOf([...(options.extraRows ?? []), ...recording.session], null, { ...options, subagents: options.growTree ? this.subagents : undefined });
    for (const { agentId, rows } of recording.subagents) this.agents.set(agentId, new AgentTrack(hub, options, agentId, scriptOf(withTextAnswer(rows), agentId, { piece: options.piece })));
    this.timer = setInterval(() => this.poll(), 5);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** What the double answers a `diff` request on this session with. */
  set diff(diff: SessionBodies['diff']) {
    this.hub.diffs.set(this.options.session, diff);
  }

  /** One subagent's track: its own script, playhead, and subscriptions. */
  agent(agentId: string): AgentTrack {
    const track = this.agents.get(agentId);
    if (!track) throw new Error(`no recorded subagent ${agentId}`);
    return track;
  }

  /** Plays the next `count` items to every open subscription. */
  advance(count = 1): void {
    const items = this.script.slice(this.playhead, this.playhead + count);
    this.playhead += items.length;
    for (const open of this.open) for (const item of items) this.send(open, item.kind, item.body);
  }

  /** Plays up to (not including) the first item `match` accepts at or after the playhead. */
  advanceTo(match: (item: LiveItem) => boolean): void {
    const at = this.script.findIndex((item, i) => i >= this.playhead && match(item));
    this.advance((at < 0 ? this.script.length : at) - this.playhead);
  }

  /** Moves the playhead without sending: what a hub restart lost in flight. */
  skip(count: number): void {
    this.playhead = Math.min(this.script.length, this.playhead + count);
  }

  /** Ends every open subscription with `reason`. */
  end(reason: SessionBodies['end']['reason']): void {
    for (const open of this.open.splice(0)) this.send(open, 'end', { reason });
  }

  subscriptions(): number {
    return this.open.length;
  }

  /** The rows a fresh load at the playhead holds, oldest first. */
  rowsSoFar(): JsonObject[] {
    return this.script.slice(0, this.playhead).flatMap((item) => (item.kind === 'row' ? [item.body.row] : []));
  }

  private poll(): void {
    while (this.cursor < this.hub.up.length) {
      const { project, frame } = this.hub.up[this.cursor++];
      if (project !== this.options.project) continue;
      if (frame.t === 'subscribe' && frame.session === this.options.session && frame.agentId === null) this.subscribed(frame.sub);
      else if (frame.t === 'subscribe' && frame.session === this.options.session && frame.agentId !== null) this.agents.get(frame.agentId)?.subscribed(frame.sub);
      else if (frame.t === 'unsubscribe') {
        this.closeSub(frame.sub);
        for (const track of this.agents.values()) track.closeSub(frame.sub);
      } else if (frame.t === 'rows') this.rows(frame.sub, frame.before, frame.limit);
      else if (frame.t === 'diff') this.diffsAsked += 1;
      else if (frame.t === 'read' && this.open.some((open) => open.sub === frame.sub)) this.read(frame.sub, frame.id, frame.what);
    }
  }

  private read(sub: string, id: string, what: string): void {
    this.readsAsked += 1;
    if (this.status === null) return;
    this.hub.sendSub(this.options.project, sub, 'read', what === 'status' ? { id, what, result: this.status as unknown as JsonObject } : { id, what, error: { code: 'unsupported', message: `no read ${what}` } });
  }

  /** Releases the subscriptions held so far (`holdSubscriptions`), each answered with its snapshot now. */
  releaseSubscriptions(): number {
    const held = this.heldSubs.splice(0);
    for (const sub of held) this.answer(sub);
    return held.length;
  }

  private heldSubs: string[] = [];

  private subscribed(sub: string): void {
    if (this.endBeforeSnapshot > 0) {
      // Ended before its snapshot (DX4: an `end` may be a subscription's first message, at n 0).
      this.endBeforeSnapshot -= 1;
      const { project, machine, session } = this.options;
      this.hub.sendSession(project, { project, machine, session, kind: 'end', sub, n: 0, body: { reason: 'discontinuity' } });
      return;
    }
    if (this.holdSubscriptions) this.heldSubs.push(sub);
    else this.answer(sub);
  }

  private answer(sub: string): void {
    const open: Open = { sub };
    this.open.push(open);
    const cut = Math.max(0, this.playhead - this.overlapNext);
    this.overlapNext = 0;
    this.send(open, 'snapshot', { ...snapshotAt(this.script, this.playhead, { subagents: this.subagents, limit: this.options.limit }), usage: this.usage });
    for (const item of this.script.slice(cut, this.playhead)) this.send(open, item.kind, item.body);
  }

  private closeSub(sub: string): void {
    const at = this.open.findIndex((open) => open.sub === sub);
    if (at >= 0) this.open.splice(at, 1);
  }

  /** A `usage` after a main turn, to every open main-transcript subscription; later snapshots carry it. */
  sendUsage(usage: SessionBodies['usage']): void {
    this.usage = usage;
    for (const open of this.open) this.send(open, 'usage', usage);
  }

  /** Answers the `rows` requests held so far; how many there were. */
  releaseRows(): number {
    const held = this.held.splice(0);
    for (const answer of held) answer();
    return held.length;
  }

  private rows(sub: string, before: string, limit: number): void {
    const answer = () => {
      const open = this.open.find((o) => o.sub === sub);
      if (open) this.send(open, 'rows', rowsBefore(this.script, this.playhead, before, limit));
    };
    if (this.holdRows) this.held.push(answer);
    else answer();
  }

  private send(open: Open, kind: SessionMessage['kind'], body: unknown): void {
    sendInSub(this.hub, this.options.project, open.sub, kind, body);
  }
}

/** A message on a subscription, numbered by the double (which answers `diff` on it too); none once the sub is gone. */
function sendInSub(hub: HubDouble, project: string, sub: string, kind: SessionMessage['kind'], body: unknown): void {
  if (!hub.subscriptions(project).some((s) => s.sub === sub)) return;
  try {
    hub.sendSub(project, sub, kind as never, body as never);
  } catch {
    // the double forgot the sub (it ended): nothing to number it under
  }
}

/**
 * One subagent's transcript as its own subscriptions see it (DX3: a `subscribe` naming that `agentId`): its script
 * (the agent's rows, its answer written as text too, so its stream has text to draw), its playhead, and its open
 * subscriptions, each answered with the snapshot at the playhead. Its tree is its own: none nested.
 */
export class AgentTrack {
  playhead = 0;
  /** The next subscription's snapshot is taken this many items back: they are sent again after it. */
  overlapNext = 0;
  /** How many `subscribe`s this track has answered. */
  answered = 0;
  private readonly open: Open[] = [];

  constructor(
    private readonly hub: HubDouble,
    private readonly options: PlayerOptions,
    readonly agentId: string,
    readonly script: LiveItem[],
  ) {}

  /** Plays the next `count` items to this track's open subscriptions. */
  advance(count = 1): void {
    const items = this.script.slice(this.playhead, this.playhead + count);
    this.playhead += items.length;
    for (const open of this.open) for (const item of items) this.send(open, item.kind, item.body);
  }

  /** Plays up to (not including) the first item `match` accepts at or after the playhead. */
  advanceTo(match: (item: LiveItem) => boolean): void {
    const at = this.script.findIndex((item, i) => i >= this.playhead && match(item));
    this.advance((at < 0 ? this.script.length : at) - this.playhead);
  }

  /** Moves the playhead without sending: what a hub restart lost in flight. */
  skip(count: number): void {
    this.playhead = Math.min(this.script.length, this.playhead + count);
  }

  /** Ends this track's open subscriptions with `reason`; no other transcript's are touched. */
  end(reason: SessionBodies['end']['reason']): void {
    for (const open of this.open.splice(0)) this.send(open, 'end', { reason });
  }

  subscriptions(): number {
    return this.open.length;
  }

  subscribed(sub: string): void {
    this.answered += 1;
    const open: Open = { sub };
    this.open.push(open);
    const cut = Math.max(0, this.playhead - this.overlapNext);
    this.overlapNext = 0;
    this.send(open, 'snapshot', snapshotAt(this.script, this.playhead, { subagents: [] }));
    for (const item of this.script.slice(cut, this.playhead)) this.send(open, item.kind, item.body);
  }

  closeSub(sub: string): void {
    const at = this.open.findIndex((open) => open.sub === sub);
    if (at >= 0) this.open.splice(at, 1);
  }

  private send(open: Open, kind: SessionMessage['kind'], body: unknown): void {
    sendInSub(this.hub, this.options.project, open.sub, kind, body);
  }
}
