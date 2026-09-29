// The transcript source of a replay (X8; C4 execution document, "Replay engine"): a transcript JSONL read whole before
// anything plays. Lines are parsed as the engine's reader parses them (leading NULs stripped, an unparseable line
// skipped, SPEC 35.3.1); the source must hold at least one uuid-bearing record. What plays is the chain, paced by
// record timestamp, so the chain's length is the run's total.
import { currentChain, parseTranscriptRecord, type TranscriptRecord } from '@shared/wire/transcript';
import { readSourceLines, type SourceReader } from './journal-source';

export interface LoadedTranscript {
  records: TranscriptRecord[];
  totalRows: number; // chain records
  spanMs: number; // from the first to the last chain timestamp
}

export async function loadTranscriptSource(path: string, read?: SourceReader): Promise<LoadedTranscript> {
  const records: TranscriptRecord[] = [];
  for (const { text } of await readSourceLines(path, read)) {
    try {
      records.push(parseTranscriptRecord(JSON.parse(text.replace(/^\0+/, ''))));
    } catch {
      continue;
    }
  }
  if (!records.some((record) => typeof record.uuid === 'string')) throw new Error(`replay source is not a transcript: ${path}`);
  const chain = currentChain(records).chain;
  const times = chain.map((record) => (typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN)).filter((ms) => !Number.isNaN(ms));
  return { records, totalRows: chain.length, spanMs: times.length === 0 ? 0 : times[times.length - 1] - times[0] };
}
