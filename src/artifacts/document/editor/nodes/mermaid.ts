// Diagrams drawn by mermaid, loaded on the first diagram a document shows (about 2.5 MB; a document without one never
// loads it), through `@streamdown/mermaid`'s plugin as the transcript loads it (M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md). Mermaid's `base` theme takes its palette from the element the
// diagram is drawn in, whose computed colours are the document's `--ds-*` tokens or their app fallbacks, so a diagram
// follows the document's design system.
// P3-F (sitting candidate 20): mermaid is one module-wide instance, and the transcript configures it too, in the app's
// palette. A configuration holds until the next one, so a render waiting in mermaid's queue behind a transcript diagram
// was drawn in the dark app's colours on a light page. The page's colours therefore also ride in the diagram's own init
// directive, which mermaid applies over whatever configuration it holds at the start of that render; an init directive
// the source writes itself comes after it and wins. A front matter's `config` is the author's too, but mermaid applies
// any directive over it, so a source whose front matter configures it gets no palette directive and its own settings
// win over the configuration's palette, as before. The face stays in the configuration alone: mermaid blanks a
// directive's theme value holding a `-` (`-apple-system`).
type MermaidPlugin = ReturnType<(typeof import('@streamdown/mermaid'))['createMermaidPlugin']>;

let plugin: Promise<MermaidPlugin> | null = null;
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

// mermaid's own front matter pattern: a front matter must open the source, so the directive goes after it
const FRONT_MATTER = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;

function withPalette(source: string, palette: Record<string, string>): string {
  const colours = Object.fromEntries(Object.entries(palette).filter(([name]) => name !== 'fontFamily'));
  const front = FRONT_MATTER.exec(source);
  // a top-level `config` key at the front matter's own indent (mermaid reads its lines with that indent removed)
  if (front && new RegExp(`^${front[1]}["']?config["']?[^\\S\\n\\r]*:`, 'm').test(front[2])) return source;
  const head = front?.[0] ?? '';
  return `${head}%%{init: ${JSON.stringify({ theme: 'base', themeVariables: colours })}}%%\n${source.slice(head.length)}`;
}

export async function renderMermaid(source: string, into: HTMLElement): Promise<string> {
  plugin ??= import('@streamdown/mermaid').then((module) => module.createMermaidPlugin());
  const themeVariables = themeOf(into);
  const mermaid = (await plugin).getMermaid({ securityLevel: 'strict', suppressErrorRendering: true, theme: 'base', themeVariables });
  n += 1;
  const { svg } = await mermaid.render(`doc-diagram-${n}`, withPalette(source, themeVariables));
  return svg;
}
