// The lines a terminal's screen shows as they were written (UX wave U8b, Addendum 5): each soft-wrapped row joined to the
// row it continues, as the rows read. A row's text is the buffer's (`translateToString(true)`), which keeps every cell
// that was written, a space at the wrap included, and drops only cells never written. So nothing is padded in: a wide
// character takes two cells but is one character, so no count of columns says how long a row's text is.
export function logicalLines(rows: { screen: readonly string[]; wrapped: readonly boolean[] }): string[] {
  const joined: string[] = [];
  rows.screen.forEach((line, row) => {
    if (rows.wrapped[row] && joined.length > 0) joined[joined.length - 1] += line;
    else joined.push(line);
  });
  return joined;
}
