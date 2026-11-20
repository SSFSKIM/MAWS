// What a Markdown file is (UX wave U6b-4c, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, decision
// 5, Interfaces §A): the one test the window's viewer draws a file as rendered Markdown by (`kindOf`,
// tools/code/viewer/kinds.ts), and the daemon's follow takes a source's links from, so the daemon calls a Markdown file
// what the window draws as one. Pure, no Node imports: the renderer bundles this module.
import { extensionOf } from './mime';

export const MARKDOWN_RENDER_CAP = 1024 * 1024; // a Markdown file past this is shown as its source, and links nothing

const MARKDOWN = new Set(['md', 'mdx', 'markdown']);

/** Whether a file of this name is drawn as Markdown: its extension is `md`, `mdx` or `markdown` (`extensionOf`). */
export function isMarkdownName(name: string): boolean {
  return MARKDOWN.has(extensionOf(name));
}
