// The harness's fixture catalogue. Journals are bundled lazily as raw text (harness builds only): the probe's pass-1
// root journals and pass-2 journals (never the gitignored `private/` owner data; sidecars and `workflow-disk/` are
// transcripts, not journals) and C6's synthetic journals. Journals play once the replay stub lands (M2); in M1 the
// playable fixture is the seeded synthetic transcript.
import type { SessionEvent } from '@shared/graph/events';
import { synthesise } from '../../../../test/support/synth-transcript';

// Vite requires each glob's options as a literal.
const pass1 = import.meta.glob<string>(['../../../../spikes/protocol-probe/fixtures/*.jsonl', '!**/fixtures/private/**'], { query: '?raw', import: 'default' });
const pass2 = import.meta.glob<string>(['../../../../spikes/protocol-probe/fixtures/pass2/*.jsonl', '!**/fixtures/private/**'], { query: '?raw', import: 'default' });
const transcript = import.meta.glob<string>('../../../../test/fixtures/transcript/*.jsonl', { query: '?raw', import: 'default' });

export interface Fixture {
  name: string; // `pass1/<name>`, `pass2/<name>`, `transcript/<name>` or `synthetic/<turns>`
  playable: boolean;
}

export interface LoadedFixture {
  events: SessionEvent[];
  streamFrom: number | null; // seq of the first event the player streams; everything before it is released at load
}

const journals = (pass: string, modules: Record<string, unknown>) =>
  Object.keys(modules).map((path) => ({ name: `${pass}/${path.split('/').at(-1)!.replace(/\.jsonl$/, '')}`, playable: false }));

export const FIXTURES: Fixture[] = [
  { name: 'synthetic/500', playable: true },
  ...journals('pass1', pass1),
  ...journals('pass2', pass2),
  ...journals('transcript', transcript),
];

export function loadFixture(name: string): LoadedFixture {
  const synthetic = /^synthetic\/(\d+)$/.exec(name);
  if (!synthetic) throw new Error(`${name}: journals play once the replay stub lands (M2)`);
  const events = synthesise({ turns: Number(synthetic[1]), seed: 1, streamLast: true });
  // The streamed tail is the last answer's deltas: everything before its first delta is history.
  const last = events.findLast((event) => event.kind === 'assistant.block.delta');
  const first = events.find((event) => event.kind === 'assistant.block.delta' && last?.kind === 'assistant.block.delta' && event.apiMessageId === last.apiMessageId);
  return { events, streamFrom: first?.seq ?? null };
}
