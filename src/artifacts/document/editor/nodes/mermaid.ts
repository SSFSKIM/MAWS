// Diagrams drawn by mermaid, loaded on the first diagram a document shows (about 2.5 MB; a document without one never
// loads it), through `@streamdown/mermaid`'s plugin as the transcript loads it (M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md). Mermaid's `base` theme takes its palette from the element the
// diagram is drawn in, whose computed colours are the document's `--ds-*` tokens or their app fallbacks, so a diagram
// follows the document's design system.
// P3-F (sitting candidate 20): mermaid is one module-wide instance, and the transcript configures it too, in the app's
// palette and face. A configuration holds until the next one, so a render waiting in mermaid's queue behind a transcript
// diagram was drawn in the dark app's colours on a light page. The page's palette and face therefore also ride in the
// diagram's own source (mermaid-source.ts), which mermaid reads over whatever configuration it holds at the start of that
// render: under the author's front matter config, and before an init directive the source writes itself, so both win.
type MermaidPlugin = ReturnType<(typeof import('@streamdown/mermaid'))['createMermaidPlugin']>;

let loaded: Promise<[MermaidPlugin, typeof import('./mermaid-source')]> | null = null;
let n = 0;

function themeOf(into: HTMLElement): Record<string, string> {
  const style = getComputedStyle(into);
  const page = getComputedStyle(into.closest('.ds-doc') ?? into);
  return {
    background: page.backgroundColor,
    primaryColor: page.backgroundColor,
    // the base theme's own derivations, set here so another caller's (the transcript's accent and hover) never show
    secondaryColor: page.backgroundColor,
    tertiaryColor: page.backgroundColor,
    primaryTextColor: style.color,
    primaryBorderColor: style.color,
    lineColor: style.color,
    textColor: style.color,
    fontFamily: style.fontFamily,
  };
}

export async function renderMermaid(source: string, into: HTMLElement): Promise<string> {
  loaded ??= Promise.all([import('@streamdown/mermaid').then((module) => module.createMermaidPlugin()), import('./mermaid-source')]);
  const themeVariables = themeOf(into);
  const { fontFamily, ...colours } = themeVariables;
  const [plugin, { withPage }] = await loaded;
  const mermaid = plugin.getMermaid({ securityLevel: 'strict', suppressErrorRendering: true, theme: 'base', themeVariables });
  n += 1;
  const { svg } = await mermaid.render(`doc-diagram-${n}`, withPage(source, { fontFamily, themeVariables: colours }));
  return svg;
}
