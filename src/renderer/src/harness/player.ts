// One loaded fixture in the harness: its events behind a replay source, attached to the transcript store under its own
// key before any history is released (the Transcript re-attaches the same key when it mounts), with the cost of each
// batch recorded. History before the fixture's streamed tail is released at load.
import type { SessionEvent } from '@shared/graph/events';
import { toolUseOf, type AgentId, type AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { useTranscriptStore } from '../stores/transcript';
import type { SubagentRef, TurnId } from '../transcript/model/rows';
import { replaySource, type ReplaySource } from '../transcript/source/replay';
import type { TranscriptSource } from '../transcript/source/types';
import type { LoadedFixture } from './fixtures';
import { pagedSource } from './paged';

let sessions = 0;

export class HarnessSession {
  readonly id = ++sessions;
  // P5 O6 M2: the key stands for a session's id (the transcript asks for its browser activities by it), so it is an
  // address of the local machine, as every id the page mints.
  readonly key: string = addressOf(ipc.localMachine, `harness:${this.id}` as AppSessionId);
  readonly player: ReplaySource;
  readonly source: TranscriptSource; // the player, with every batch timed
  readonly eventCount: number;
  readonly events: readonly SessionEvent[]; // the fixture's, whatever is loaded of them
  batches = 0;
  lastBatchMs = 0;
  deriveMs = 0; // the last batch that changed the row list
  readonly attached: Promise<void>; // the key hydrated

  // `paged`: the fixture is a long session's disk history, opened on its newest window, older pages on their way after
  // `delayMs` each (paged.ts); nothing streams.
  constructor(fixture: LoadedFixture, speed: number, paged: { delayMs: number } | null = null) {
    this.player = replaySource(paged ? [] : fixture.events, { speed, key: this.key });
    this.eventCount = fixture.events.length;
    this.events = fixture.events;
    const { player } = this;
    this.source = paged ? pagedSource(this.key, fixture.events, paged.delayMs) : {
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
    this.attached = useTranscriptStore.getState().attach(this.key, this.source);
    if (fixture.streamFrom !== null && !paged) this.player.seek(fixture.streamFrom);
  }

  rows = () => useTranscriptStore.getState().rows(this.key);

  // A child agent's own transcript (the drill-in C8 builds over `ipcSource(appSessionId, agentId)`), here over the
  // fixture: the child's events released so far (the parent's state indexes them under the parent tool use), then
  // the child's later events as the player releases them. Its events are top-level in its own state. Like ipcSource's
  // child source, it also delivers the parent's report that the child ended, which closes the child's turn.
  childSource(ref: SubagentRef): TranscriptSource {
    const agentId = ref.agentId ?? (ref.taskId as string as AgentId);
    const toolUseId = ref.toolUseId;
    const ofChild = (event: SessionEvent) => event.parentToolUseId !== null && (toolUseId === null ? event.agentId === agentId : toolUseOf(event.parentToolUseId) === toolUseId);
    const finishes = (event: SessionEvent) => (event.kind === 'subagent.finished' || event.kind === 'task.notification') && (event.taskId as string) === (agentId as string);
    const released = (): SessionEvent[] => {
      const state = useTranscriptStore.getState().entries[this.key]?.state;
      if (!state) return [];
      const owner = toolUseId === null ? undefined : state.index.toolUses.get(toolUseId);
      const own = (owner !== undefined && toolUseId !== null && state.turns.get(owner)?.children.get(toolUseId)) || [];
      const finish = [...state.turns.values()].flatMap((turn) => turn.events).findLast(finishes);
      return finish ? [...own, finish] : own;
    };
    return {
      key: `${this.key}:${agentId}`,
      agentId,
      snapshot: () => Promise.resolve(released()),
      subscribe: (listener) =>
        this.player.subscribe((batch: SessionEvent[]) => {
          const events = batch.filter((event) => ofChild(event) || (event.parentToolUseId === null && finishes(event)));
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
