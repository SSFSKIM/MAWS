// A Markdown file's front matter as What's inside reads it (P2-B execution document §5.5): the leading `---` block's
// top-level `name` and `description` when each is a plain, single- or double-quoted scalar on its line, or a `>` or `|`
// block scalar; any other shape reads as absent. No YAML dependency: the reader is given the file's first 8 KiB, so a
// block that does not close within them reads as none.

export interface FrontMatter {
  name: string | null;
  description: string | null;
}

const KEYS = ['name', 'description'] as const;
const NONE: FrontMatter = { name: null, description: null };

function doubleQuoted(body: string): string | null {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '"') return body.slice(i + 1).trim() === '' || body.slice(i + 1).trim().startsWith('#') ? out : null;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[(i += 1)];
    out += next === 'n' ? '\n' : next === 't' ? '\t' : next === undefined ? '' : next;
  }
  return null; // never closed on its line
}

function singleQuoted(body: string): string | null {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== "'") {
      out += body[i];
      continue;
    }
    if (body[i + 1] === "'") {
      out += "'";
      i += 1;
      continue;
    }
    const rest = body.slice(i + 1).trim();
    return rest === '' || rest.startsWith('#') ? out : null;
  }
  return null;
}

// A `>` or `|` block: the more-indented lines after the key, folded (`>`: lines joined by spaces, a blank line a break)
// or kept (`|`).
function blockScalar(style: string, lines: readonly string[]): string {
  const indents = lines.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  const body = lines.map((line) => line.slice(indent));
  if (style === '|') return body.join('\n').trim();
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of body) {
    if (line.trim() === '') {
      if (current.length > 0) paragraphs.push(current.join(' '));
      current = [];
    } else current.push(line.trim());
  }
  if (current.length > 0) paragraphs.push(current.join(' '));
  return paragraphs.join('\n').trim();
}

function scalarOf(rest: string, following: readonly string[]): string | null {
  const value = rest.trim();
  if (value.startsWith('"')) return doubleQuoted(value.slice(1));
  if (value.startsWith("'")) return singleQuoted(value.slice(1));
  const block = /^([|>])[+-]?\s*(#.*)?$/.exec(value);
  if (block) return blockScalar(block[1], following);
  if (value === '' || /^[[{&*!|>@`%-]/.test(value)) return null;
  return value.replace(/\s+#.*$/, '').trim();
}

export function frontMatter(text: string): FrontMatter {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return NONE;
  const end = lines.findIndex((line, i) => i > 0 && (line.trim() === '---' || line.trim() === '...'));
  if (end < 0) return NONE;
  const block = lines.slice(1, end);
  const found: { name: string | null; description: string | null } = { name: null, description: null };
  for (let i = 0; i < block.length; i += 1) {
    const match = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/.exec(block[i]);
    if (!match) continue;
    const key = KEYS.find((k) => k === match[1]);
    if (key === undefined) continue;
    let next = i + 1;
    while (next < block.length && (block[next].trim() === '' || /^\s/.test(block[next]))) next += 1;
    const value = scalarOf(match[2] ?? '', block.slice(i + 1, next));
    found[key] = value === null || value === '' ? null : value;
  }
  return found;
}
