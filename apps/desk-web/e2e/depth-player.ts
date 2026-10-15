// The session plane of one recorded session, served through DC5's DX3 double (the DC6 plan's Decision Log, "The
// double's fixture"): it answers each `subscribe` the browser sends for the session's main transcript with the snapshot
// at the playhead, plays the live script (chunks, `block-row`, rows, synthesized from the recording) to every open
// subscription as the suite advances it, and answers `rows` with older pages. The double itself is used as it stands:
// the player reads the frames it records (`hub.up`) and sends through `hub.sendSession`.
import type { JsonObject, SessionBodies, SessionMessage, SubagentMeta } from 'desk-hub/protocol';
import type { HubDouble } from '../test/double/hub-double';
import { readRecording, rowsBefore, scriptOf, snapshotAt, type LiveItem, type ScriptOptions } from '../test/double/session-stream';

type Open = { sub: string; n: number };

export type PlayerOptions = ScriptOptions & {
  project: string;
  machine: string;
  session: string;
  /** Rows before the main transcript's own (a row the suite stages, as a hostile one). */
  extraRows?: JsonObject[];
  /** The newest rows a snapshot carries at most; older ones are paged in. */
  limit?: number;
};

export class DepthPlayer {
  readonly script: LiveItem[];
  /** How many items of the script have been played. */
  playhead = 0;
  /** The next subscription's snapshot is taken this many items back: they are sent again after it, as a producer whose snapshot already held them would. */
  overlapNext = 0;
  /** Holds each `rows` answer until `releaseRows`, so a suite can look at the column while a page is on its way. */
  holdRows = false;
  private held: Array<() => void> = [];
  private readonly open: Open[] = [];
  private cursor = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly subagents: SubagentMeta[];

  constructor(
    private readonly hub: HubDouble,
    private readonly options: PlayerOptions,
  ) {
    const recording = readRecording();
    this.subagents = recording.subagents.map(({ agentId, meta }) => ({ agentId, meta }));
    this.script = scriptOf([...(options.extraRows ?? []), ...recording.session], null, options);
    this.timer = setInterval(() => this.poll(), 5);
  }

  stop(): void {
    clearInterval(this.timer);
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
      else if (frame.t === 'unsubscribe') this.closeSub(frame.sub);
      else if (frame.t === 'rows') this.rows(frame.sub, frame.before, frame.limit);
    }
  }

  private subscribed(sub: string): void {
    const open: Open = { sub, n: 0 };
    this.open.push(open);
    const cut = Math.max(0, this.playhead - this.overlapNext);
    this.overlapNext = 0;
    this.send(open, 'snapshot', snapshotAt(this.script, this.playhead, { subagents: this.subagents, limit: this.options.limit }));
    for (const item of this.script.slice(cut, this.playhead)) this.send(open, item.kind, item.body);
  }

  private closeSub(sub: string): void {
    const at = this.open.findIndex((open) => open.sub === sub);
    if (at >= 0) this.open.splice(at, 1);
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
    const n = kind === 'snapshot' ? 0 : ++open.n;
    const { project, machine, session } = this.options;
    this.hub.sendSession(project, { project, machine, session, kind, sub: open.sub, n, body } as SessionMessage);
  }
}
