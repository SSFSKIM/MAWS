// What a Markdown file is, for the window and the daemon alike (UX wave U6b-4c,
// docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, decision 5, Interfaces §A): the viewer draws such a
// file as rendered Markdown, and the daemon follows a link only out of one. Every name here is invented.
import { describe, expect, it } from 'vitest';
import { isMarkdownName, MARKDOWN_RENDER_CAP } from './markdown';

describe('isMarkdownName', () => {
  it.each(['guide.md', '/work/docs/guide.md', 'notes.MD', 'page.mdx', '/a/b/c.markdown', '/a/my notes.Markdown', '/a/.hidden/x.md', 'a.b.md'])('%j is a Markdown name', (name) => {
    expect(isMarkdownName(name)).toBe(true);
  });

  it.each(['notes.txt', 'README', 'guide.md.bak', '/work/.md', '.md', 'md', 'page.mdown', 'guide.md/', '/work/guide.md/notes', 'guide.md#usage', ''])('%j is not', (name) => {
    expect(isMarkdownName(name)).toBe(false);
  });
});

describe('MARKDOWN_RENDER_CAP', () => {
  it('is one mebibyte: a Markdown file past it is shown as its source, and links nothing', () => {
    expect(MARKDOWN_RENDER_CAP).toBe(1024 * 1024);
  });
});
