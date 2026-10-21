// The source a document diagram hands mermaid: the author's, with the page's face and a palette added for this render in
// an init directive (mermaid.ts says why they ride in the source). Mermaid applies a front matter's `config` under any
// directive, so the directive carries only what that config leaves unset, and the author's keys hold as written (P4,
// tracker row 2026-10-19 "Wave S c20"). The palette is the page's, or, for a diagram whose author names a theme, that
// theme's own colours (the owner's ruling, 2026-10-21). The source is read as mermaid 11.17.2 reads it, each step below
// citing mermaid's own: the front matter (preprocess.ts, diagram-api/frontmatter.ts) after mermaid's cleanup, by its own
// pattern, the block's indent removed from each line, js-yaml in the JSON schema (mermaid bundles js-yaml 4.3.0; 4.3.2
// differs only in merge keys, which that schema lacks), then the init directives after it (utils.ts). The source mermaid
// is handed keeps the author's bytes, and one whose config cannot be read goes as written, for mermaid to draw or reject.
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

// the front matter's `config` and the cleaned text after the front matter, or null when the config cannot be read
function authored(source: string): { config: Record<string, unknown>; rest: string } | null {
  const text = cleaned(source);
  const front = FRONT_MATTER.exec(text);
  if (!front) return { config: {}, rest: text };
  const [head, indent, body] = front;
  const yaml = indent ? body.split('\n').map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n') : body;
  try {
    return { config: record(record(load(yaml, { schema: JSON_SCHEMA })).config), rest: text.slice(head.length) };
  } catch {
    return null;
  }
}

// mermaid's directive patterns (utils.ts: directiveRegex, and detectDirective's comments that are no directive)
const DIRECTIVE = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;
const WITHOUT_OPEN = /\s*(?:(\w+)(?=:):|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/;
const NOT_A_DIRECTIVE = new RegExp(`[%]{2}(?![{]${WITHOUT_OPEN.source})(?=[}][%]{2}).*\n`, 'ig');
const INIT = /(?:init\b)|(?:initialize\b)/;

// the init directives' arguments in order, as mermaid's detectDirective reads them: every `'` read as `"`, and one that
// does not parse drops them all
function initArgs(text: string): unknown[] {
  const read = text.trim().replace(NOT_A_DIRECTIVE, '').replace(/'/gm, '"');
  try {
    return [...read.matchAll(DIRECTIVE)]
      .filter((match) => match[1]?.match(INIT) || match[2]?.match(INIT))
      .map((match) => (match[3] ? match[3].trim() : match[4] ? JSON.parse(match[4].trim()) : null));
  } catch {
    return [];
  }
}

// mermaid's configKeys (defaultConfig.ts's keyify): every key name of its default configuration, at any depth, but an
// array's; its directive check deletes any other
export function configKeysOf(config: object): Set<string> {
  const keys = new Set<string>();
  const walk = (value: object) => {
    for (const [name, child] of Object.entries(value)) {
      if (Array.isArray(child)) continue;
      keys.add(name);
      if (typeof child === 'object' && child !== null) walk(child);
    }
  };
  walk(config);
  return keys;
}

// theme variables as mermaid's directive check (sanitizeDirective.ts) leaves each front matter or directive before it
// merges them: only its configuration's key names (never a theme's own methods), none null, and a value holding
// anything beyond SAFE blanked
function checked(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record(value))
      .filter(([name, variable]) => variable != null && keys.has(name) && !name.startsWith('__') && !name.includes('proto') && !name.includes('constr'))
      .map(([name, variable]) => [name, typeof variable === 'string' && !SAFE.test(variable) ? '' : variable]),
  );
}

// The theme the author names, from the front matter's config and then the init directives, a later one winning as mermaid
// merges them, with the author's own theme variables merged and checked as mermaid does (`keys`: configKeysOf mermaid's
// default configuration); null when none is named. An explicit `base` names none: base has no colours of its own (its
// variables are how it is meant to be coloured), and a document's are its page's, so it keeps the page's palette, the
// author's own base variables still winning key by key.
export function authorTheme(source: string, keys: ReadonlySet<string>): { theme: Theme; themeVariables: Record<string, unknown> } | null {
  const author = authored(source);
  if (!author) return null;
  let theme = author.config.theme;
  const themeVariables = checked(author.config.themeVariables, keys);
  for (const args of initArgs(author.rest).map(record)) {
    if (args.theme != null) theme = args.theme;
    Object.assign(themeVariables, checked(args.themeVariables, keys));
  }
  if (typeof theme !== 'string' || theme === 'base' || !THEMES.has(theme)) return null;
  return { theme: theme as Theme, themeVariables };
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
  const author = authored(source);
  if (!author) return source;
  const own = author.config;
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
