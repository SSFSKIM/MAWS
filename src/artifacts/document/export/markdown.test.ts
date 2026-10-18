// The Markdown export (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12): the lossless dialect with ids
// and comment milestones off, so a file read back gives the content it was written from; a line ending inside text and
// a line break, written for a reader, are judged by how a CommonMark reader renders them (the parent's ruling of
// 2026-10-18, P3-F tracker L166).
import { Marked } from 'marked';
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

  // the parent's ruling of 2026-10-18: a reader's export is judged by its rendering. Rendered by marked, the GFM reader
  // the dialect itself parses with: a heading's, a table cell's and a block's last line ending each render as <br>
  it('renders each line ending as a line break in a reader: in a heading, in a table cell and at a block’s end', () => {
    const md = exportMarkdown(
      sourceOf([
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'One\nTwo' }] },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first\nsecond' }] }] }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Ends here\n' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Goes\non' }, { type: 'hardBreak' }, { type: 'text', text: 'and on' }, { type: 'hardBreak' }] },
      ]),
    );
    const html = new Marked({ gfm: true }).parse(md) as string;
    expect(html).toContain('<h2>One<br>Two</h2>');
    expect(html).toMatch(/<td>first<br>second<\/td>/);
    expect(html).toContain('<p>Ends here<br></p>');
    expect(html).toMatch(/<p>Goes<br>\s*on<br>\s*and on<br><\/p>/);
    expect(html).not.toMatch(/&amp;#10;|:::/);
  });

  // a GFM row writes a cell's line ending as <br>, which inside inline code is literal text: multiline inline code keeps
  // the structure-block table it had before the reader's relaxation
  it('keeps multiline inline code in a table cell out of the reader’s pipe row: never a <br> inside code', () => {
    const md = exportMarkdown(
      sourceOf([
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first\nsecond', marks: [{ type: 'code' }] }] }] }] }],
        },
      ]),
    );
    const html = new Marked({ gfm: true }).parse(md) as string;
    expect(html).not.toContain('&lt;br&gt;');
    expect(md).not.toMatch(/^\|.*\|$/m);
    expect(html).toMatch(/<code>first\ssecond<\/code>/);
  });

  // CommonMark drops a block's whitespace-only last line, so a break before it ends the block: it must be <br>, as at
  // the block's end, not a backslash the reader then sees
  it('renders a block’s last line ending or break as a line break when only whitespace follows it, never a literal backslash', () => {
    const md = exportMarkdown(
      sourceOf([
        { type: 'paragraph', content: [{ type: 'text', text: 'one\n ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two\n\t' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'three' }, { type: 'hardBreak' }, { type: 'text', text: ' ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'four\n' }, { type: 'text', text: ' ', marks: [{ type: 'italic' }] }, { type: 'text', text: '\t' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'five\n  ' }] }] }] },
      ]),
    );
    const html = new Marked({ gfm: true }).parse(md) as string;
    expect(html).not.toContain('\\');
    expect(html).toMatch(/<p>one<br>\s*<\/p>/);
    expect(html).toMatch(/<p>two<br>\s*<\/p>/);
    expect(html).toMatch(/<p>three<br>\s*<\/p>/);
    expect(html).toMatch(/<p>four<br>\s*<em> <\/em>\s*<\/p>/); // a marked space is the line's content: the break stays a break
    expect(html).toMatch(/<li>five<br>\s*<\/li>/);
  });

  it('refuses a tab the document does not have', () => {
    expect(() => exportMarkdown(everyKindSource(), { tab: 'nope' })).toThrow(/no tab nope/);
  });
});
