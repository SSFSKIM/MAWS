// Live text only: a table in progress is held back until it is one. Streamdown's incomplete-markdown repair does not hold
// a table, so its header row would show as raw pipe text until the delimiter row completes. A trailing run of lines
// that open with `|` (outside a code fence) is left out of the rendered text while it is a header alone, or a header and
// a delimiter row still arriving; once a line follows the delimiter row it renders as the table. A run whose second line
// is no delimiter row is text, and renders as it arrives.

const PIPE_LINE = /^ {0,3}\|/;
const DELIMITER_ROW = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
// A delimiter row still arriving: nothing but pipes, colons, dashes and spaces so far (`|`, `| :`, `| --- | :`).
const DELIMITER_SO_FAR = /^ {0,3}\|?[\s:|-]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function holdBackTable(markdown: string): string {
  const lines = markdown.split('\n');
  const endsWithNewline = lines.at(-1) === '';
  if (endsWithNewline) lines.pop();
  let start = lines.length;
  while (start > 0 && PIPE_LINE.test(lines[start - 1])) start -= 1;
  const run = lines.length - start;
  if (run === 0 || insideFence(lines, start)) return markdown;
  const arriving = run === 2 && !endsWithNewline; // the delimiter row is the last line, still arriving
  if (run >= 2 && !(arriving ? DELIMITER_SO_FAR : DELIMITER_ROW).test(lines[start + 1])) return markdown; // not a table
  if (run >= 3 || (run === 2 && endsWithNewline)) return markdown; // the delimiter row is complete
  return lines.slice(0, start).join('\n');
}

// Whether line `at` falls inside a fenced code block opened above it.
function insideFence(lines: string[], at: number): boolean {
  let open: string | null = null;
  for (const line of lines.slice(0, at)) {
    const fence = FENCE.exec(line)?.[1];
    if (!fence) continue;
    if (open === null) open = fence;
    else if (fence[0] === open[0] && fence.length >= open.length && line.trim() === fence) open = null;
  }
  return open !== null;
}
