// The Markdown export (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12): the lossless dialect with ids
// and comment milestones off, so a file read back gives the content it was written from.
import { describe, expect, it } from 'vitest';
import { comparable, everyKindSource, sourceOf } from '../convert.fixture';
import { importMarkdown } from '../import/markdown';
import { exportMarkdown } from './markdown';

describe('exportMarkdown', () => {
  it('writes one tab without ids or comment milestones', () => {
    const source = everyKindSource();
    const md = exportMarkdown(source, { tab: 'tab-1' });
    const ids: string[] = [];
    source.tabs[0].body.descendants((node) => void (node.attrs.id && ids.push(String(node.attrs.id))));
    expect(ids.length).toBeGreaterThan(40);
    for (const id of ids) expect(md).not.toMatch(new RegExp(`\\^${id}\\b`));
    expect(md).not.toContain('<!-- ^');
    expect(md).not.toMatch(/<\/?c:t\d>/);
    expect(md).toContain('# Every kind');
    expect(md).toMatch(/^\| Name +\| Value +\|$/m); // GFM where GFM can carry the table
    expect(md.endsWith('\n')).toBe(true);
  });

  it('round-trips the every-kind fixture through the import', () => {
    const source = everyKindSource();
    const back = importMarkdown(exportMarkdown(source, { tab: 'tab-1' }));
    expect(comparable(back)).toEqual(comparable(source.tabs[0].body));
  });

  it('introduces each tab by its title when there are several', () => {
    const md = exportMarkdown(everyKindSource());
    expect(md.startsWith('# Overview\n\n# Every kind')).toBe(true);
    expect(md).toContain('\n\n# Notes\n\n## 회의 메모\n\n안녕하세요, 팀 여러분.');
  });

  it('escapes a tab title that would read as markup', () => {
    const source = everyKindSource();
    source.tabs[1].title = '1. *Draft*';
    const md = exportMarkdown(source);
    const notes = importMarkdown(md).content.content.find((block) => block.textContent === '1. *Draft*');
    expect(notes?.type.name).toBe('heading');
  });

  // P3-F W-DOC-B (tracker L166, the architect's export condition): a line ending inside text reaches the reader as a
  // line break, never as the agent read's `&#10;`, in a heading and at a block's end too, and nothing after it becomes
  // structure; code keeps its raw line ends. Read back through the import it is a hardBreak, or `<br>` as literal text:
  // the export's one inexact read-back, pinned here as it is
  it('writes a line ending inside text as a line break, never the escape, and makes no structure of what follows it', () => {
    const md = exportMarkdown(
      sourceOf([
        { type: 'paragraph', content: [{ type: 'text', text: 'Title\n---\n\n# not a heading\n- not a list' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'One\nTwo' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Ends with a line ending\n' }] },
        { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'x\n# y' }] },
      ]),
    );
    expect(md).not.toContain('&#10;');
    expect(md).toContain('\n\n## One<br>Two\n\n');
    expect(md).toContain('\n\nEnds with a line ending<br>\n\n');
    expect(md).toContain('```\nx\n# y\n```');
    const back = importMarkdown(md);
    expect(back.content.content.map((block) => block.type.name)).toEqual(['paragraph', 'heading', 'paragraph', 'codeBlock']);
    const lines: string[] = [];
    back.child(0).forEach((node) => lines.push(node.type.name === 'hardBreak' ? '\n' : (node.text ?? '')));
    expect(lines.join('')).toBe('Title\n---\n\n# not a heading\n- not a list');
    expect(back.child(1).textContent).toBe('One<br>Two');
    expect(back.child(2).textContent).toBe('Ends with a line ending<br>');
    expect(back.child(3).textContent).toBe('x\n# y');
  });

  it('refuses a tab the document does not have', () => {
    expect(() => exportMarkdown(everyKindSource(), { tab: 'nope' })).toThrow(/no tab nope/);
  });
});
