// One ordered record per Electron launch: every line carries a sequence number from one counter, so the listener's
// decisions and the handler's entries interleave in the order they ran (both run on main's one thread). Written to
// stdout as `REC {json}` lines and kept in memory for the suite's verdicts.
let seq = 0;
export const records = [];
export function log(end, fields) {
  const line = { seq: ++seq, end, at: Date.now(), ...fields };
  records.push(line);
  process.stdout.write(`REC ${JSON.stringify(line)}\n`);
  return line;
}
export function result(row, part, status, observed, extra = {}) {
  process.stdout.write(`RESULT ${JSON.stringify({ row, part, status, observed, ...extra })}\n`);
}
