// X8 fixture loader: the protocol probe's journals (both passes) and the transcript-shaped JSONL beside them, validated
// on load so a conformance test never re-reads files or re-derives the row shape (C1 execution document, "Fixture loader").
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { parseTranscriptRecord, type TranscriptRecord } from '@shared/wire/transcript';

export const FIXTURE_DIR = join(__dirname, '../../spikes/protocol-probe/fixtures');
export const TEST_FIXTURE_DIR = join(__dirname, '../fixtures');

export type FixturePass = 'pass1' | 'pass2';

const PASS_DIR: Record<FixturePass, string> = { pass1: FIXTURE_DIR, pass2: join(FIXTURE_DIR, 'pass2') };

function readJsonl(file: string): unknown[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export function listJournals(pass: FixturePass): string[] {
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
