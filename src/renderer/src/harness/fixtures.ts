// The harness's fixture catalogue. Journals are bundled lazily as raw text (harness builds only): the probe's pass-1
// root journals and pass-2 journals (never the gitignored `private/` owner data; sidecars and `workflow-disk/` are
// transcripts, not journals) and C6's synthetic journals, played through the replay stub; C6's X1 event fixtures
// (`events/<name>`) for shapes C3 has not fixed on the wire; and the seeded synthetic transcript (`synthetic/<turns>`).
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { parseJournalRow } from '@shared/wire/journal';
import { synthesise } from '../../../../test/support/synth-transcript';
import { journalToEvents } from '../transcript/dev/replay-stub';

// Vite requires each glob's options as a literal.
const pass1 = import.meta.glob<string>(['../../../../spikes/protocol-probe/fixtures/*.jsonl', '!**/fixtures/private/**'], { query: '?raw', import: 'default' });
const pass2 = import.meta.glob<string>(['../../../../spikes/protocol-probe/fixtures/pass2/*.jsonl', '!**/fixtures/private/**'], { query: '?raw', import: 'default' });
const transcript = import.meta.glob<string>('../../../../test/fixtures/transcript/*.jsonl', { query: '?raw', import: 'default' });
const events = import.meta.glob<string>('../../../../test/fixtures/transcript/events/*.events.jsonl', { query: '?raw', import: 'default' });

export interface LoadedFixture {
  events: SessionEvent[];
  streamFrom: number | null; // seq of the first event the player streams; everything before it is released at load
}

type Loader = () => Promise<LoadedFixture>;

const lines = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);

const baseName = (path: string, suffix: RegExp) => path.split('/').at(-1)!.replace(suffix, '');

function journals(pass: string, modules: Record<string, () => Promise<string>>): [string, Loader][] {
  return Object.entries(modules).map(([path, load]) => [
    `${pass}/${baseName(path, /\.jsonl$/)}`,
    async () => ({ events: journalToEvents(lines(await load()).map(parseJournalRow)), streamFrom: null }),
  ]);
}

const eventFixtures: [string, Loader][] = Object.entries(events).map(([path, load]) => [
  `events/${baseName(path, /\.events\.jsonl$/)}`,
  async () => ({ events: lines(await load()).map((row) => SessionEventSchema.parse(row)), streamFrom: null }),
]);

// The synthetic transcript streams its last answer: everything before that answer's first delta is history.
function synthetic(turns: number): LoadedFixture {
  const all = synthesise({ turns, seed: 1, streamLast: true });
  const last = all.findLast((event) => event.kind === 'assistant.block.delta');
  const first = all.find((event) => event.kind === 'assistant.block.delta' && last?.kind === 'assistant.block.delta' && event.apiMessageId === last.apiMessageId);
  return { events: all, streamFrom: first?.seq ?? null };
}

const LOADERS = new Map<string, Loader>([
  ['synthetic/500', () => Promise.resolve(synthetic(500))],
  ...journals('pass1', pass1),
  ...journals('pass2', pass2),
  ...journals('transcript', transcript),
  ...eventFixtures,
]);

export const FIXTURES: string[] = [...LOADERS.keys()];

export function loadFixture(name: string): Promise<LoadedFixture> {
  const turns = /^synthetic\/(\d+)$/.exec(name)?.[1];
  const loader = LOADERS.get(name) ?? (turns ? () => Promise.resolve(synthetic(Number(turns))) : null);
  return loader ? loader() : Promise.reject(new Error(`unknown fixture ${name}`));
}
