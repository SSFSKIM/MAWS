// Diagrams drawn by mermaid, loaded on the first diagram a document shows (about 2.5 MB; a document without one never
// loads it), through `@streamdown/mermaid`'s plugin as the transcript loads it (M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md). Mermaid's `base` theme takes its palette from the element the
// diagram is drawn in, whose computed colours are the document's `--ds-*` tokens or their app fallbacks, so a diagram
// follows the document's design system; one whose author names a theme keeps that theme's colours (the owner's ruling,
// 2026-10-21), in the page's face.
// P3-F (sitting candidate 20): mermaid is one module-wide instance, and the transcript configures it too, in the app's
// palette and face. A configuration holds until the next one, so a render waiting in mermaid's queue behind a transcript
// diagram was drawn in the dark app's colours on a light page. The face and the palette therefore also ride in the
// diagram's own source (mermaid-source.ts), which mermaid reads over whatever configuration it holds at the start of that
// render: under the author's front matter config, and before an init directive the source writes itself, so both win. A
// named theme computes its colours over the last configuration's (mermaid's config.ts, updateCurrentConfig), so its
// source pins every colour of its own, read from mermaid as this render configured it.
import type { Mermaid } from 'mermaid';

type MermaidPlugin = ReturnType<(typeof import('@streamdown/mermaid'))['createMermaidPlugin']>;

let loaded: Promise<[MermaidPlugin, Mermaid, typeof import('./mermaid-source')]> | null = null;
let configKeys: ReadonlySet<string> | null = null; // the key names mermaid's directive check keeps
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
  loaded ??= Promise.all([
    import('@streamdown/mermaid').then((module) => module.createMermaidPlugin()),
    import('mermaid').then((module) => module.default),
    import('./mermaid-source'),
  ]);
  const themeVariables = themeOf(into);
  const { fontFamily, ...colours } = themeVariables;
  const [plugin, mermaid, { authorTheme, configKeysOf, pinnable, withPage }] = await loaded;
  configKeys ??= configKeysOf(mermaid.mermaidAPI.defaultConfig);
  const named = authorTheme(source, configKeys);
  const settings = { securityLevel: 'strict', suppressErrorRendering: true } as const;
  let page;
  let drawer;
  if (named) {
    // the theme as the author's own variables colour it, in the page's face, which then holds even when mermaid drops every
    // init directive for a malformed one of the author's; read back at once, before anything else can configure mermaid
    drawer = plugin.getMermaid({ ...settings, theme: named.theme, themeVariables: { fontFamily, ...named.themeVariables } });
    page = { theme: named.theme, fontFamily, themeVariables: pinnable(mermaid.mermaidAPI.getSiteConfig().themeVariables) };
  } else {
    drawer = plugin.getMermaid({ ...settings, theme: 'base', themeVariables });
    page = { theme: 'base' as const, fontFamily, themeVariables: colours };
  }
  n += 1;
  const { svg } = await drawer.render(`doc-diagram-${n}`, withPage(source, page));
  return svg;
}
