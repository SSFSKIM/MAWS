// The added-line count of one new file, for `git.changesSince`'s `untracked` (UX wave U5b-2,
// docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, Interfaces §C and decision 15): read by the
// service through the boundary the files service reads by (../files/service.ts, its opening comment), open first and
// judge after, never check and then open:
//
// 1. the path is the repository's real root joined with the status's path, and nothing else names it;
// 2. it is opened read-only and non-blocking with no link on the way (./no-link.ts: `NO_LINK`; on Linux the ancestors
//    walked first and the opened descriptor confirmed). Where an open is not held to its path (`OPENS_CONFIRMED`
//    false) nothing is opened and the count is null;
// 3. an open refused for a link is not followed: the entry counts 1 only when an `lstat` says its last component is a
//    symbolic link (its diff is one line, the target's path), and its target is never opened; any other refusal is a
//    null count;
// 4. the type is judged on the descriptor: a regular file, else a null count;
// 5. the bytes are read from the descriptor, at most `cap + 1` of them whatever size the file had when it was opened:
//    a file that holds more has a null count. A NUL in the first 8,000 bytes read makes it binary with a null count;
//    otherwise the count is its lines as `git diff --numstat` counts an added file.
//
// No byte of the file leaves this function: it answers a count.

export interface AddedLines {
  insertions: number | null;
  binary: boolean;
  bytesRead: number; // what was read from the file, never more than the cap and one byte (the tests' witness)
}

// Test-only: awaited between the listing and the open, and between the open and the first read, so a test can replace
// the path or grow the file there. Not reachable from a command.
export interface CountHooks {
  beforeOpen?(path: string): Promise<void> | void;
  afterOpen?(path: string): Promise<void> | void;
}

const NOT_COUNTED: AddedLines = { insertions: null, binary: false, bytesRead: 0 };

// `realRoot` is the repository's top level as a realpath (an open with no link on the way refuses any other spelling);
// `path` is relative to it, as the status listed it.
export async function countAddedLines(_realRoot: string, _path: string, _capBytes: number, _hooks: CountHooks = {}): Promise<AddedLines> {
  throw new Error('not built yet');
}
