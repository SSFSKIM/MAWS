// The source a document diagram hands mermaid: the author's, with the page's palette and face added for this render in
// an init directive (mermaid.ts says why they ride in the source). Mermaid applies a front matter's `config` under any
// directive, so the directive carries only what that config leaves unset, and the author's keys hold as written (P4,
// tracker row 2026-10-19 "Wave S c20"). The front matter is read as mermaid 11 reads it (diagram-api/frontmatter.ts):
// its own pattern, the block's indent removed from each line, js-yaml in the JSON schema (mermaid bundles js-yaml 4.3.0;
// 4.3.2 differs only in merge keys, which that schema lacks). YAML that js-yaml cannot read, mermaid cannot either: the
// render rejects, as mermaid's own would.
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

function authorConfig(front: RegExpExecArray | null): Record<string, unknown> {
  if (!front) return {};
  const [, indent, body] = front;
  const yaml = indent ? body.split('\n').map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n') : body;
  return record(record(load(yaml, { schema: JSON_SCHEMA })).config);
}

export function withPage(source: string, page: Page): string {
  const front = FRONT_MATTER.exec(source);
  const own = authorConfig(front);
  const ownVariables = record(own.themeVariables);
  const init: Record<string, unknown> = {};
  if (unset(own, 'theme')) init.theme = 'base';
  // the face rides at the top level: mermaid blanks a `themeVariables` value holding a `-` (`ui-serif`, `-apple-system`),
  // in a directive and a front matter alike, and copies a top-level face into `themeVariables` after that check
  if (unset(own, 'fontFamily')) init.fontFamily = page.fontFamily;
  const themeVariables = Object.fromEntries(Object.entries(page.themeVariables).filter(([name]) => unset(ownVariables, name)));
  if (Object.keys(themeVariables).length > 0) init.themeVariables = themeVariables;
  if (Object.keys(init).length === 0) return source;
  const head = front?.[0] ?? '';
  // mermaid reads every `'` in a directive as `"`, so one in a face's name would break the directive's JSON
  return `${head}%%{init: ${JSON.stringify(init).replace(/'/g, '\\u0027')}}%%\n${source.slice(head.length)}`;
}
