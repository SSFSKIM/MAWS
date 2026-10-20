// The Notion export: a document as Notion's enhanced Markdown (`notion://docs/enhanced-markdown-spec`, what the hosted
// MCP server's `notion-create-pages` reads as a page's content), checked as the exact text Notion reads: one block per
// line with children a tab deeper, Notion's XML forms for tables and callouts, its escaping, and the placeholders for
// what Notion cannot hold.
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { everyKindSource, sourceOf } from '../convert.fixture';
import { CALLOUT_TONES, schemaFor } from '../schema';
import { exportNotionMarkdown } from './notion';
import type { ExportSource, ViewRenderer } from './source';

type Marks = JSONContent['marks'];
const t = (text: string, marks?: Marks): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const ul = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items });
const row = (...cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells });
const th = (...content: JSONContent[]): JSONContent => ({ type: 'tableHeader', content });
const td = (...content: JSONContent[]): JSONContent => ({ type: 'tableCell', content });
const image = (src: string, alt: string | null): JSONContent => ({ type: 'image', attrs: { src, alt, assetId: null } });
const bold = [{ type: 'bold' }];
const notion = (...blocks: JSONContent[]): string => exportNotionMarkdown(sourceOf(blocks));

describe('exportNotionMarkdown', () => {
  it('writes one block per line, an empty paragraph as <empty-block/>, and no trailing empty paragraph', () => {
    expect(notion(p(t('One')), p(), p(t('  ')), p(t('Two')), p(), p())).toBe('One\n<empty-block/>\n<empty-block/>\nTwo\n');
  });

  it('writes headings 1 to 4, a level 5 or 6 as 4, its text with no marker escaped', () => {
    const headings = [1, 2, 3, 4, 5, 6].map((level) => ({ type: 'heading', attrs: { level }, content: [t(`1. Level ${level}`)] }));
    expect(notion(...headings)).toBe('# 1. Level 1\n## 1. Level 2\n### 1. Level 3\n#### 1. Level 4\n#### 1. Level 5\n#### 1. Level 6\n');
  });

  it('writes the marks Notion has, and the text of the marks it has not', () => {
    const md = notion(
      p(
        t('Plain '),
        t('bold', bold),
        t(' '),
        t('it', [{ type: 'italic' }]),
        t(' '),
        t('gone', [{ type: 'strike' }]),
        t(' '),
        t('under', [{ type: 'underline' }]),
        t(' '),
        t('a*b [c]', [{ type: 'code' }]),
        t(' '),
        t('a`b', [{ type: 'code' }]),
        t(' '),
        t('link', [{ type: 'link', attrs: { href: 'https://example.com/a file (draft).pdf', title: 'T' } }]),
        t(' '),
        t('mail', [{ type: 'link', attrs: { href: 'mailto:a@example.com' } }]),
        t(' '),
        t('relative', [{ type: 'link', attrs: { href: '/docs/x' } }]),
        t(' '),
        t('lit', [{ type: 'highlight', attrs: { color: '#bfdbfe' } }]),
        t(' '),
        t('commented', [{ type: 'comment', attrs: { threadId: 't1' } }]),
        t(' '),
        t('inserted', [{ type: 'y-attributed-insert', attrs: { userIds: ['u'] } }]),
      ),
    );
    expect(md).toBe(
      'Plain **bold** *it* ~~gone~~ <span underline="true">under</span> `a*b [c]` `` a`b `` ' +
        '[link](https://example.com/a%20file%20%28draft%29.pdf) [mail](mailto:a@example.com) relative ' +
        '<span color="yellow_bg">lit</span> commented inserted\n',
    );
  });

  it('keeps a mark open across runs, and writes a run’s edge spaces outside its marks', () => {
    expect(notion(p(t('a '), t('bold ', bold), t('both', [...bold, { type: 'italic' }]), t(' end', bold), t('.')))).toBe('a **bold *both* end**.\n');
    expect(notion(p(t('x'), t(' spaced ', bold), t('y')))).toBe('x **spaced** y\n');
    expect(notion(p(t('a', bold), { type: 'hardBreak', marks: bold }, t('b', bold)))).toBe('**a<br>b**\n');
  });

  it('writes a line ending inside text and a hard break as <br>, inside inline code too', () => {
    expect(notion(p(t('one\ntwo'), { type: 'hardBreak' }, t('three ')), p(t('x\ny', [{ type: 'code' }])))).toBe('one<br>two<br>three\n`x<br>y`\n');
  });

  it('escapes Notion’s markup characters outside code, and a block’s leading marker', () => {
    const md = notion(
      p(t('\\ * ~ ` $ [ ] < > { } | ^ and <br> and {color="red"}')),
      p(t('# not a heading')),
      p(t('- not a list')),
      p(t('+ nor this')),
      p(t('12. not numbered')),
      p(t('---')),
      p(t('> not a quote')),
      p(t('\tindented, a # b - c 1. d')),
      ul(li(p(t('- dash')))),
      { type: 'codeBlock', attrs: { language: null }, content: [t('a * [b] <c> $d')] },
    );
    expect(md.split('\n')).toEqual([
      String.raw`\\ \* \~ \` \$ \[ \] \< \> \{ \} \| \^ and \<br\> and \{color="red"\}`,
      String.raw`\# not a heading`,
      String.raw`\- not a list`,
      String.raw`\+ nor this`,
      String.raw`12\. not numbered`,
      String.raw`\---`,
      String.raw`\> not a quote`,
      'indented, a # b - c 1. d', // a leading tab would make it a child block
      String.raw`- \- dash`,
      '```',
      'a * [b] <c> $d',
      '```',
      '',
    ]);
  });

  it('writes lists with their children a tab deeper: nested lists and an item’s further blocks', () => {
    const md = notion(
      ul(
        li(p(t('One')), p(t('More')), { type: 'codeBlock', attrs: { language: 'js' }, content: [t('x\ny')] }, ul(li(p(t('Nested')), { type: 'orderedList', content: [li(p(t('Deep')))] }))),
        li(p(t('Two'))),
        li(ul(li(p(t('A list first'))))),
      ),
      { type: 'orderedList', attrs: { start: 3 }, content: [li(p(t('Third'))), li(p(t('Fourth')))] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: false }, content: [p(t('Open'))] },
          { type: 'taskItem', attrs: { checked: true }, content: [p(t('Done')), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p(t('Sub'))] }] }] },
        ],
      },
    );
    expect(md).toBe(
      [
        '- One',
        '\tMore',
        '\t```javascript',
        '\tx',
        '\ty',
        '\t```',
        '\t- Nested',
        '\t\t1. Deep',
        '- Two',
        '- ',
        '\t- A list first',
        '3. Third',
        '4. Fourth',
        '- [ ] Open',
        '- [x] Done',
        '\t- [ ] Sub',
        '',
      ].join('\n'),
    );
  });

  it('writes a quote as one > line, its paragraphs joined by <br> and its other blocks its children', () => {
    const md = notion({ type: 'blockquote', content: [p(t('One')), p(t('- Two')), ul(li(p(t('Point')))), p(t('After'))] }, { type: 'blockquote', content: [p(t('Another'))] });
    expect(md).toBe('> One<br>- Two\n\t- Point\n\tAfter\n> Another\n');
  });

  it('writes code fenced with its language (Notion’s name for it), unescaped, the fence longer than any it holds', () => {
    const md = notion(
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = [1] // *x*')] },
      { type: 'codeBlock', attrs: { language: 'Python' }, content: [t('print(1)')] },
      { type: 'codeBlock', attrs: { language: 'md' }, content: [t('```\ninner\n```')] },
      { type: 'diagram', attrs: { source: 'graph TD\n  A["x (y)"] --> B' } },
    );
    expect(md).toBe('```typescript\nconst a = [1] // *x*\n```\n```python\nprint(1)\n```\n````markdown\n```\ninner\n```\n````\n```mermaid\ngraph TD\n  A["x (y)"] --> B\n```\n');
  });

  it('writes a divider, block math and inline math', () => {
    const md = notion(
      { type: 'horizontalRule' },
      { type: 'mathBlock', attrs: { latex: 'a^2\n+ b^2' } },
      { type: 'mathBlock', attrs: { latex: 'a\n$$\nb' } }, // a `$$` line would close the block
      p(t('Energy '), { type: 'math', attrs: { latex: 'E = mc^2' } }, t(' and '), { type: 'math', attrs: { latex: 'x^2\n+ 1' } }),
    );
    expect(md).toBe('---\n$$\na^2\n+ b^2\n$$\n$$\na $$ b\n$$\nEnergy $`E = mc^2`$ and $`x^2 + 1`$\n');
  });

  it('writes a table in its XML form: the header row, each cell’s blocks as rich text joined by <br>', () => {
    const md = notion({
      type: 'table',
      content: [row(th(p(t('Name'))), th(p(t('Note')))), row(td(p(t('alpha'))), td(p(t('one')), p(t('two | *2*')), ul(li(p(t('listed'))))))],
    });
    expect(md).toBe(
      [
        '<table header-row="true">',
        '\t<tr>',
        '\t\t<td>Name</td>',
        '\t\t<td>Note</td>',
        '\t</tr>',
        '\t<tr>',
        '\t\t<td>alpha</td>',
        String.raw`		<td>one<br>two \| \*2\*<br>• listed</td>`,
        '\t</tr>',
        '</table>',
        '',
      ].join('\n'),
    );
  });

  it('writes a table without a header row, with a header column, and spans on a rectangular grid', () => {
    expect(notion({ type: 'table', content: [row(td(p(t('a'))), td(p(t('b'))))] })).toMatch(/^<table header-row="false">\n/);
    expect(notion({ type: 'table', content: [row(th(p(t('Row'))), td(p(t('1')))), row(th(p(t('Other'))), td(p(t('2'))))] })).toMatch(/^<table header-row="false" header-column="true">\n/);
    const spanned = notion({
      type: 'table',
      content: [
        row({ type: 'tableHeader', attrs: { colspan: 2 }, content: [p(t('Quarter'))] }),
        row({ type: 'tableCell', attrs: { rowspan: 2 }, content: [p(t('First'))] }, td(p(t('Right')))),
        row(td(p(t('Last')))),
      ],
    });
    const cells = [...spanned.matchAll(/<tr>\n((?:\t\t<td>.*<\/td>\n)+)\t<\/tr>/g)].map((match) => [...match[1].matchAll(/<td>(.*)<\/td>/g)].map((cell) => cell[1]));
    expect(cells).toEqual([
      ['Quarter', ''],
      ['First', 'Right'],
      ['', 'Last'],
    ]);
    expect(spanned).toMatch(/^<table header-row="true">/);
  });

  it('writes a callout as its XML block with its tone’s icon, its blocks a tab deeper', () => {
    const md = notion({ type: 'callout', attrs: { tone: 'warn' }, content: [p(t('Mind the gap.')), ul(li(p(t('Step'))))] }, ul(li(p(t('Item')), { type: 'callout', attrs: { tone: 'tip' }, content: [p(t('Inside'))] })));
    expect(md).toBe('<callout icon="⚠️" color="yellow_bg">\n\tMind the gap.\n\t- Step\n</callout>\n- Item\n\t<callout icon="💡" color="green_bg">\n\t\tInside\n\t</callout>\n');
    const heads = CALLOUT_TONES.map((tone) => notion({ type: 'callout', attrs: { tone }, content: [p(t('x'))] }).split('\n')[0]);
    expect(new Set(heads).size).toBe(CALLOUT_TONES.length);
  });

  it('writes an image Notion can fetch as an image block of its own, and any other as a placeholder', () => {
    const md = notion(
      p(t('See '), image('https://example.com/a.png', 'A [chart]'), t(' below')),
      p({ type: 'image', attrs: { src: 'assets/diagram.png', alt: 'Diagram', assetId: 'as1' } }),
      p(image('data:image/png;base64,AAAA', null)),
      p(t('An uploaded '), image('maws-artifact://asset/as1', ''), t('.')),
      ul(li(p(t('Item '), image('https://example.com/b.png', 'B')))),
      { type: 'heading', attrs: { level: 2 }, content: [t('Figure '), image('https://example.com/c.png', null)] },
      { type: 'table', content: [row(td(p(image('https://example.com/d.png', 'D'), image('assets/e.png', 'E'))))] },
    );
    const lines = md.split('\n');
    expect(lines.slice(0, 8)).toEqual([
      'See',
      String.raw`![A \[chart\]](https://example.com/a.png)`,
      'below',
      String.raw`\[Image: Diagram\]`,
      String.raw`\[Image: image\]`,
      String.raw`An uploaded \[Image: image\].`,
      '- Item',
      '\t![B](https://example.com/b.png)',
    ]);
    expect(lines[8]).toBe('## Figure [Image](https://example.com/c.png)');
    expect(md).toContain(String.raw`<td>[D](https://example.com/d.png)\[Image: E\]</td>`);
  });

  it('writes a chart as its drawn view’s Markdown where it is, else a placeholder by its title', () => {
    const chart = (spec: unknown): JSONContent => ({ type: 'chart', attrs: { source: 'sales', spec } });
    const placeholders = notion(chart({ view: 'bar', title: 'Sales by region' }), chart('{"view":"table","title":"As text"}'), chart(null), chart('not json'));
    expect(placeholders).toBe(String.raw`\[Chart: Sales by region\]` + '\n' + String.raw`\[Chart: As text\]` + '\n' + String.raw`\[Chart: chart\]` + '\n' + String.raw`\[Chart: chart\]` + '\n');
    const source = sourceOf([chart({ title: 'Drawn' }), ul(li(p(t('Quoted')), chart({ title: 'Nested' }))), chart({ title: 'Undrawn' })]);
    const renderView: ViewRenderer = (node) => {
      const title = (node.attrs.spec as { title: string }).title;
      return title === 'Undrawn' ? undefined : { caption: title, sourceLabel: 'sales', markdown: `**${title}**\n\n| a |\n| --- |`, svg: '<svg/>', width: 1, height: 1 };
    };
    expect(exportNotionMarkdown(source, { renderView })).toBe('**Drawn**\n\n| a |\n| --- |\n- Quoted\n\t**Nested**\n\n\t| a |\n\t| --- |\n' + String.raw`\[Chart: Undrawn\]` + '\n');
  });

  it('writes a chip, and a pending section, as what it shows', () => {
    const md = notion(
      p(
        t('Due '),
        { type: 'date', attrs: { iso: '2026-10-12' } },
        t(', '),
        { type: 'mention', attrs: { kind: 'person', ref: 'u1', label: '*Ops*' } },
        t(', '),
        { type: 'dropdown', attrs: { options: ['Todo', 'Doing'], value: 'Doing' } },
      ),
      { type: 'pending', attrs: { intent: 'Write the risks' } },
    );
    expect(md).toBe(String.raw`Due Oct 12, 2026, \*Ops\*, Doing` + '\n' + String.raw`\[Pending: Write the risks\]` + '\n');
  });

  it('introduces each tab by its title as a heading 1 when there are several, and never writes the page title', () => {
    const schema = schemaFor();
    const body = (text: string) => schema.nodeFromJSON({ type: 'doc', content: [p(t(text))] });
    const source: ExportSource = {
      title: 'The page',
      tabs: [
        { id: 'a', title: 'First *tab*', body: body('One') },
        { id: 'b', title: '', body: body('Two') },
      ],
      threads: [],
      overrides: {},
    };
    expect(exportNotionMarkdown(source)).toBe(String.raw`# First \*tab\*` + '\nOne\n# Untitled\nTwo\n');
    expect(exportNotionMarkdown(source, { tab: 'b' })).toBe('Two\n');
    expect(() => exportNotionMarkdown(source, { tab: 'nope' })).toThrow(/no tab nope/);
  });

  it('degrades a node it has no form for to its content', () => {
    expect(notion(row(td(p(t('stray'))), td(p(t('cells')))))).toBe('stray\ncells\n');
  });

  it('writes every kind of the schema with tabs for structure and no blank line outside code', () => {
    const md = exportNotionMarkdown(everyKindSource());
    let fence: RegExp | null = null;
    for (const line of md.slice(0, -1).split('\n')) {
      if (fence) {
        if (fence.test(line)) fence = null;
        continue;
      }
      expect(line).toMatch(/^\t*\S/);
      const open = /^\t*(`{3,}|\$\$)/.exec(line);
      if (open) fence = open[1] === '$$' ? /^\t*\$\$$/ : new RegExp(`^\\t*${open[1]}$`);
    }
    expect(fence).toBeNull();
    for (const part of ['# Overview\n# Every kind\n', '\n- [x] Done task\n', '\n> A quoted line.<br>A second quoted line.\n', '\n<callout icon="⚠️" color="yellow_bg">\n\tMind the gap.\n</callout>\n', '\n# Notes\n## 회의 메모\n'])
      expect(md).toContain(part);
    expect(md).not.toContain('maws-artifact://');
  });
});
