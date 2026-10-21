// The source a document diagram hands mermaid: the author's, with the page's face and a palette added for this render in
// an init directive (mermaid.ts says why they ride in the source). Mermaid applies a front matter's `config` under any
// directive, so the directive carries only what that config leaves unset, and the author's keys hold as written (P4,
// tracker row 2026-10-19 "Wave S c20"). The palette is the page's, or, for a diagram whose author names a theme, that
// theme's own colours (the owner's ruling, 2026-10-21). The front matter is read as mermaid 11.17.2 reads it, each step
// citing mermaid's own (preprocess.ts, diagram-api/frontmatter.ts): after mermaid's cleanup, by its own pattern, the
// block's indent removed from each line, js-yaml in the JSON schema (mermaid bundles js-yaml 4.3.0; 4.3.2 differs only in
// merge keys, which that schema lacks). Which theme the author names, and with what variables, mermaid's own parse reads
// (mermaid.ts). The source mermaid is handed keeps the author's bytes, and one whose config cannot be read goes as
// written, for mermaid to draw or reject.
import { JSON_SCHEMA, load } from 'js-yaml';
import type { MermaidConfig } from 'mermaid';

type Theme = Exclude<NonNullable<MermaidConfig['theme']>, 'null'>;

export interface Page {
  theme: Theme;
  fontFamily: string;
  themeVariables: Record<string, string>;
}

// mermaid's own front matter pattern; it must open the source, so the directive goes after it
const FRONT_MATTER = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;

// mermaid's themes (themes/index.js); a name it lacks draws in whatever palette mermaid was configured with
const THEMES: ReadonlySet<string> = new Set<Theme>(['base', 'default', 'dark', 'forest', 'neutral', 'neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color']);

// mermaid's directive check (sanitizeDirective.ts) blanks a theme variable holding anything else, a front matter's too
const SAFE = /^[\d "#%(),.;A-Za-z]+$/;

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

// The theme a configuration names, as mermaid's own parse of the author's source read it (front matter and directives,
// merged and checked as its render does); null for none and for a name mermaid's themes lack. An explicit `base` names
// none: base has no colours of its own (its variables are how it is meant to be coloured), and a document's are its
// page's, so it keeps the page's palette, the author's own base variables still winning key by key.
export function namedTheme(config: { theme?: unknown }): Theme | null {
  const { theme } = config;
  return typeof theme === 'string' && theme !== 'base' && THEMES.has(theme) ? (theme as Theme) : null;
}

// The source beside an empty init directive, after its front matter. Mermaid merges two or more init directives each
// checked first, and one alone unchecked over the front matter (utils.ts, detectInit); a render's own directive makes the
// author's two or more, so mermaid's parse reads the author's configuration from this as that render will.
export function besideInit(source: string): string {
  const head = FRONT_MATTER.exec(source)?.[0] ?? '';
  return `${head}%%{init: {}}%%\n${source.slice(head.length)}`;
}

// A named theme's own variables as a directive can carry them: its strings but the face (the page's rides apart), a hue
// below zero, as khroma writes some (`hsl(-160, 0%, 93%)`), written as the same hue in [0, 360), and none the directive
// check would still blank (`drop-shadow(…)`); the theme draws those alone as it would.
export function pinnable(variables: Record<string, unknown>): Record<string, string> {
  const pinned: Record<string, string> = {};
  for (const [name, value] of Object.entries(variables)) {
    if (name === 'fontFamily' || typeof value !== 'string') continue;
    const safe = value.replace(/^(hsla?\()-([\d.]+)/, (_, open: string, hue: string) => `${open}${(360 - (Number(hue) % 360)) % 360}`);
    if (SAFE.test(safe)) pinned[name] = safe;
  }
  return pinned;
}

export function withPage(source: string, page: Page): string {
  const own = authorConfig(source);
  if (own === null) return source;
  const ownVariables = record(own.themeVariables);
  const init: Record<string, unknown> = {};
  if (unset(own, 'theme')) init.theme = page.theme;
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
