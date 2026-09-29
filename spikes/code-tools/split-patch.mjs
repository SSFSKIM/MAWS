// R8's prototype of `splitPatch` (C8c execution document, Interfaces, review/review-model.ts): C4's multi-file unified
// patch (`git diff`, C4's flags) split into one entry per file, the shape `@git-diff-view/react` takes (`hunks: string[]`,
// each beginning `@@`). Moved into `src/renderer/src/tools/code/review/review-model.ts` at M3.

// git's C-style quoting (`core.quotePath`): a path holding a byte outside printable ASCII, a `"` or a `\` is written in
// double quotes with `\ooo` octal escapes of its UTF-8 bytes and `\t \n \" \\ \a \b \f \r \v`.
const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
export function unquote(text) {
  if (!text.startsWith('"')) return text;
  const bytes = [];
  for (let i = 1; i < text.length - 1; i++) {
    const c = text[i];
    if (c !== '\\') {
      bytes.push(...new TextEncoder().encode(c)); // inside quotes git writes ASCII only
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

// One path token at the start of `text` (`a/…` or `"a/…"`), with what follows it.
function takePath(text) {
  if (text.startsWith('"')) {
    let i = 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    return { path: unquote(text.slice(0, i + 1)), rest: text.slice(i + 2) };
  }
  return null;
}

const stripPrefix = (path) => (path === '/dev/null' ? null : path.replace(/^[ab]\//, ''));

// `diff --git a/<old> b/<new>`: quoted tokens are unambiguous; unquoted ones with spaces are ambiguous in general, but
// git writes the header with old === new unless a rename or copy follows (whose `rename from/to` lines win), so the
// equal-halves reading is the one that matters.
function headerPaths(line) {
  const rest = line.slice('diff --git '.length);
  const first = takePath(rest);
  if (first) {
    const second = takePath(first.rest) ?? { path: first.rest };
    return { oldPath: stripPrefix(first.path), newPath: stripPrefix(second.path) };
  }
  const n = (rest.length - 5) / 2;
  if (Number.isInteger(n) && rest.slice(2, 2 + n) === rest.slice(5 + n)) return { oldPath: rest.slice(2, 2 + n), newPath: rest.slice(2, 2 + n) };
  const cut = rest.indexOf(' b/');
  return { oldPath: rest.slice(2, cut), newPath: rest.slice(cut + 3) };
}

export function splitPatch(patch) {
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const blocks = [];
  for (const line of lines) {
    if (line.startsWith('diff --git ')) blocks.push([line]);
    else blocks.at(-1)?.push(line);
  }
  return blocks.map((block) => {
    let { oldPath, newPath } = headerPaths(block[0]);
    let kind = 'modified';
    const hunks = [];
    const header = [];
    for (const line of block) {
      if (line.startsWith('@@')) hunks.push([line]);
      else if (hunks.length) hunks.at(-1).push(line);
      else {
        header.push(line);
        if (line.startsWith('new file mode')) kind = 'added';
        else if (line.startsWith('deleted file mode')) kind = 'deleted';
        else if (line.startsWith('rename from ')) (oldPath = unquote(line.slice(12))), (kind = 'renamed');
        else if (line.startsWith('rename to ')) newPath = unquote(line.slice(10));
        else if (line.startsWith('--- ')) oldPath = stripPrefix(unquote(line.slice(4))) ?? oldPath;
        else if (line.startsWith('+++ ')) newPath = stripPrefix(unquote(line.slice(4))) ?? newPath;
      }
    }
    if (header.some((line) => line.startsWith('Binary files ') || line === 'GIT binary patch')) kind = 'binary';
    return {
      path: newPath,
      oldPath: kind === 'renamed' ? oldPath : null,
      kind,
      hunks: hunks.map((hunk) => hunk.join('\n')),
      header: header.join('\n'),
    };
  });
}
