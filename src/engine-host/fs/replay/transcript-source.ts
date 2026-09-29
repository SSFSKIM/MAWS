// The transcript source of a replay (X8; C4 execution document, "Replay engine"): a transcript JSONL read whole before
// anything plays. Lines are parsed as the engine's reader parses them (leading NULs stripped, an unparseable line
// skipped, SPEC 35.3.1); the source must hold at least one uuid-bearing record. What plays is the chain, paced by
// record timestamp, so the chain's length is the run's total. A transcript with a sibling `<sessionId>/subagents/`
// directory (the store's layout, SPEC 35.10) has its child agents listed by the FS service's own reader, so its
// `Agent` tool uses replay as subagent.started/finished exactly as its backfill maps them.
import { basename, dirname, join } from 'node:path';
import { currentChain, parseTranscriptRecord, type TranscriptRecord } from '@shared/wire/transcript';
import type { SubagentLookup } from '../backfill';
import { SubagentReader, subagentLookup } from '../subagents';
import { readSourceLines, type SourceReader } from './journal-source';

export interface LoadedTranscript {
  records: TranscriptRecord[];
  subagents: SubagentLookup | null; // null when no agent is listed beside the transcript
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
  return { records, subagents: await siblingSubagents(path, records), totalRows: chain.length, spanMs: times.length === 0 ? 0 : times[times.length - 1] - times[0] };
}

// The session's directory beside its transcript: named by the session id the records carry (a store transcript's file
// stem is the same id; a fixture copy may be named otherwise), else by the file stem.
async function siblingSubagents(path: string, records: TranscriptRecord[]): Promise<SubagentLookup | null> {
  const sessionId = records.map((record) => record.sessionId).find((id): id is string => typeof id === 'string' && id.length > 0) ?? basename(path, '.jsonl');
  const reader = new SubagentReader();
  const agents = await reader.list(join(dirname(path), sessionId));
  return agents.length === 0 ? null : subagentLookup(() => agents, reader);
}
