// The document's mermaid renderer (happy-dom; P3-F, sitting candidate 20). Mermaid is one module-wide instance, shared
// with the transcript, which configures it in the app's palette; the page's palette rides in each diagram's own init
// directive, so it holds whoever configured the instance last. Mermaid cannot lay out in happy-dom: its render is
// stubbed, and its own parse reads the configuration the directive leaves.
import mermaid from 'mermaid';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMermaid } from './mermaid';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

// A diagram's element on a light page.
function onPage(): HTMLElement {
  const page = document.body.appendChild(document.createElement('div'));
  page.className = 'ds-doc';
  page.style.color = 'rgb(31, 30, 27)';
  page.style.backgroundColor = 'rgb(250, 249, 246)';
  return page.appendChild(document.createElement('div'));
}

// The source mermaid was handed, once renderMermaid has drawn `source` on the page.
async function rendered(source: string): Promise<string> {
  const render = vi.spyOn(mermaid, 'render').mockResolvedValue({ svg: '<svg></svg>', diagramType: 'flowchart-v2' } as Awaited<ReturnType<typeof mermaid.render>>);
  await renderMermaid(source, onPage());
  expect(render).toHaveBeenCalledTimes(1);
  return render.mock.calls[0][1];
}

// The transcript's configuration in the dark app (plugins.ts's `mermaidThemeVariables`).
const DARK_APP = {
  theme: 'base',
  themeVariables: { background: '#1f1e1b', primaryColor: '#2c2b28', primaryTextColor: '#f5f4f0', primaryBorderColor: '#5a5955', secondaryColor: '#3a2a22', tertiaryColor: '#33322e', lineColor: '#a8a7a2', textColor: '#f5f4f0' },
} as const;

describe('a document diagram', () => {
  it('draws in the page’s palette after another caller configured mermaid in the dark app’s', async () => {
    const source = await rendered('graph TD\n  A[Start] --> B[Finish]');
    mermaid.initialize(DARK_APP); // the transcript draws a diagram of its own before this one's turn in mermaid's queue
    await mermaid.parse(source);
    expect(mermaid.mermaidAPI.getConfig().themeVariables).toMatchObject({
      background: 'rgb(250, 249, 246)',
      primaryColor: 'rgb(250, 249, 246)',
      secondaryColor: 'rgb(250, 249, 246)',
      tertiaryColor: 'rgb(250, 249, 246)',
      primaryTextColor: 'rgb(31, 30, 27)',
      primaryBorderColor: 'rgb(31, 30, 27)',
      lineColor: 'rgb(31, 30, 27)',
      textColor: 'rgb(31, 30, 27)',
    });
  });

  // P3-F (wave S review of c20): mermaid applies an init directive over a front matter's `config`, so a palette directive
  // would replace the author's theme there; a front matter that configures the diagram keeps it, as before c20
  it('leaves a front matter’s own theme configuration to win', async () => {
    const source = await rendered('---\nconfig:\n  theme: forest\n  themeVariables:\n    primaryColor: "#ffeeaa"\n---\ngraph TD\n  A --> B');
    expect(await mermaid.parse(source)).toMatchObject({ diagramType: 'flowchart-v2' });
    const config = mermaid.mermaidAPI.getConfig();
    expect(config.theme).toBe('forest');
    expect(config.themeVariables).toMatchObject({ primaryColor: '#ffeeaa' });
  });

  it('keeps a front matter first and lets the source’s own init directive win', async () => {
    const source = await rendered('---\ntitle: Flow\n---\n%%{init: {"themeVariables": {"primaryColor": "#ffeeaa"}}}%%\ngraph TD\n  A --> B');
    expect(source.startsWith('---\ntitle: Flow\n---\n')).toBe(true);
    mermaid.initialize(DARK_APP);
    expect(await mermaid.parse(source)).toMatchObject({ diagramType: 'flowchart-v2' });
    expect(mermaid.mermaidAPI.getConfig().themeVariables).toMatchObject({ primaryColor: '#ffeeaa', primaryTextColor: 'rgb(31, 30, 27)' });
  });
});
