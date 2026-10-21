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
// source pins every colour of its own.
import type { Mermaid } from 'mermaid';
import type { Page } from './mermaid-source';

type MermaidPlugin = ReturnType<(typeof import('@streamdown/mermaid'))['createMermaidPlugin']>;
type Source = typeof import('./mermaid-source');

let loaded: Promise<[MermaidPlugin, Mermaid, Source]> | null = null;
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

const SETTINGS = { securityLevel: 'strict', suppressErrorRendering: true } as const;

// The page for a diagram whose author names a theme: that theme's own colours as the author's variables colour it, read
// from mermaid. Best-effort: null when the author names none, and on any failure, the diagram then drawn as before the
// ruling. Mermaid's own parse reads the author's theme and variables (merged and checked as its render will), and only
// the strings a directive can carry come back out, so nothing the author wrote reaches mermaid's configuration.
async function themedPage(source: string, fontFamily: string, plugin: MermaidPlugin, mermaid: Mermaid, module: Source, configure: () => void): Promise<Page | null> {
  if (!/\btheme\b/.test(source)) return null;
  try {
    const parsed = await mermaid.parse(module.besideInit(source), { suppressErrors: true });
    const theme = parsed ? module.namedTheme(parsed.config) : null;
    if (!parsed || !theme) return null;
    try {
      plugin.getMermaid({ ...SETTINGS, theme, themeVariables: { fontFamily, ...parsed.config.themeVariables } });
      return { theme, fontFamily, themeVariables: module.pinnable(mermaid.mermaidAPI.getSiteConfig().themeVariables) };
    } finally {
      // the page's configuration back in the same turn, so no render starts under the theme's, and the transcript's
      // diagrams, which configure mermaid only on their plugin's first, draw in what they did before the ruling
      configure();
    }
  } catch {
    return null;
  }
}

export async function renderMermaid(source: string, into: HTMLElement): Promise<string> {
  loaded ??= Promise.all([
    import('@streamdown/mermaid').then((module) => module.createMermaidPlugin()),
    import('mermaid').then((module) => module.default),
    import('./mermaid-source'),
  ]);
  const themeVariables = themeOf(into);
  const { fontFamily, ...colours } = themeVariables;
  const [plugin, mermaid, module] = await loaded;
  const configure = () => plugin.getMermaid({ ...SETTINGS, theme: 'base', themeVariables });
  const before: Page = { theme: 'base', fontFamily, themeVariables: colours };
  const draw = async (page: Page) => (await configure().render(`doc-diagram-${(n += 1)}`, module.withPage(source, page))).svg;
  const themed = await themedPage(source, fontFamily, plugin, mermaid, module, configure);
  if (!themed) return draw(before);
  try {
    return await draw(themed);
  } catch {
    return draw(before); // as before the ruling; its rejection, if any, is mermaid's own
  }
}
