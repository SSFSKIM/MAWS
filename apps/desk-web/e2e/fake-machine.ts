// DC3's fake machine, as the depth acceptance meets it (the DC6 plan's M3): its committed recording (`TWO_SUBAGENTS`,
// a real haiku session through DC2's bridge with two subagents) replayed by its own DX4 producer (`SessionDepth`, the
// fake machine's `session.ts`: subscribe before snapshot, the watermark, a block leaving the snapshot at its
// `block-row`, `step-end`, the subagent tree, `usage`, `diff`, older pages, its race hooks), with DC5's DX3 double
// standing for the hub's relay, which DC3's own G5 suite proves on the local runtime. Every coupling of the browser
// suites to the fake machine is in this file.
//
// What does not fit `interfaces-M4` as written (reported to DC3 through the DC6 plan): `FakeMachine` speaks DX2 to a
// hub, and the desk's gated browser lane has none (DC5's local-hub suite is outside the gate, and its first setup is a
// one-time ceremony per hub state), so this drives the producer without the network; `desk-hub/fake-machine` exports
// `SessionDepth` only as types, so it is imported by path below.
import type { SessionMessage } from 'desk-hub/protocol';
import { loadRecording, TWO_SUBAGENTS, type Recording, type SnapshotOptions, type Step } from 'desk-hub/fake-machine';
import { SessionDepth } from '../../desk-hub/fake-machine/session';
import type { HubDouble } from '../test/double/hub-double';

export class FakeMachineReplay {
  readonly recording: Recording = loadRecording(TWO_SUBAGENTS);
  readonly depth: SessionDepth;
  /** How many steps of the timeline have been applied. */
  played = 0;
  /** The next subscription's snapshot hooks (`raceNextSnapshot`'s `advance` and `overlap`) and its scope, used once. */
  private nextSnapshot: { agentId: string | null; options: SnapshotOptions } | null = null;
  private cursor = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly hub: HubDouble,
    readonly where: { project: string; machine: string },
  ) {
    this.depth = new SessionDepth(this.recording.session, this.recording, (message) => this.hub.sendSession(where.project, message), where);
    this.timer = setInterval(() => this.poll(), 5);
  }

  get session(): string {
    return this.recording.session;
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** The session's presence as its machine reports it (DX4 `presence`, outside any subscription). */
  sendPresence(): void {
    const { project, machine } = this.where;
    this.hub.sendSession(project, { project, machine, session: this.session, kind: 'presence', sub: null, n: null, body: { record: this.depth.presence, bridge: true } } as SessionMessage);
  }

  /** Applies the next `count` steps of the timeline. */
  step(count = 1): void {
    for (let i = 0; i < count && this.played < this.recording.steps.length; i++) this.apply(this.recording.steps[this.played++]);
  }

  /** Applies steps through the first one `match` accepts at or after the cursor (all of them when none does). */
  playThrough(match: (step: Step) => boolean = () => false): Step | null {
    while (this.played < this.recording.steps.length) {
      const step = this.recording.steps[this.played++];
      this.apply(step);
      if (match(step)) return step;
    }
    return null;
  }

  /** The browser's socket drops: the hub forgets its subscriptions, and so does the machine. */
  drop(): void {
    this.hub.dropConnections();
    this.depth.forgetAll();
  }

  /** While the next snapshot of `agentId`'s transcript is built, `advance` more steps are applied; with `overlap` the
   * live part is also handed what the snapshot holds (as `raceNextSnapshot` does). */
  raceNextSnapshot(options: { agentId?: string | null; advance?: number; overlap?: boolean }): void {
    this.nextSnapshot = { agentId: options.agentId ?? null, options: { overlap: options.overlap, duringSnapshot: async () => this.step(options.advance ?? 0) } };
  }

  /** The timeline's index of the first chunk of the block whose row is `uuid` (named by its `block-row`). */
  firstChunkOf(uuid: string): number {
    const named = this.recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid);
    if (named?.k !== 'block-row') throw new Error(`no block-row names ${uuid}`);
    const { turnId, agentId, step, index } = named.body;
    return this.recording.steps.findIndex((s) => s.k === 'chunk' && s.turnId === turnId && s.agentId === agentId && s.step === step && s.chunk.index === index);
  }

  /** The main transcript's rows a fresh load at this point draws, by uuid, oldest first. */
  rowsSoFar(agentId: string | null = null): string[] {
    return (this.depth.rows.get(agentId ?? 'main') ?? []).map((row) => row.uuid);
  }

  /** The subscriptions the machine serves, by scope. */
  subscriptions(agentId: string | null = null): number {
    return this.hub.subscriptions(this.where.project).filter((s) => s.session === this.session && s.agentId === agentId && this.depth.holds(s.sub)).length;
  }

  private apply(step: Step): void {
    this.depth.apply(step);
    if (step.k === 'presence') {
      this.depth.presence = step.record;
      this.sendPresence();
    }
  }

  private poll(): void {
    while (this.cursor < this.hub.up.length) {
      const { project, frame } = this.hub.up[this.cursor++];
      if (project !== this.where.project) continue;
      if (frame.t === 'subscribe' && frame.session === this.session) {
        const raced = this.nextSnapshot?.agentId === frame.agentId ? this.nextSnapshot : null;
        if (raced) this.nextSnapshot = null;
        void this.depth.subscribe(frame.sub, frame.agentId, raced?.options ?? {});
      } else if (frame.t === 'unsubscribe') this.depth.end(frame.sub, 'unsubscribed');
      else if (frame.t === 'rows') this.depth.page(frame.sub, frame.before, frame.limit);
      else if (frame.t === 'diff') this.depth.diff(frame.sub);
    }
  }
}
