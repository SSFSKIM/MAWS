// The source a document diagram hands mermaid (mermaid-source.ts): the page's palette and face go in where the author's
// front matter config leaves them unset, the front matter read as mermaid reads it and kept as written.
import { describe, expect, it } from 'vitest';
import { authorTheme, pinnable, withPage, type Page } from './mermaid-source';

const PAGE: Page = {
  theme: 'base',
  fontFamily: '"Iowan Old Style", ui-serif, Georgia, serif',
  themeVariables: { background: 'rgb(250, 249, 246)', primaryColor: 'rgb(250, 249, 246)', textColor: 'rgb(31, 30, 27)' },
};
const BODY = 'graph TD\n  A --> B';

// The init directive withPage put after `head` (the source's front matter, which must come through as written).
function addedAfter(head: string): unknown {
  const out = withPage(`${head}${BODY}`, PAGE);
  expect(out.startsWith(head)).toBe(true);
  const init = /^%%\{init: (.*)\}%%\n/.exec(out.slice(head.length));
  expect(init).not.toBeNull();
  expect(out.slice(head.length + init![0].length)).toBe(BODY);
  return JSON.parse(init![1]);
}

describe('a document diagram’s source', () => {
  it('takes the palette and face under its front matter’s config, keeping the author’s keys as written', () => {
    const head = '---\ntitle: Flow\nconfig:\n  theme: forest\n  layout: elk\n  themeVariables:\n    primaryColor: "#ffeeaa"\n---\n';
    expect(addedAfter(head)).toEqual({
      fontFamily: PAGE.fontFamily,
      themeVariables: { background: 'rgb(250, 249, 246)', textColor: 'rgb(31, 30, 27)' },
    });
  });

  it('reads a flow-style config and quoted keys as mermaid does', () => {
    const head = `---\nconfig: { layout: elk, "theme": 'neutral', themeVariables: { 'textColor': '#333' } }\n---\n`;
    expect(addedAfter(head)).toEqual({ fontFamily: PAGE.fontFamily, themeVariables: { background: 'rgb(250, 249, 246)', primaryColor: 'rgb(250, 249, 246)' } });
  });

  // mermaid reads an indented front matter with its own indent removed
  it('reads an indented front matter as mermaid does', () => {
    const head = '  ---\n  config:\n    fontFamily: Georgia, serif\n    layout: elk\n  ---\n';
    expect(addedAfter(head)).toEqual({ theme: 'base', themeVariables: PAGE.themeVariables });
  });

  it('takes the whole page when its front matter configures nothing, or it has none', () => {
    expect(addedAfter('---\ntitle: Flow\n---\n')).toEqual({ theme: 'base', fontFamily: PAGE.fontFamily, themeVariables: PAGE.themeVariables });
    expect(addedAfter('')).toEqual({ theme: 'base', fontFamily: PAGE.fontFamily, themeVariables: PAGE.themeVariables });
  });

  // mermaid cleans a source before it reads the front matter: an HTML tag's double-quoted attributes become single-quoted
  // (so this title is YAML only after that), and every line ends in `\n`
  it('reads a title holding an HTML tag after mermaid’s own cleanup, and keeps it as written', () => {
    expect(addedAfter('---\ntitle: "<b class="label">Title</b>"\nconfig:\n  theme: forest\n---\n')).toEqual({ fontFamily: PAGE.fontFamily, themeVariables: PAGE.themeVariables });
  });

  it('reads an indented front matter with carriage-return line ends after mermaid’s own cleanup, and keeps it as written', () => {
    expect(addedAfter('  ---\r  title: Flow\r  config:\r    theme: dark\r  ---\r')).toEqual({ fontFamily: PAGE.fontFamily, themeVariables: PAGE.themeVariables });
  });

  it('is left as written, for mermaid to judge, when its front matter cannot be read', () => {
    const source = `---\nconfig:\n  theme: [forest\n---\n${BODY}`;
    expect(withPage(source, PAGE)).toBe(source);
  });
});

// The owner's ruling (2026-10-21): a diagram that names a theme keeps that theme's colours.
describe('the theme a document diagram’s author names', () => {
  const named = (head: string) => authorTheme(`${head}${BODY}`)?.theme ?? null;

  it('is read from its front matter, then its own init directives, a later one winning, as mermaid merges them', () => {
    expect(named('---\nconfig:\n  theme: forest\n---\n')).toBe('forest');
    expect(named('%%{init: {"theme": "forest"}}%%\n')).toBe('forest');
    expect(named("%%{initialize: {'theme': 'neutral'}}%%\n")).toBe('neutral'); // mermaid reads `'` as `"`
    expect(named('---\nconfig:\n  theme: dark\n---\n%%{init: {"theme": "forest"}}%%\n')).toBe('forest');
    expect(named('%%{init: {"theme": "dark"}}%%\n%%{init: {"themeVariables": {"primaryColor": "#fff"}}}%%\n%%{init: {"theme": "neo"}}%%\n')).toBe('neo');
  });

  // base has no colours of its own; a name mermaid's themes lack draws in whatever palette mermaid was configured with
  it('is none when it is base or a name mermaid does not know', () => {
    expect(named('---\nconfig:\n  theme: base\n---\n')).toBeNull();
    expect(named('---\nconfig:\n  theme: forest\n---\n%%{init: {"theme": "base"}}%%\n')).toBeNull();
    expect(named('---\nconfig:\n  theme: solarized\n---\n')).toBeNull();
    expect(named('')).toBeNull();
  });

  // mermaid drops every init directive when one does not parse
  it('is the front matter’s when an init directive is malformed', () => {
    expect(named('---\nconfig:\n  theme: dark\n---\n%%{init: {"theme": "forest"}}%%\n%%{init: {theme: neo}}%%\n')).toBe('dark');
    expect(named('%%{init: {theme: forest}}%%\n')).toBeNull();
  });

  it('comes with the author’s own variables, merged and checked as mermaid does', () => {
    const head = '---\nconfig:\n  theme: forest\n  themeVariables:\n    primaryColor: "#ffeeaa"\n    lineColor: hsl(-10, 0%, 0%)\n---\n';
    expect(authorTheme(`${head}%%{init: {"themeVariables": {"primaryColor": "#000000"}}}%%\n${BODY}`)).toEqual({
      theme: 'forest',
      themeVariables: { primaryColor: '#000000', lineColor: '' },
    });
  });
});

describe('a named theme’s own variables, as a directive carries them', () => {
  it('are its strings but the face, a hue below zero written in [0, 360), and none the directive check would blank', () => {
    const own = { primaryColor: '#cde498', tertiaryColor: 'hsl(-160, 0%, 93.3%)', fontFamily: 'trebuchet ms', dropShadow: 'drop-shadow(1px 2px 2px rgba(0, 0, 0, 1))', strokeWidth: 1, darkMode: false };
    expect(pinnable(own)).toEqual({ primaryColor: '#cde498', tertiaryColor: 'hsl(200, 0%, 93.3%)' });
  });
});
