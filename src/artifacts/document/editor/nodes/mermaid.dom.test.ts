// The document's mermaid renderer (happy-dom; P3-F, sitting candidate 20). Mermaid is one module-wide instance, shared
// with the transcript, which configures it in the app's palette and face; the page's palette and face ride in each
// diagram's own source, so they hold whoever configured the instance last. Mermaid cannot lay out in happy-dom: its
// render is faked, and at the fake's start the transcript configures mermaid (as a transcript diagram does while this one
// waits in mermaid's queue) and mermaid's own parse reads the source over that configuration, as its render starts by
// doing.
import mermaid, { type MermaidConfig } from 'mermaid';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMermaid } from './mermaid';
import { withPage } from './mermaid-source';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

// The page's face: a design system's body font, which holds a `-` as most faces do (`ui-serif`).
const PAGE_FONT = '"Iowan Old Style", ui-serif, Georgia, serif';

// A diagram's element on a light page.
function onPage(): HTMLElement {
  const page = document.body.appendChild(document.createElement('div'));
  page.className = 'ds-doc';
  page.style.color = 'rgb(31, 30, 27)';
  page.style.backgroundColor = 'rgb(250, 249, 246)';
  page.style.fontFamily = PAGE_FONT;
  return page.appendChild(document.createElement('div'));
}

// The transcript's configuration in the dark app (plugins.ts's `mermaidThemeVariables`, through @streamdown/mermaid's
// defaults, whose `fontFamily` is `monospace`).
const TRANSCRIPT = {
  theme: 'base',
  fontFamily: 'monospace',
  themeVariables: {
    background: '#1f1e1b',
    primaryColor: '#2c2b28',
    primaryTextColor: '#f5f4f0',
    primaryBorderColor: '#5a5955',
    secondaryColor: '#3a2a22',
    tertiaryColor: '#33322e',
    lineColor: '#a8a7a2',
    textColor: '#f5f4f0',
    fontFamily: '-apple-system, "SF Pro Text", Inter, system-ui, sans-serif',
  },
} as const;

// The source mermaid was handed for `source`, and the configuration in force as its render started.
async function renderedAfterTranscript(source: string): Promise<{ source: string; config: MermaidConfig }> {
  let seen: { source: string; config: MermaidConfig } | undefined;
  vi.spyOn(mermaid, 'render').mockImplementation(async (_id, text) => {
    mermaid.initialize(TRANSCRIPT);
    await mermaid.parse(text);
    seen = { source: text, config: mermaid.mermaidAPI.getConfig() };
    return { svg: '<svg></svg>', diagramType: 'flowchart-v2' } as Awaited<ReturnType<typeof mermaid.render>>;
  });
  await renderMermaid(source, onPage());
  if (!seen) throw new Error('renderMermaid never rendered');
  return seen;
}

const PAGE_PALETTE = {
  background: 'rgb(250, 249, 246)',
  primaryColor: 'rgb(250, 249, 246)',
  secondaryColor: 'rgb(250, 249, 246)',
  tertiaryColor: 'rgb(250, 249, 246)',
  primaryTextColor: 'rgb(31, 30, 27)',
  primaryBorderColor: 'rgb(31, 30, 27)',
  lineColor: 'rgb(31, 30, 27)',
  textColor: 'rgb(31, 30, 27)',
};

describe('a document diagram drawn after the transcript configured mermaid', () => {
  it('draws in the page’s palette and face', async () => {
    const { config } = await renderedAfterTranscript('graph TD\n  A[Start] --> B[Finish]');
    expect(config.theme).toBe('base');
    expect(config.themeVariables).toMatchObject({ ...PAGE_PALETTE, fontFamily: PAGE_FONT });
    expect(config.fontFamily).toBe(PAGE_FONT);
  });

  // the A1 review of P3-F: a front matter's `config` that sets no colours still gets the page's palette
  it('draws in the page’s palette and face under a front matter that configures something else', async () => {
    const { config } = await renderedAfterTranscript('---\nconfig:\n  layout: elk\n---\ngraph TD\n  A --> B');
    expect(config.layout).toBe('elk');
    expect(config.theme).toBe('base');
    expect(config.themeVariables).toMatchObject({ ...PAGE_PALETTE, fontFamily: PAGE_FONT });
    expect(config.fontFamily).toBe(PAGE_FONT);
  });

  it('keeps what a front matter’s config sets as the author wrote it', async () => {
    const { source, config } = await renderedAfterTranscript(
      '---\ntitle: Flow\nconfig:\n  theme: forest\n  layout: elk\n  themeVariables:\n    primaryColor: "#ffeeaa"\n---\ngraph TD\n  A --> B',
    );
    expect(source.startsWith('---\ntitle: Flow\nconfig:\n  theme: forest\n  layout: elk\n  themeVariables:\n    primaryColor: "#ffeeaa"\n---\n')).toBe(true);
    expect(config.theme).toBe('forest');
    expect(config.layout).toBe('elk');
    expect(config.themeVariables).toMatchObject({ ...PAGE_PALETTE, primaryColor: '#ffeeaa', fontFamily: PAGE_FONT });
    expect(config.fontFamily).toBe(PAGE_FONT);
  });

  it('keeps a front matter first and lets the source’s own init directive win', async () => {
    const { source, config } = await renderedAfterTranscript(
      '---\ntitle: Flow\n---\n%%{init: {"fontFamily": "Georgia, serif", "themeVariables": {"primaryColor": "#ffeeaa"}}}%%\ngraph TD\n  A --> B',
    );
    expect(source.startsWith('---\ntitle: Flow\n---\n')).toBe(true);
    expect(config.themeVariables).toMatchObject({ ...PAGE_PALETTE, primaryColor: '#ffeeaa', fontFamily: 'Georgia, serif' });
    expect(config.fontFamily).toBe('Georgia, serif');
  });

});

// mermaid reads a directive's single quotes as double quotes, so a face named with one must not break the directive (the
// source is built directly: happy-dom's style parser mangles such a name before the page could hand it over)
it('hands mermaid a face whose name holds an apostrophe', async () => {
  const face = '"Bob\'s Grotesk", sans-serif';
  await mermaid.parse(withPage('graph TD\n  A --> B', { fontFamily: face, themeVariables: { primaryColor: 'rgb(250, 249, 246)' } }));
  const config = mermaid.mermaidAPI.getConfig();
  expect(config.fontFamily).toBe(face);
  expect(config.themeVariables).toMatchObject({ primaryColor: 'rgb(250, 249, 246)', fontFamily: face });
});
