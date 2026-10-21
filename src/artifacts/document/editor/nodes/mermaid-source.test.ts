// The source a document diagram hands mermaid (mermaid-source.ts): the page's palette and face go in where the author's
// front matter config leaves them unset, the front matter read as mermaid reads it and kept as written.
import { describe, expect, it } from 'vitest';
import { besideInit, namedTheme, pinnable, withPage, type Page } from './mermaid-source';

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

// The owner's ruling (2026-10-21): a diagram that names a theme keeps that theme's colours. Mermaid's own parse reads which
// theme a source names (mermaid.dom.test.ts); these are what this module adds to it.
describe('the theme a configuration mermaid read names', () => {
  // base has no colours of its own; a name mermaid's themes lack draws in whatever palette mermaid was configured with
  it('is a theme mermaid knows, other than base', () => {
    expect(namedTheme({ theme: 'forest' })).toBe('forest');
    expect(namedTheme({ theme: 'redux-dark-color' })).toBe('redux-dark-color');
    expect(namedTheme({ theme: 'base' })).toBeNull();
    expect(namedTheme({ theme: 'solarized' })).toBeNull();
    expect(namedTheme({})).toBeNull();
  });
});

// mermaid merges two or more init directives each checked first, one alone unchecked over the front matter; this
// render's own directive makes it two or more, so mermaid's parse reads the author's beside an empty one
it('reads a source for mermaid’s parse beside an empty init directive, after its front matter', () => {
  expect(besideInit(`---\ntitle: Flow\n---\n${BODY}`)).toBe(`---\ntitle: Flow\n---\n%%{init: {}}%%\n${BODY}`);
  expect(besideInit(BODY)).toBe(`%%{init: {}}%%\n${BODY}`);
});

describe('a named theme’s own variables, as a directive carries them', () => {
  it('are its strings but the face, a hue below zero written in [0, 360), and none the directive check would blank', () => {
    const own = { primaryColor: '#cde498', tertiaryColor: 'hsl(-160, 0%, 93.3%)', fontFamily: 'trebuchet ms', dropShadow: 'drop-shadow(1px 2px 2px rgba(0, 0, 0, 1))', strokeWidth: 1, darkMode: false };
    expect(pinnable(own)).toEqual({ primaryColor: '#cde498', tertiaryColor: 'hsl(200, 0%, 93.3%)' });
  });
});
