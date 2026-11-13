// The session's working folder (UX wave U8, contract UC-4): the checkout the agent is working in now, the one answer that
// Review, Source control, the terminal, the card, the composer, uploads and the endpoint read, so that they follow the
// agent together. No file reads the session's folder except through this selector (test/one-working-folder.test.ts).
// First landing: the answer is the folder the record names, so `path`, `cwd` and `launch` are equal and `moved` is false
// for every record; the live signal that follows the agent into a worktree is U8's second landing. Imports nothing but
// the record's type: the renderer, main, the daemon, the services and the endpoint all bundle it.
import type { SessionRecord } from '../graph/session';

export interface WorkingFolder {
  path: string; // the checkout the agent is working in now
  cwd: string; // the agent's folder inside it
  launch: string; // the folder the session's record names: its worktree's root when it has one, else its directory
  moved: boolean; // path !== launch
}

// Validates nothing: a record whose directory is '' answers '' (the index writes that when it knows none). A field read
// later must stay optional in this Pick, as the files allowlist's record (src/services/files/allowlist.ts) passes here.
export function workingFolder(record: Pick<SessionRecord, 'directory' | 'worktree'>): WorkingFolder {
  const launch = record.worktree?.path ?? record.directory;
  return { path: launch, cwd: launch, launch, moved: false };
}
