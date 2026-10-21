// The document's mermaid renderer (happy-dom; P3-F, sitting candidate 20). Mermaid is one module-wide instance, shared
// with the transcript, which configures it in the app's palette and face; the page's face, and the page's palette or the
// named theme's own colours, ride in each diagram's own source, so they hold whoever configured the instance last.
// Mermaid cannot lay out in happy-dom: its render is faked, and at the fake's start the transcript configures mermaid (as a
// transcript diagram does while this one waits in mermaid's queue) and mermaid's own parse reads the source over that
// configuration, as its render starts by doing.
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

// The source mermaid was handed for `source`, and the configuration in force as its render started (with no transcript
// configuration between, when `transcript` is false).
async function renderedAfterTranscript(source: string, transcript = true): Promise<{ source: string; config: MermaidConfig }> {
  let seen: { source: string; config: MermaidConfig } | undefined;
  vi.spyOn(mermaid, 'render').mockImplementation(async (_id, text) => {
    if (transcript) mermaid.initialize(TRANSCRIPT);
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

// A theme's own variables, as mermaid computes them for these author's variables under that theme alone.
function ownVariables(theme: NonNullable<MermaidConfig['theme']>, themeVariables: Record<string, unknown> = {}): Record<string, unknown> {
  mermaid.initialize({ theme, themeVariables });
  return mermaid.mermaidAPI.getSiteConfig().themeVariables as Record<string, unknown>;
}

// Variables with each `hsl()` hue read in [0, 360): khroma writes some below zero, the same colour.
function hues(variables: Record<string, unknown>): Record<string, unknown> {
  const hue = (value: unknown) =>
    typeof value === 'string' ? value.replace(/^(hsla?\()(-?[\d.]+)/, (_, open: string, h: string) => `${open}${(((Number(h) % 360) + 360) % 360).toFixed(6)}`) : value;
  return Object.fromEntries(Object.entries(variables).map(([name, value]) => [name, hue(value)]));
}

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

  it('draws in the page’s palette and face under an explicit `theme: base`', async () => {
    const { config } = await renderedAfterTranscript('---\nconfig:\n  theme: base\n  themeVariables:\n    primaryColor: "#ffeeaa"\n---\ngraph TD\n  A --> B');
    expect(config.theme).toBe('base');
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

// The owner's ruling (2026-10-21): a diagram whose front matter or own directive names a theme keeps that theme's colours.
describe('a document diagram that names a theme, drawn after the transcript configured mermaid', () => {
  it('keeps forest’s own colours, named in its front matter, in the page’s face', async () => {
    const forest = ownVariables('forest');
    const { config } = await renderedAfterTranscript('---\nconfig:\n  theme: forest\n---\ngraph TD\n  A --> B');
    expect(config.theme).toBe('forest');
    expect(hues(config.themeVariables)).toEqual(hues({ ...forest, fontFamily: PAGE_FONT }));
    expect(config.fontFamily).toBe(PAGE_FONT);
  });

  it('keeps forest’s own colours, named only in its own init directive', async () => {
    const forest = ownVariables('forest');
    const { config } = await renderedAfterTranscript('%%{init: {"theme": "forest"}}%%\ngraph TD\n  A --> B');
    expect(config.theme).toBe('forest');
    expect(hues(config.themeVariables)).toEqual(hues({ ...forest, fontFamily: PAGE_FONT }));
  });

  // mermaid reads `'` as `"` in a directive, and the author's directive over the front matter
  it('keeps the theme mermaid reads, the author’s directive naming it over the front matter', async () => {
    const neutral = ownVariables('neutral');
    const { config } = await renderedAfterTranscript("---\nconfig:\n  theme: dark\n---\n%%{initialize: {'theme': 'neutral'}}%%\ngraph TD\n  A --> B");
    expect(config.theme).toBe('neutral');
    expect(hues(config.themeVariables)).toEqual(hues({ ...neutral, fontFamily: PAGE_FONT }));
  });

  // neutral writes its tertiary colours with a hue below zero, which mermaid's directive check would blank
  it('keeps neutral’s own colours, the transcript’s tertiary colour included', async () => {
    const neutral = ownVariables('neutral');
    const { config } = await renderedAfterTranscript('---\nconfig:\n  theme: neutral\n---\ngraph TD\n  A --> B');
    expect(hues(config.themeVariables)).toEqual(hues({ ...neutral, fontFamily: PAGE_FONT }));
    expect(config.themeVariables.tertiaryColor).not.toBe(TRANSCRIPT.themeVariables.tertiaryColor);
  });

  // what forest derives from the author's key follows it, as mermaid draws forest with that key alone
  it('keeps the author’s own variables, and what the theme derives from them', async () => {
    const forest = ownVariables('forest', { mainBkg: '#ffeeaa' });
    const { source, config } = await renderedAfterTranscript(
      '---\ntitle: Flow\nconfig:\n  theme: forest\n  layout: elk\n  themeVariables:\n    mainBkg: "#ffeeaa"\n---\ngraph TD\n  A --> B',
    );
    expect(source.startsWith('---\ntitle: Flow\nconfig:\n  theme: forest\n  layout: elk\n  themeVariables:\n    mainBkg: "#ffeeaa"\n---\n')).toBe(true);
    expect(config.layout).toBe('elk');
    expect(config.themeVariables).toMatchObject({ mainBkg: '#ffeeaa', actorBkg: '#ffeeaa' });
    expect(hues(config.themeVariables)).toEqual(hues({ ...forest, fontFamily: PAGE_FONT }));
  });

  // mermaid reads a front matter only after its own cleanup: an HTML tag's double-quoted attributes single-quoted, every
  // line ended in `\n`
  it('keeps the theme a front matter whose title holds an HTML tag names', async () => {
    const forest = ownVariables('forest');
    const { source, config } = await renderedAfterTranscript('---\ntitle: "<b class="label">Title</b>"\nconfig:\n  theme: forest\n---\ngraph TD\n  A --> B');
    expect(source.startsWith('---\ntitle: "<b class="label">Title</b>"\nconfig:\n  theme: forest\n---\n')).toBe(true);
    expect(config.theme).toBe('forest');
    expect(hues(config.themeVariables)).toEqual(hues({ ...forest, fontFamily: PAGE_FONT }));
  });

  it('keeps the theme an indented front matter with carriage-return line ends names', async () => {
    const dark = ownVariables('dark');
    const { config } = await renderedAfterTranscript('  ---\r  title: Flow\r  config:\r    theme: dark\r  ---\rgraph TD\r  A --> B');
    expect(config.theme).toBe('dark');
    expect(hues(config.themeVariables)).toEqual(hues({ ...dark, fontFamily: PAGE_FONT }));
  });

  // mermaid's directive check keeps only its configuration's key names, so a theme's method named here never reaches it
  it('draws a front matter whose theme variables name no variable mermaid knows, in its theme’s colours', async () => {
    const forest = ownVariables('forest');
    const { config } = await renderedAfterTranscript('---\nconfig:\n  theme: forest\n  themeVariables:\n    updateColors: red\n---\ngraph TD\n  A --> B');
    expect(config.theme).toBe('forest');
    expect(hues(config.themeVariables)).toEqual(hues({ ...forest, fontFamily: PAGE_FONT }));
  });

  // mermaid drops a directive's null values before it merges the directives, so a later null leaves an earlier value
  it('keeps an author’s variable a later directive sets to null, and what the theme derives from it', async () => {
    const forest = ownVariables('forest', { mainBkg: '#ffeeaa' });
    const { config } = await renderedAfterTranscript(
      '%%{init: {"theme": "forest", "themeVariables": {"mainBkg": "#ffeeaa"}}}%%\n%%{init: {"themeVariables": {"mainBkg": null}}}%%\ngraph TD\n  A --> B',
    );
    expect(config.themeVariables).toMatchObject({ mainBkg: '#ffeeaa', actorBkg: '#ffeeaa' });
    expect(hues(config.themeVariables)).toEqual(hues({ ...forest, fontFamily: PAGE_FONT }));
  });

  // a malformed init directive makes mermaid drop every one, the page's too, so the diagram draws as before the ruling:
  // its theme under the page's configuration
  it('draws as before the ruling, in the page’s face, when an init directive of the author’s is malformed', async () => {
    const { config } = await renderedAfterTranscript('---\nconfig:\n  theme: forest\n---\n%%{init: {theme: neo}}%%\ngraph TD\n  A --> B', false);
    expect(config.theme).toBe('forest');
    expect(config.themeVariables).toMatchObject({ ...PAGE_PALETTE, fontFamily: PAGE_FONT });
  });

  // mermaid's check drops a null inside a nested variable too; this one, met by xychart's parse, drew before the ruling
  // (with no transcript diagram between, nothing else configures mermaid over what this render left)
  it('draws a forest xychart whose theme variables hold a nested null, in forest’s colours', async () => {
    const forest = ownVariables('forest', { xyChart: {} });
    const { config } = await renderedAfterTranscript(
      '---\nconfig:\n  theme: forest\n  themeVariables:\n    xyChart:\n      plotColorPalette: null\n---\nxychart-beta\n  x-axis [a, b]\n  bar [1, 2]',
      false,
    );
    expect(config.theme).toBe('forest');
    expect(hues(config.themeVariables)).toEqual(hues({ ...forest, fontFamily: PAGE_FONT }));
  });

  // mermaid's merge ignores a later directive's object where an earlier one set a value
  it('keeps an author’s colour and face a later directive sets to an object', async () => {
    const forest = ownVariables('forest', { primaryColor: '#ffeeaa', fontFamily: 'Georgia' });
    const { config } = await renderedAfterTranscript(
      '%%{init: {"theme": "forest", "themeVariables": {"primaryColor": "#ffeeaa", "fontFamily": "Georgia"}}}%%\n%%{init: {"themeVariables": {"primaryColor": {}, "fontFamily": {}}}}%%\ngraph TD\n  A --> B',
    );
    expect(config.themeVariables).toMatchObject({ primaryColor: '#ffeeaa', fontFamily: 'Georgia' });
    expect(hues(config.themeVariables)).toEqual(hues(forest));
  });
});

// Pinning a named theme's colours is best-effort: when it fails, the diagram draws as it did before the ruling.
describe('a document diagram whose theme cannot be pinned', () => {
  const FOREST = '---\nconfig:\n  theme: forest\n---\ngraph TD\n  A --> B';
  const BEFORE = withPage(FOREST, { theme: 'base', fontFamily: PAGE_FONT, themeVariables: PAGE_PALETTE });

  it('draws as before the ruling when reading the theme’s colours throws', async () => {
    const initialize = mermaid.initialize.bind(mermaid);
    vi.spyOn(mermaid, 'initialize').mockImplementation((config) => {
      if (config.theme === 'forest') throw new Error('the theme cannot be read');
      initialize(config);
    });
    const { source } = await renderedAfterTranscript(FOREST);
    expect(source).toBe(BEFORE);
  });

  it('draws as before the ruling when mermaid rejects the pinned source', async () => {
    const render = vi.spyOn(mermaid, 'render');
    render.mockImplementation(async (_id, text) => {
      if (text !== BEFORE) throw new Error('rejected');
      return { svg: '<svg data-before=""></svg>', diagramType: 'flowchart-v2' } as Awaited<ReturnType<typeof mermaid.render>>;
    });
    expect(await renderMermaid(FOREST, onPage())).toBe('<svg data-before=""></svg>');
    expect(render.mock.calls.map(([, text]) => text === BEFORE)).toEqual([false, true]);
  });

  // the transcript configures mermaid only on its plugin's first diagram, so its later ones draw in what a document left
  it('leaves mermaid configured as before the ruling', async () => {
    await renderedAfterTranscript(FOREST, false);
    const site = mermaid.mermaidAPI.getSiteConfig();
    expect(site.theme).toBe('base');
    expect(site.themeVariables).toMatchObject({ ...PAGE_PALETTE, fontFamily: PAGE_FONT });
  });
});

it('hands mermaid a source whose front matter cannot be read as written, for mermaid to judge', async () => {
  const source = '---\nconfig:\n  theme: [forest\n---\ngraph TD\n  A --> B';
  const render = vi.spyOn(mermaid, 'render').mockResolvedValue({ svg: '<svg></svg>', diagramType: 'flowchart-v2' } as Awaited<ReturnType<typeof mermaid.render>>);
  await renderMermaid(source, onPage());
  expect(render.mock.calls[0]?.[1]).toBe(source);
});

// mermaid reads a directive's single quotes as double quotes, so a face named with one must not break the directive (the
// source is built directly: happy-dom's style parser mangles such a name before the page could hand it over)
it('hands mermaid a face whose name holds an apostrophe', async () => {
  const face = '"Bob\'s Grotesk", sans-serif';
  await mermaid.parse(withPage('graph TD\n  A --> B', { theme: 'base', fontFamily: face, themeVariables: { primaryColor: 'rgb(250, 249, 246)' } }));
  const config = mermaid.mermaidAPI.getConfig();
  expect(config.fontFamily).toBe(face);
  expect(config.themeVariables).toMatchObject({ primaryColor: 'rgb(250, 249, 246)', fontFamily: face });
});
