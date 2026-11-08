// `deployment admin`'s table layout (P5 O14 M2). What it reads of the org's machines (the served certificates judged
// against the head, a name resolved to what holds it, and `show`'s machines rows) lives in the protocol package
// (`org-protocol`'s machines.ts, P5 O8 M4b), where the app's Org page reads it too.

/** Rows as columns padded to their widths, a header first; the last column unpadded. */
export function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  return [header, ...rows].map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]))).join('  '));
}
