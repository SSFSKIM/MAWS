// One loaded fixture in the harness: its events behind a replay source, attached to the transcript store under its own
// key before any history is released (the Transcript re-attaches the same key when it mounts), with the cost of each
// batch recorded. History before the fixture's streamed tail is released at load.
import type { SessionEvent } from '@shared/graph/events';
import { toolUseOf, type AgentId } from '@shared/graph/ids';
import { useTranscriptStore } from '../stores/transcript';
import type { SubagentRef, TurnId } from '../transcript/model/rows';
import { replaySource, type ReplaySource } from '../transcript/source/replay';
import type { TranscriptSource } from '../transcript/source/types';
import type { LoadedFixture } from './fixtures';

let sessions = 0;

export class HarnessSession {
  readonly id = ++sessions;
  readonly key = `harness:${this.id}`;
  readonly player: ReplaySource;
  readonly source: TranscriptSource; // the player, with every batch timed
  readonly eventCount: number;
  batches = 0;
  lastBatchMs = 0;
  deriveMs = 0; // the last batch that changed the row list

  constructor(fixture: LoadedFixture, speed: number) {
    this.player = replaySource(fixture.events, { speed, key: this.key });
    this.eventCount = fixture.events.length;
    const { player } = this;
    this.source = {
      key: this.key,
      snapshot: () => player.snapshot(),
      subscribe: (listener) =>
        player.subscribe((batch: SessionEvent[]) => {
          const rows = this.rows();
          const started = performance.now();
          listener(batch);
          this.lastBatchMs = performance.now() - started;
          if (this.rows() !== rows) this.deriveMs = this.lastBatchMs;
          this.batches += 1;
        }),
    };
    void useTranscriptStore.getState().attach(this.key, this.source);
    if (fixture.streamFrom !== null) this.player.seek(fixture.streamFrom);
  }

  rows = () => useTranscriptStore.getState().rows(this.key);

  // A child agent's own transcript (the drill-in C8 builds over `ipcSource(appSessionId, agentId)`), here over the
  // fixture: the child's events released so far (the parent's state indexes them under the parent tool use), then
  // the child's later events as the player releases them. Its events are top-level in its own state.
  childSource(ref: SubagentRef): TranscriptSource {
    const agentId = ref.agentId ?? (ref.taskId as string as AgentId);
    const toolUseId = ref.toolUseId;
    const ofChild = (event: SessionEvent) => event.parentToolUseId !== null && (toolUseId === null ? event.agentId === agentId : toolUseOf(event.parentToolUseId) === toolUseId);
    const released = (): SessionEvent[] => {
      const state = useTranscriptStore.getState().entries[this.key]?.state;
      const owner = toolUseId === null ? undefined : state?.index.toolUses.get(toolUseId);
      return (owner !== undefined && toolUseId !== null && state?.turns.get(owner)?.children.get(toolUseId)) || [];
    };
    return {
      key: `${this.key}:${agentId}`,
      agentId,
      snapshot: () => Promise.resolve(released()),
      subscribe: (listener) =>
        this.player.subscribe((batch: SessionEvent[]) => {
          const events = batch.filter(ofChild);
          if (events.length > 0) listener(events);
        }),
    };
  }

  // Turns in reading order, 1-based as the harness API counts them.
  turnId(n: number): TurnId {
    const id = useTranscriptStore.getState().entries[this.key]?.state.order[n - 1];
    if (!id) throw new Error(`no turn ${n}`);
    return id;
  }

  dispose(): void {
    this.player.pause();
    const store = useTranscriptStore.getState();
    for (const key of Object.keys(store.entries)) if (key === this.key || key.startsWith(`${this.key}:`)) store.drop(key); // its children's too
  }
}
