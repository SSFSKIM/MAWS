// The record line's focus hand-off (UX wave U2b, M1 decision (j)): a press asks focus for the other line of its
// stretch, in the transcript it was pressed in (its scope: the mount's id prefix), and that line takes it as it is
// drawn. The request is taken once and lapses at the next frame: a line the list did not draw in the press's own
// update (virtualised away) is not handed focus when it mounts later. A request may name several lines, the ids that
// line can be drawn under (a closed line carries its stretch's first key, which regrouping or a page may have moved
// since the reader opened it); the first of them drawn takes it.
const asked = new Map<string, { lines: readonly string[] }>();

export function handFocus(scope: string, lines: string | readonly string[]): void {
  const request = { lines: typeof lines === 'string' ? [lines] : lines };
  asked.set(scope, request);
  requestAnimationFrame(() => {
    if (asked.get(scope) === request) asked.delete(scope);
  });
}

// Whether this line, drawn in this transcript, is the one a press there asked focus for (and takes the request).
export function takesFocus(scope: string, line: string): boolean {
  if (asked.get(scope)?.lines.includes(line) !== true) return false;
  asked.delete(scope);
  return true;
}
