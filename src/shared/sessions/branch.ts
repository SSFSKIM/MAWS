// W9 (H2; waves plan §2 H): `HEAD` and the empty string are not branch names. The engine records
// `"gitBranch":"HEAD"` for a folder that is no repository and for a detached checkout alike
// (test/fixtures/transcripts/rewind-terminal.jsonl), so the value names nothing a reader could show. Ingestion (the
// summarizer, the chain follower) and the index store null in its place; whether a checkout is detached is git's answer
// to give (`GitStatus.branch === null`), never the transcript's.
export function branchName(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' || value === 'HEAD' ? null : value;
}
