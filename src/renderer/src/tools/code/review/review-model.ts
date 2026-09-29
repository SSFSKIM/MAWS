// Review's pure model (C8c execution document, Interfaces *Tools, slots and the open-file seam* and *Review's data*):
// the scopes and their default, the `diffTab` ref grammar, C4's multi-file patch split per file in the shape
// `@git-diff-view/react` takes, the first changed line a hunk opens at, the size caps, and the file lists each scope
// shows (the git scopes from `git.diff` and `git.status`, Last turn from the receipt and C6's disclosure-independent
// activity). No I/O and no React here.
import type { GitDiffFile, GitStatus } from '@shared/ipc/schema/git';
import type { CellDetail, Row, TurnActivity, TurnId } from '../../../transcript';

export type ReviewScope = 'uncommitted' | 'branch' | 'turn' | 'staged';
export interface ReviewParams {
  scope?: ReviewScope;
  path?: string;
  turnId?: TurnId;
}

// C6's shapes, derived from its public surface (`transcript/index.ts` exports neither by name).
export type ChangedFile = Extract<Row, { kind: 'receipt' }>['files'][number];
export type Hunk = Extract<CellDetail, { kind: 'edit' }>['hunks'][number];

// 2,000 rather than 5,000 (R8: split mode past 500 ms beyond it, and where the library stops highlighting).
export const REVIEW_FILE_LINES_CAP = 2000;
export const REVIEW_FILE_BYTES_CAP = 1024 * 1024;
export const REVIEW_SCOPE_BYTES_CAP = 8 * 1024 * 1024;

// Dirty → Uncommitted; clean with This branch available → This branch; else Uncommitted.
export function defaultScope(status: GitStatus | null, branchAvailable: boolean): ReviewScope {
  if (status && !status.dirty && branchAvailable) return 'branch';
  return 'uncommitted';
}

// ---- the diffTab ref grammar: `ref := scope [' @ ' path]`, a TurnId (`turn:<uuid>`) being its own scope word --------

const SEPARATOR = ' @ ';
const SCOPE_WORDS: ReadonlySet<string> = new Set(['uncommitted', 'branch', 'staged']);

export function formatRef(scope: Exclude<ReviewScope, 'turn'> | TurnId, path?: string | null): string {
  return path ? `${scope}${SEPARATOR}${path}` : scope;
}

// Split on the first ' @ ', so a path may itself hold one; null for an unknown scope word or an empty path.
export function parseRef(ref: string): { scope: ReviewScope; turnId: TurnId | null; path: string | null } | null {
  const at = ref.indexOf(SEPARATOR);
  const word = at === -1 ? ref : ref.slice(0, at);
  const path = at === -1 ? null : ref.slice(at + SEPARATOR.length);
  if (path === '') return null;
  if (SCOPE_WORDS.has(word)) return { scope: word as ReviewScope, turnId: null, path };
  if (word.startsWith('turn:') && word.length > 'turn:'.length && !/\s/.test(word)) return { scope: 'turn', turnId: word as TurnId, path };
  return null;
}

// ---- splitting C4's patch -------------------------------------------------------------------------------------------

export interface PatchFile {
  path: string; // the new path (the old one for a deletion), repository-relative as git writes it
  oldPath: string | null; // a rename's source
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'binary';
  hunks: string[]; // the `@@` sections as text, each from its header to its last line
  header: string; // the block's lines before its first hunk
}

// git's C-style quoting (`core.quotePath`): a path holding a byte outside printable ASCII, a `"` or a `\` is written in
// double quotes with `\ooo` octal escapes of its UTF-8 bytes and `\a \b \t \n \v \f \r \" \\`.
const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
export function unquote(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 1; i < text.length - 1; i++) {
    const c = text[i];
    if (c !== '\\') {
      bytes.push(...encoder.encode(c));
      continue;
    }
    const next = text[++i];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(text.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// One quoted path token at the start of `text`, with what follows it; null when `text` does not start with a quote.
function takeQuoted(text: string): { path: string; rest: string } | null {
  if (!text.startsWith('"')) return null;
  let i = 1;
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
  return { path: unquote(text.slice(0, i + 1)), rest: text.slice(i + 2) };
}

const stripPrefix = (path: string): string | null => (path === '/dev/null' ? null : path.replace(/^[ab]\//, ''));

// `diff --git a/<old> b/<new>`: quoted tokens are unambiguous; unquoted ones holding spaces are ambiguous in general,
// but git writes the halves equal unless a rename or copy follows (whose `rename from`/`rename to` lines win), so the
// equal-halves reading is tried first.
function headerPaths(line: string): { oldPath: string | null; newPath: string | null } {
  const rest = line.slice('diff --git '.length);
  const first = takeQuoted(rest);
  if (first) {
    const second = takeQuoted(first.rest)?.path ?? first.rest;
    return { oldPath: stripPrefix(first.path), newPath: stripPrefix(second) };
  }
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === ' ' && rest.slice(2, half) === rest.slice(half + 3)) return { oldPath: rest.slice(2, half), newPath: rest.slice(2, half) };
  const cut = rest.indexOf(' b/');
  if (cut === -1) return { oldPath: null, newPath: null };
  const second = rest.slice(cut + 1);
  return { oldPath: stripPrefix(rest.slice(0, cut)), newPath: stripPrefix(takeQuoted(second)?.path ?? second) };
}

export function splitPatch(patch: string): PatchFile[] {
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const blocks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('diff --git ')) blocks.push([line]);
    else blocks.at(-1)?.push(line);
  }
  return blocks.map((block) => {
    let { oldPath, newPath } = headerPaths(block[0]);
    let kind: PatchFile['kind'] = 'modified';
    const hunks: string[][] = [];
    const header: string[] = [];
    for (const line of block) {
      if (line.startsWith('@@')) hunks.push([line]);
      else if (hunks.length > 0) hunks.at(-1)!.push(line);
      else {
        header.push(line);
        if (line.startsWith('new file mode')) kind = 'added';
        else if (line.startsWith('deleted file mode')) kind = 'deleted';
        else if (line.startsWith('rename from ')) {
          oldPath = unquote(line.slice('rename from '.length));
          kind = 'renamed';
        } else if (line.startsWith('rename to ')) newPath = unquote(line.slice('rename to '.length));
        else if (line.startsWith('--- ')) oldPath = stripPrefix(unquote(line.slice(4))) ?? oldPath;
        else if (line.startsWith('+++ ')) newPath = stripPrefix(unquote(line.slice(4))) ?? newPath;
      }
    }
    if (header.some((line) => line.startsWith('Binary files ') || line === 'GIT binary patch')) kind = 'binary';
    const path = kind === 'deleted' ? (oldPath ?? newPath ?? '') : (newPath ?? oldPath ?? '');
    return { path, oldPath: kind === 'renamed' ? oldPath : null, kind, hunks: hunks.map((hunk) => hunk.join('\n')), header: header.join('\n') };
  });
}

// ---- hunks ----------------------------------------------------------------------------------------------------------

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// The new file's line of the hunk's first added line; a pure deletion opens at its new start (at least line 1).
export function firstChangedLine(hunk: string): number {
  const lines = hunk.split('\n');
  const match = HUNK_HEADER.exec(lines[0]);
  if (!match) return 1;
  const newStart = Number(match[3]);
  let line = newStart;
  for (const text of lines.slice(1)) {
    if (text.startsWith('+')) return Math.max(1, line);
    if (text.startsWith(' ')) line += 1;
  }
  return Math.max(1, newStart);
}

// The line a hunk's first row shows, which the diff body scrolls to: the new file's for a context or added first line,
// the old file's for a removed one (the library draws a header row only where a gap precedes the hunk).
export function hunkAnchor(hunk: string): { side: 'old' | 'new'; line: number } {
  const lines = hunk.split('\n');
  const match = HUNK_HEADER.exec(lines[0]);
  if (!match) return { side: 'new', line: 1 };
  const first = lines.slice(1).find((text) => text.startsWith('+') || text.startsWith('-') || text.startsWith(' '));
  return first?.startsWith('-') ? { side: 'old', line: Number(match[1]) } : { side: 'new', line: Number(match[3]) };
}

// A changed line is a hunk body line beginning `+` or `-`.
function changedLines(file: { hunks: readonly string[] }): number {
  let count = 0;
  for (const hunk of file.hunks) {
    const lines = hunk.split('\n');
    for (let i = 1; i < lines.length; i++) if (lines[i].startsWith('+') || lines[i].startsWith('-')) count += 1;
  }
  return count;
}

export function tooLarge(file: { hunks: readonly string[] }): boolean {
  if (changedLines(file) > REVIEW_FILE_LINES_CAP) return true;
  let bytes = 0;
  for (const hunk of file.hunks) bytes += hunk.length + 1;
  return bytes > REVIEW_FILE_BYTES_CAP;
}

// C6's `Hunk` (the engine's structuredPatch) as the `@@` text git would print; a pure addition keeps the engine's
// `-1,0` where git writes `-0,0` (both parse). A line with no diff prefix is a context line, whole, as C6's edit detail
// reads it (M4: the diff view's parser ends a hunk at such a line and throws on the empty hunk it leaves).
const DIFF_PREFIXES = new Set([' ', '+', '-', '\\']);
export function hunkText(hunk: Hunk): string {
  const lines = hunk.lines.map((line) => (DIFF_PREFIXES.has(line[0]) ? line : ` ${line}`));
  return [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...lines].join('\n');
}

// What `DiffView` is fed for one file (R8): each `hunks` entry is parsed as a whole unified diff, so one string with a
// file header, every `@@` section and a trailing newline.
export function diffViewHunks(file: { path: string; oldPath: string | null; hunks: readonly string[] }): string[] {
  return [`--- a/${file.oldPath ?? file.path}\n+++ b/${file.path}\n${file.hunks.join('\n')}\n`];
}

// A cheap signature of a file's hunks (FNV-1a over the text), so a viewed mark can tell the hunks changed since.
export function hunksSignature(hunks: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const hunk of hunks) {
    for (let i = 0; i < hunk.length; i++) {
      hash ^= hunk.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 10;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${hunks.length}:${(hash >>> 0).toString(16)}`;
}

// ---- the files a scope shows ----------------------------------------------------------------------------------------

export type ReviewFileKind = PatchFile['kind'] | 'untracked';

export interface ReviewFile {
  path: string; // the file's identity in its scope: repository-relative for the git scopes, absolute for Last turn
  oldPath: string | null;
  openPath: string | null; // what `Open file ↗` opens (absolute); null for a deleted file
  kind: ReviewFileKind;
  added: number;
  removed: number;
  hunks: string[] | null; // null: none to show (untracked, binary), or not fetched yet (a scope past its cap)
  blocks: number[]; // how many of `hunks` each diff block holds, in order: one block for a git scope's file, one per edit for Last turn
  header: string | null; // the patch block's lines before its hunks (what a binary's viewed mark signs)
}

const joinPath = (root: string, path: string): string => (path.startsWith('/') ? path : `${root.replace(/\/+$/, '')}/${path}`);

// The git scopes: one row per `git.diff` file, with its hunks from the split patch when the scope was within its cap
// (`patch` null otherwise, each file fetched on selection); Uncommitted adds the untracked files from the status.
export function gitScopeFiles(input: {
  scope: Exclude<ReviewScope, 'turn'>;
  repoRoot: string;
  files: readonly GitDiffFile[];
  patch: ReadonlyMap<string, PatchFile> | null;
  status: GitStatus | null;
}): ReviewFile[] {
  const rows: ReviewFile[] = input.files.map((file) => {
    const split = input.patch?.get(file.path);
    const kind: ReviewFileKind = file.binary ? 'binary' : (split?.kind ?? (file.oldPath ? 'renamed' : 'modified'));
    return {
      path: file.path,
      oldPath: file.oldPath ?? split?.oldPath ?? null,
      openPath: kind === 'deleted' ? null : joinPath(input.repoRoot, file.path),
      kind,
      added: file.binary ? 0 : file.insertions,
      removed: file.binary ? 0 : file.deletions,
      hunks: kind === 'binary' ? null : input.patch ? (split?.hunks ?? []) : null,
      blocks: kind !== 'binary' && split && split.hunks.length > 0 ? [split.hunks.length] : [],
      header: split?.header ?? null,
    };
  });
  if (input.scope === 'uncommitted' && input.status) {
    const listed = new Set(rows.map((row) => row.path));
    for (const entry of input.status.files) {
      if (!entry.untracked || listed.has(entry.path)) continue;
      rows.push({ path: entry.path, oldPath: null, openPath: joinPath(input.repoRoot, entry.path), kind: 'untracked', added: 0, removed: 0, hunks: null, blocks: [], header: null });
    }
  }
  return rows;
}

const RECEIPT_KIND: Record<ChangedFile['change'], ReviewFileKind> = { create: 'added', update: 'modified', delete: 'deleted' };

// Last turn: the receipt's files, counts and kinds; each file's hunks from the turn's `edited` activity entries joined
// on the edit's own `filePath` (as the receipt reads it), one block per edit in their order, since each edit's hunks
// are numbered against the file as that edit found it (amended 2026-09-29, M3 review).
export function turnScopeFiles(receipt: readonly ChangedFile[], activity: TurnActivity | null): ReviewFile[] {
  const edits = new Map<string, string[][]>();
  for (const entry of activity?.files ?? []) {
    if (entry.use !== 'edited' || !entry.edit || entry.edit.hunks.length === 0) continue;
    const list = edits.get(entry.edit.filePath) ?? [];
    list.push(entry.edit.hunks.map(hunkText));
    edits.set(entry.edit.filePath, list);
  }
  return receipt.map((file) => {
    const kind = RECEIPT_KIND[file.change];
    const blocks = edits.get(file.path) ?? [];
    return {
      path: file.path,
      oldPath: null,
      openPath: kind === 'deleted' ? null : file.path,
      kind,
      added: file.added,
      removed: file.removed,
      hunks: blocks.flat(),
      blocks: blocks.map((block) => block.length),
      header: null,
    };
  });
}

// `hunks` cut into its blocks.
export function blocksOf(hunks: readonly string[], sizes: readonly number[]): string[][] {
  const out: string[][] = [];
  let at = 0;
  for (const size of sizes) {
    out.push(hunks.slice(at, at + size));
    at += size;
  }
  return out;
}

// What a viewed mark signs: a binary's header (its `index` line names both blobs), else the hunks drawn.
export const viewedSignature = (file: Pick<ReviewFile, 'kind' | 'header'>, hunks: readonly string[] | null): string =>
  hunksSignature(file.kind === 'binary' ? [file.header ?? ''] : (hunks ?? []));

// The receipt row of a turn in a transcript's rows.
export function receiptOf(rows: readonly Row[], turnId: TurnId): Extract<Row, { kind: 'receipt' }> | null {
  const row = rows.find((candidate) => candidate.kind === 'receipt' && candidate.turnId === turnId);
  return row?.kind === 'receipt' ? row : null;
}

export function totals(files: readonly ReviewFile[]): { files: number; added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    added += file.added;
    removed += file.removed;
  }
  return { files: files.length, added, removed };
}

// The Staged chip shows while any tracked entry's index differs from HEAD (porcelain v2's X, `.` for unchanged).
export const indexDiffers = (status: GitStatus | null): boolean => status?.files.some((file) => !file.untracked && file.index !== '.') ?? false;
