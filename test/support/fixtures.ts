// X8 fixture loader: the protocol probe's journals (both passes) and the transcript-shaped JSONL beside them, validated
// on load so a conformance test never re-reads files or re-derives the row shape (C1 execution document, "Fixture loader").
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events'; // [C6]
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { parseTranscriptRecord, type TranscriptRecord } from '@shared/wire/transcript';

export const FIXTURE_DIR = join(__dirname, '../../spikes/protocol-probe/fixtures');
export const TEST_FIXTURE_DIR = join(__dirname, '../fixtures');

// C3 start: pass 3 holds the journals C3's live acceptance records (M6); empty until then, so `listJournals('pass3')`
// lists nothing and the conformance suite gains cases as files land.
export type FixturePass = 'pass1' | 'pass2' | 'pass3';

const PASS_DIR: Record<FixturePass, string> = { pass1: FIXTURE_DIR, pass2: join(FIXTURE_DIR, 'pass2'), pass3: join(FIXTURE_DIR, 'pass3') };
export const FIXTURE_PASSES: readonly FixturePass[] = ['pass1', 'pass2', 'pass3'];

// A synthetic engine journal under test/fixtures/engine (the replay handshake prelude, the unanswered read), X8-validated.
export function loadEngineJournal(name: string): JournalRow[] {
  return readJsonl(join(TEST_FIXTURE_DIR, 'engine', `${name}.jsonl`)).map(parseJournalRow);
}
// C3 end

function readJsonl(file: string): unknown[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export function listJournals(pass: FixturePass): string[] {
  if (!existsSync(PASS_DIR[pass])) return []; // C3: pass 3 is empty until M6 records it
  return readdirSync(PASS_DIR[pass])
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => basename(name, '.jsonl'))
    .sort();
}

export function loadJournal(pass: FixturePass, name: string): JournalRow[] {
  return readJsonl(join(PASS_DIR[pass], `${name}.jsonl`)).map(parseJournalRow);
}

export function framesOf(rows: JournalRow[], direction: 'in' | 'out'): { seq: number; frame: unknown }[] {
  return rows.filter((row) => row.direction === direction).map(({ seq, frame }) => ({ seq, frame }));
}

// Relative to FIXTURE_DIR: the sidecar transcripts of pass 1 and the workflow's on-disk journal of pass 2.
export function listTranscripts(): string[] {
  const sidecars = readdirSync(join(FIXTURE_DIR, 'subagent-sidecars'))
    .filter((name) => /^agent-.*\.jsonl$/.test(name))
    .sort()
    .map((name) => `subagent-sidecars/${name}`);
  return [...sidecars, 'pass2/workflow-disk/journal.jsonl'];
}

export function loadTranscript(relPath: string): TranscriptRecord[] {
  return readJsonl(join(FIXTURE_DIR, relPath)).map(parseTranscriptRecord);
}

export function loadSyntheticTranscript(name: string): TranscriptRecord[] {
  return readJsonl(join(TEST_FIXTURE_DIR, `${name}.jsonl`)).map(parseTranscriptRecord);
}

// The `records` of the `meta` row `{event: 'jsonl_snapshot', label}`; throws when the journal has no such row.
export function snapshotRecords(rows: JournalRow[], label: string): TranscriptRecord[] {
  const row = rows.find((candidate) => {
    if (candidate.direction !== 'meta') return false;
    const frame = candidate.frame as { event?: unknown; label?: unknown } | null;
    return frame?.event === 'jsonl_snapshot' && frame.label === label;
  });
  if (!row) throw new Error(`no jsonl_snapshot row labelled ${JSON.stringify(label)}`);
  const { records } = row.frame as { records: unknown[] };
  return records.map(parseTranscriptRecord);
}

// C4's transcript fixtures: test/fixtures/transcripts/<name>.jsonl, copies of real store transcripts (rewind-real,
// subagent-parent) and one synthetic torn tail; parsed with parseTranscriptRecord, unparseable lines skipped as the
// engine's reader skips them (SPEC 35.3.1), so the torn-tail fixture loads to its eleven whole records.
export const TRANSCRIPT_FIXTURE_DIR = join(TEST_FIXTURE_DIR, 'transcripts');

export function loadTranscriptFixture(name: string): TranscriptRecord[] {
  const records: TranscriptRecord[] = [];
  for (const raw of readFileSync(join(TRANSCRIPT_FIXTURE_DIR, `${name}.jsonl`), 'utf8').split('\n')) {
    const line = raw.replace(/^\0+/, '');
    if (line.length === 0) continue;
    try {
      records.push(parseTranscriptRecord(JSON.parse(line)));
    } catch {
      continue;
    }
  }
  return records;
}

// ---------------------------------------------------------------------------------------------------------------------
// [C6] Synthetic transcript fixtures (C6 execution document, "Replay stub, synthetic fixtures and harness"): journals
// in X8 row format under test/fixtures/transcript/ and X1 event lists under test/fixtures/transcript/events/
// (C4's TRANSCRIPT_FIXTURE_DIR above is test/fixtures/transcripts/, a different directory).

export const SYNTHETIC_TRANSCRIPT_DIR = join(TEST_FIXTURE_DIR, 'transcript');

export function listSyntheticJournals(): string[] {
  return readdirSync(SYNTHETIC_TRANSCRIPT_DIR)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => basename(name, '.jsonl'))
    .sort();
}

export function loadSyntheticJournal(name: string): JournalRow[] {
  return readJsonl(join(SYNTHETIC_TRANSCRIPT_DIR, `${name}.jsonl`)).map(parseJournalRow);
}

export function listEventFixtures(): string[] {
  return readdirSync(join(SYNTHETIC_TRANSCRIPT_DIR, 'events'))
    .filter((name) => name.endsWith('.events.jsonl'))
    .map((name) => basename(name, '.events.jsonl'))
    .sort();
}

// X1 events, validated on load.
export function loadEventFixture(name: string): SessionEvent[] {
  return readJsonl(join(SYNTHETIC_TRANSCRIPT_DIR, 'events', `${name}.events.jsonl`)).map((row) => SessionEventSchema.parse(row));
}
// [/C6]
