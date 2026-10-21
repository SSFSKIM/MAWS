// The source a document diagram hands mermaid (mermaid-source.ts): the page's palette and face go in where the author's
// front matter config leaves them unset, the front matter read as mermaid reads it and kept as written.
import { describe, expect, it } from 'vitest';
import { withPage } from './mermaid-source';

const PAGE = {
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
});
