// The harness's fixture catalogue. Journals are bundled lazily as raw text (harness builds only): the probe's pass-1
// root journals, pass-2 and pass-3 journals (never the gitignored `private/` owner data; sidecars and `workflow-disk/`
// are transcripts, not journals) and C6's synthetic journals, played through C3's normaliser; C6's X1 event fixtures
// (`events/<name>`) for shapes C3 has not fixed on the wire; and the seeded synthetic transcript (`synthetic/<turns>`),
// also in the to-human view (`synthetic/<turns>/report`, which the picker does not list).
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { ApiMessageId } from '@shared/graph/ids';
import { parseJournalRow } from '@shared/wire/journal';
import { synthesise } from '../../../../test/support/synth-transcript';
import { journalToEvents } from '../transcript/dev/journal';
import { QUESTIONS_FIXTURE, questionsFixture } from './questions'; // UX wave U1b

// Vite requires each glob's options as a literal.
const pass1 = import.meta.glob<string>(['../../../../spikes/protocol-probe/fixtures/*.jsonl', '!**/fixtures/private/**'], { query: '?raw', import: 'default' });
const pass2 = import.meta.glob<string>(['../../../../spikes/protocol-probe/fixtures/pass2/*.jsonl', '!**/fixtures/private/**'], { query: '?raw', import: 'default' });
const pass3 = import.meta.glob<string>(['../../../../spikes/protocol-probe/fixtures/pass3/*.jsonl', '!**/fixtures/private/**'], { query: '?raw', import: 'default' });
const summaries = import.meta.glob<string>('../../../../spikes/protocol-probe/fixtures/p4/p4-tool-summaries-*.jsonl', { query: '?raw', import: 'default' });
const transcript = import.meta.glob<string>('../../../../test/fixtures/transcript/*.jsonl', { query: '?raw', import: 'default' });
const events = import.meta.glob<string>('../../../../test/fixtures/transcript/events/*.events.jsonl', { query: '?raw', import: 'default' });

export interface LoadedFixture {
  events: SessionEvent[];
  streamFrom: number | null; // seq of the first event the player streams; everything before it is released at load
  ownerLane?: true; // the session's to-human lane is on (`synthetic/<turns>/report`)
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

// The synthetic transcript in the to-human view (UX wave U2b, M3's scenes; `synthetic/<turns>/report`): the lane on,
// and each turn's final answer a message to the person, its first delta opening the mark so the streamed answer is one
// while it streams. Its commentary, thoughts and runs are the record, folded into stretches between the messages.
function report({ events, streamFrom }: LoadedFixture): LoadedFixture {
  const finals = new Set<ApiMessageId>();
  let answer: ApiMessageId | null = null;
  for (const event of events) {
    if (event.agentId !== null) continue;
    if (event.kind === 'turn.started') answer = null;
    if (event.kind === 'assistant.block.complete' && event.block.type === 'text') answer = event.apiMessageId;
    if (event.kind === 'turn.ended' && answer !== null) finals.add(answer);
  }
  const opened = new Set<ApiMessageId>();
  const marked = events.map((event): SessionEvent => {
    if (event.agentId !== null) return event;
    const api = event.kind === 'assistant.block.delta' ? event.apiMessageId : null;
    if (event.kind === 'assistant.block.delta' && event.textDelta !== null && api !== null && finals.has(api) && !opened.has(api)) {
      opened.add(api);
      return { ...event, textDelta: `<message>\n${event.textDelta}` };
    }
    if (event.kind === 'assistant.block.complete' && event.block.type === 'text' && finals.has(event.apiMessageId)) return { ...event, block: { ...event.block, text: `<message>\n${event.block.text}\n</message>` } };
    return event;
  });
  return { events: marked, streamFrom, ownerLane: true };
}

const LOADERS = new Map<string, Loader>([
  ['synthetic/500', () => Promise.resolve(synthetic(500))],
  [QUESTIONS_FIXTURE, () => Promise.resolve(questionsFixture())], // UX wave U1b: a long transcript with question calls in it
  ...journals('pass1', pass1),
  ...journals('pass2', pass2),
  ...journals('pass3', pass3),
  ...journals('transcript', transcript),
  ...journals('p4', summaries),
  ...eventFixtures,
]);

export const FIXTURES: string[] = [...LOADERS.keys()];

export function loadFixture(name: string): Promise<LoadedFixture> {
  const [, turns, view] = /^synthetic\/(\d+)(\/report)?$/.exec(name) ?? [];
  const loader = LOADERS.get(name) ?? (turns ? () => Promise.resolve(view ? report(synthetic(Number(turns))) : synthetic(Number(turns))) : null);
  return loader ? loader() : Promise.reject(new Error(`unknown fixture ${name}`));
}
