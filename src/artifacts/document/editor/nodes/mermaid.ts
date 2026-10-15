// Diagrams drawn by mermaid, loaded on the first diagram a document shows (about 2.5 MB; a document without one never
// loads it), through `@streamdown/mermaid`'s plugin as the transcript loads it (M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md). Mermaid's `base` theme takes its palette from the element the
// diagram is drawn in, whose computed colours are the document's `--ds-*` tokens or their app fallbacks, so a diagram
// follows the document's design system.
type MermaidPlugin = ReturnType<(typeof import('@streamdown/mermaid'))['createMermaidPlugin']>;

let plugin: Promise<MermaidPlugin> | null = null;
let n = 0;

function themeOf(into: HTMLElement): Record<string, string> {
  const style = getComputedStyle(into);
  const page = getComputedStyle(into.closest('.ds-doc') ?? into);
  return {
    background: page.backgroundColor,
    primaryColor: page.backgroundColor,
    primaryTextColor: style.color,
    primaryBorderColor: style.color,
    lineColor: style.color,
    textColor: style.color,
    fontFamily: style.fontFamily,
  };
}

export async function renderMermaid(source: string, into: HTMLElement): Promise<string> {
  plugin ??= import('@streamdown/mermaid').then((module) => module.createMermaidPlugin());
  const mermaid = (await plugin).getMermaid({ securityLevel: 'strict', suppressErrorRendering: true, theme: 'base', themeVariables: themeOf(into) });
  n += 1;
  const { svg } = await mermaid.render(`doc-diagram-${n}`, source);
  return svg;
}
