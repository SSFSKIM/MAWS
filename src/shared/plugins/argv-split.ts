// UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §A "The splitter"): a local
// command's Arguments, typed as one line, split into words the way a POSIX shell splits them, and nothing else a shell
// does: no variable, glob, tilde or command is expanded (the engine expands `${NAME}` itself when it loads the entry).
// Pure and zod-free: the window shows the split as the person types, and the entry carries it.

export type ArgvSplit = { ok: true; args: string[] } | { ok: false; problem: 'open-single-quote' | 'open-double-quote' | 'trailing-backslash' };

// Inside double quotes a backslash escapes only these; before any other character it stays, with that character.
const ESCAPED_IN_DOUBLE_QUOTES = new Set(['"', '\\', '$', '`']);

export function splitArgs(line: string): ArgvSplit {
  const args: string[] = [];
  let word = '';
  let inWord = false; // a quoted empty part ('' or "") makes a word as much as a character does
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      if (inWord) args.push(word);
      word = '';
      inWord = false;
      i += 1;
      continue;
    }
    inWord = true;
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) return { ok: false, problem: 'open-single-quote' };
      word += line.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      i += 1;
      for (;;) {
        if (i >= line.length) return { ok: false, problem: 'open-double-quote' };
        const d = line[i];
        if (d === '"') break;
        if (d === '\\' && i + 1 < line.length && ESCAPED_IN_DOUBLE_QUOTES.has(line[i + 1])) {
          word += line[i + 1];
          i += 2;
        } else {
          word += d;
          i += 1;
        }
      }
      i += 1; // the closing quote
    } else if (c === '\\') {
      if (i + 1 >= line.length) return { ok: false, problem: 'trailing-backslash' };
      word += line[i + 1];
      i += 2;
    } else {
      word += c;
      i += 1;
    }
  }
  if (inWord) args.push(word);
  return { ok: true, args };
}
