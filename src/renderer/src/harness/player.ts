// One loaded fixture in the harness: its events behind a replay source, applied batch by batch to the transcript model
// with the cost of each batch recorded. History before the fixture's streamed tail is released at load.
import { replaySource, type ReplaySource } from '../transcript/source/replay';
import type { LoadedFixture } from './fixtures';
import { PrototypeTranscript } from './prototype-model';

let sessions = 0;

export class HarnessSession {
  readonly id = ++sessions;
  readonly model = new PrototypeTranscript();
  readonly source: ReplaySource;
  readonly eventCount: number;
  batches = 0;
  lastBatchMs = 0;
  private readonly unsubscribe: () => void;

  constructor(fixture: LoadedFixture, speed: number) {
    this.source = replaySource(fixture.events, { speed });
    this.eventCount = fixture.events.length;
    this.unsubscribe = this.source.subscribe((batch) => {
      const started = performance.now();
      this.model.apply(batch);
      this.lastBatchMs = performance.now() - started;
      this.batches += 1;
    });
    if (fixture.streamFrom !== null) this.source.seek(fixture.streamFrom);
  }

  dispose(): void {
    this.source.pause();
    this.unsubscribe();
  }
}
