// The accessibility snapshot's cut (E4c execution document, Design §5; A-33 item 5): pure, so main cuts what Playwright's
// `ariaSnapshot({ mode: 'ai' })` returned and the tests run it over real pages. A snapshot within `maxChars` is returned
// whole. A larger one becomes an outline of the page's landmarks and top headings with their refs (so the model can
// root its next snapshot), the body cut at a line boundary, and a trailer saying what was omitted; the three together
// never exceed `maxChars`.
import { BROWSER_SNAPSHOT_MAX_CHARS_CEILING, BROWSER_SNAPSHOT_OUTLINE_MAX_LINES, LANDMARK_ROLES } from '../maws/browser';

// One `[ref=…]` mark; the group is the ref (`e12`, `f2e7`).
export const REF_PATTERN = /\[ref=([^\]]+)\]/;
const REFS = new RegExp(REF_PATTERN.source, 'g');

export const countRefs = (text: string): number => text.match(REFS)?.length ?? 0;

export const SNAPSHOT_OUTLINE_HEADER = '# outline (refs for root):';
const BODY_HEADER = '# snapshot:';
const trailerOf = (lines: number, refs: number) =>
  `… ${lines} more lines (${refs} refs) omitted; call again with root: <ref> for a subtree or raise maxChars (max ${BROWSER_SNAPSHOT_MAX_CHARS_CEILING})`;

const LANDMARKS: ReadonlySet<string> = new Set(LANDMARK_ROLES);

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// A node line's depth and its key: the line without its children's colon or its inline text (`- paragraph [ref=e7]:
// Some text` → `- paragraph [ref=e7]`). Playwright quotes a key that holds `: ` (`- 'link "a: b" [ref=e3]':`), so an
// unquoted key ends at its first `: ` or at a trailing colon.
function nodeOf(line: string): { depth: number; key: string; role: string } | null {
  const match = /^( *)- (.*)$/.exec(line);
  if (match === null) return null;
  const [, indent, rest] = match as unknown as [string, string, string];
  const quoted = /^'(?:[^']|'')*'|^"(?:[^"\\]|\\.)*"/.exec(rest)?.[0];
  const key = quoted ?? /^(.*?)(?::\s.*|:)?$/.exec(rest)![1]!;
  const role = /^['"]?([a-z][a-zA-Z-]*)/.exec(key)?.[1];
  return role === undefined ? null : { depth: indent.length / 2, key: `${indent}- ${key}`, role };
}

// The outline's lines in the order they are kept when room is short: landmarks first, then level-1 and level-2
// headings (both at any depth: real pages nest them, Decision Log 26), then the ref-bearing lines at depth 0 and 1.
function outlineCandidates(lines: readonly string[]): { index: number; line: string }[] {
  const ranked: { index: number; line: string; rank: number }[] = [];
  lines.forEach((line, index) => {
    const node = nodeOf(line);
    if (node === null) return;
    const hasRef = REF_PATTERN.test(node.key);
    const rank = LANDMARKS.has(node.role) ? 0 : node.role === 'heading' && /\[level=[12]\]/.test(node.key) ? 1 : hasRef && node.depth <= 1 ? 2 : null;
    if (rank !== null) ranked.push({ index, line: node.key, rank });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
}

const inPageOrder = (picked: { index: number; line: string }[]) => picked.sort((a, b) => a.index - b.index).map((entry) => entry.line);

// At most `maxLines` outline lines, in the page's order, each kept at its depth.
export function outlineOf(text: string, maxLines: number): string[] {
  return inPageOrder(outlineCandidates(splitLines(text)).slice(0, maxLines));
}

export interface SnapshotCut {
  text: string;
  truncated: boolean;
  chars: number; // of the whole snapshot, as are `lines` and `refs`
  lines: number;
  refs: number;
  omitted: { lines: number; refs: number } | null;
}

export function cutSnapshot(text: string, { maxChars }: { maxChars: number }): SnapshotCut {
  const all = splitLines(text);
  const whole = { chars: text.length, lines: all.length, refs: countRefs(text) };
  if (text.length <= maxChars) return { text, truncated: false, ...whole, omitted: null };

  // The outline takes at most half of the room, so a small maxChars still shows the top of the page.
  const outlineBudget = Math.floor(maxChars / 2);
  const picked: { index: number; line: string }[] = [];
  let outlineChars = SNAPSHOT_OUTLINE_HEADER.length;
  for (const candidate of outlineCandidates(all)) {
    if (picked.length === BROWSER_SNAPSHOT_OUTLINE_MAX_LINES) break;
    if (outlineChars + 1 + candidate.line.length > outlineBudget) continue;
    picked.push(candidate);
    outlineChars += 1 + candidate.line.length;
  }
  const head = picked.length === 0 ? BODY_HEADER : [SNAPSHOT_OUTLINE_HEADER, ...inPageOrder(picked), BODY_HEADER].join('\n');

  // The most body lines from the top whose text, with the head and the trailer for what remains, fits.
  const refsBefore = [0];
  const charsBefore = [0];
  all.forEach((line, i) => {
    refsBefore.push(refsBefore[i]! + countRefs(line));
    charsBefore.push(charsBefore[i]! + line.length + 1); // each kept line ends with its newline
  });
  for (let kept = all.length - 1; kept >= 0; kept -= 1) {
    const trailer = trailerOf(all.length - kept, whole.refs - refsBefore[kept]!);
    if (head.length + 1 + charsBefore[kept]! + trailer.length > maxChars) continue;
    const body = all.slice(0, kept).map((line) => `${line}\n`).join('');
    return { text: `${head}\n${body}${trailer}`, truncated: true, ...whole, omitted: { lines: all.length - kept, refs: whole.refs - refsBefore[kept]! } };
  }
  // Only a maxChars far under the schema's minimum (1000) leaves no room for the trailer beside half of itself.
  throw new RangeError(`cutSnapshot: maxChars ${maxChars} leaves no room for the trailer`);
}
