// The source a document diagram hands mermaid: the author's, with the page's palette and face added for this render in
// an init directive (mermaid.ts says why they ride in the source). Mermaid applies a front matter's `config` under any
// directive, so the directive carries only what that config leaves unset, and the author's keys hold as written (P4,
// tracker row 2026-10-19 "Wave S c20"). The front matter is read as mermaid 11 reads it (preprocess.ts and
// diagram-api/frontmatter.ts): from the source after mermaid's cleanup, by its own pattern, the block's indent removed
// from each line, js-yaml in the JSON schema (mermaid bundles js-yaml 4.3.0; 4.3.2 differs only in merge keys, which that
// schema lacks). The source mermaid is handed keeps the author's bytes, and one whose config cannot be read goes as
// written, for mermaid to draw or reject.
import { JSON_SCHEMA, load } from 'js-yaml';

export interface Page {
  fontFamily: string;
  themeVariables: Record<string, string>;
}

// mermaid's own front matter pattern; it must open the source, so the directive goes after it
const FRONT_MATTER = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// mermaid drops a null value before it applies a configuration, so a key set to null is unset
const unset = (config: Record<string, unknown>, key: string) => config[key] == null;

// mermaid's cleanupText (preprocess.ts), which runs before it reads the front matter: every line ended in `\n`, and an
// HTML tag's double-quoted attributes single-quoted (mermaid exports neither it nor its front matter reader)
function cleaned(source: string): string {
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/<(\w+)([^>]*)>/g, (_, tag: string, attributes: string) => `<${tag}${attributes.replace(/="([^"]*)"/g, "='$1'")}>`);
}

// the front matter's `config`, or null when it cannot be read
function authorConfig(source: string): Record<string, unknown> | null {
  const front = FRONT_MATTER.exec(cleaned(source));
  if (!front) return {};
  const [, indent, body] = front;
  const yaml = indent ? body.split('\n').map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n') : body;
  try {
    return record(record(load(yaml, { schema: JSON_SCHEMA })).config);
  } catch {
    return null;
  }
}

export function withPage(source: string, page: Page): string {
  const own = authorConfig(source);
  if (own === null) return source;
  const ownVariables = record(own.themeVariables);
  const init: Record<string, unknown> = {};
  if (unset(own, 'theme')) init.theme = 'base';
  // the face rides at the top level: mermaid blanks a `themeVariables` value holding a `-` (`ui-serif`, `-apple-system`),
  // in a directive and a front matter alike, and copies a top-level face into `themeVariables` after that check
  if (unset(own, 'fontFamily')) init.fontFamily = page.fontFamily;
  const themeVariables = Object.fromEntries(Object.entries(page.themeVariables).filter(([name]) => unset(ownVariables, name)));
  if (Object.keys(themeVariables).length > 0) init.themeVariables = themeVariables;
  if (Object.keys(init).length === 0) return source;
  // the cleanup moves no front matter's delimiters, only shortens its line ends, so the author's own bytes are matched again
  const head = FRONT_MATTER.exec(source)?.[0] ?? '';
  // mermaid reads every `'` in a directive as `"`, so one in a face's name would break the directive's JSON
  return `${head}%%{init: ${JSON.stringify(init).replace(/'/g, '\\u0027')}}%%\n${source.slice(head.length)}`;
}
