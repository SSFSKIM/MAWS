// A tab body holding every stored node and mark of the schema (D2), with ids on every block, and the stored states GFM
// cannot say (merged, sized and multi-block cells, a table without a header row, an asset image, highlight colours,
// an object chart spec, code holding fences and literal milestones, edge spaces, no-break spaces, empty blocks): the
// parity checks (the Yjs round trip, the markdown round trip) and later the editor's every-kind checks read it. The
// `--attributed` variants and the `y-attributed-*` marks are render-only (the binding never stores them) and are not here.
import type { JSONContent } from '@tiptap/core';

const t = (text: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const p = (id: string, content: JSONContent[]): JSONContent => ({ type: 'paragraph', attrs: { id }, content });
const comment = (threadId: string) => ({ type: 'comment', attrs: { threadId } });

export const everyKindJSON = (): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [t('Every kind')] },
    { type: 'heading', attrs: { id: 'h2', level: 2 }, content: [t('Marks and chips')] },
    p('p1', [
      t('Plain, '),
      t('bold', [{ type: 'bold' }]),
      t(', '),
      t('italic', [{ type: 'italic' }]),
      t(', '),
      t('underline', [{ type: 'underline' }]),
      t(', '),
      t('strike', [{ type: 'strike' }]),
      t(', '),
      t('code', [{ type: 'code' }]),
      t(', a '),
      t('link', [{ type: 'link', attrs: { href: 'https://example.com/a', title: 'A title' } }]),
      t(' and '),
      t('highlight', [{ type: 'highlight', attrs: { color: null } }]),
      t('.'),
    ]),
    p('p2', [
      t('The plan '),
      t('ships quarterly with ', [comment('t1')]),
      t('design review', [comment('t1'), comment('t2')]),
      t(' notes', [comment('t2')]),
      t('. Owners track the budget.'),
    ]),
    p('p3', [
      t('Due '),
      { type: 'date', attrs: { iso: '2026-10-12' } },
      t(', owned by '),
      { type: 'mention', attrs: { kind: 'person', ref: 'owner', label: 'Owner' } },
      t(' in '),
      { type: 'mention', attrs: { kind: 'session', ref: 'session-1', label: 'Planning' } },
      t(', status '),
      { type: 'dropdown', attrs: { options: ['Todo', 'Doing', 'Done'], value: 'Doing' } },
      t('.'),
      { type: 'hardBreak' },
      t('Energy '),
      { type: 'math', attrs: { latex: 'E = mc^2' } },
      t(' and a figure '),
      { type: 'image', attrs: { src: 'https://example.com/figure.png', alt: 'A figure', assetId: null } },
      t('.'),
    ]),
    { type: 'heading', attrs: { id: 'h3', level: 3 }, content: [t('Blocks')] },
    {
      type: 'bulletList',
      attrs: { id: 'ul1' },
      content: [
        { type: 'listItem', attrs: { id: 'li1' }, content: [p('lp1', [t('First item')])] },
        {
          type: 'listItem',
          attrs: { id: 'li2' },
          content: [
            p('lp2', [t('Second item with '), t('bold', [{ type: 'bold' }])]),
            { type: 'bulletList', attrs: { id: 'ul2' }, content: [{ type: 'listItem', attrs: { id: 'li3' }, content: [p('lp3', [t('Nested item')])] }] },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { id: 'ol1', start: 3, type: null },
      content: [
        { type: 'listItem', attrs: { id: 'li4' }, content: [p('lp4', [t('Third')])] },
        { type: 'listItem', attrs: { id: 'li5' }, content: [p('lp5', [t('Fourth')])] },
      ],
    },
    {
      type: 'taskList',
      attrs: { id: 'tl1' },
      content: [
        { type: 'taskItem', attrs: { id: 'ti1', checked: false }, content: [p('tp1', [t('Open task')])] },
        { type: 'taskItem', attrs: { id: 'ti2', checked: true }, content: [p('tp2', [t('Done task')])] },
      ],
    },
    { type: 'blockquote', attrs: { id: 'q1' }, content: [p('qp1', [t('A quoted line.')]), p('qp2', [t('A second quoted line.')])] },
    { type: 'codeBlock', attrs: { id: 'c1', language: 'ts' }, content: [t('const x = 1\n'), t('console.log(x)', [comment('t3')])] },
    {
      type: 'table',
      attrs: { id: 'tb1' },
      content: [
        {
          type: 'tableRow',
          attrs: { id: 'tr0' },
          content: [
            { type: 'tableHeader', attrs: { id: 'th1', colspan: 1, rowspan: 1, colwidth: null }, content: [p('thp1', [t('Name')])] },
            { type: 'tableHeader', attrs: { id: 'th2', colspan: 1, rowspan: 1, colwidth: null }, content: [p('thp2', [t('Value')])] },
          ],
        },
        {
          type: 'tableRow',
          attrs: { id: 'tr1' },
          content: [
            { type: 'tableCell', attrs: { id: 'td1', colspan: 1, rowspan: 1, colwidth: null }, content: [p('tdp1', [t('alpha')])] },
            { type: 'tableCell', attrs: { id: 'td2', colspan: 1, rowspan: 1, colwidth: null }, content: [p('tdp2', [t('1')])] },
          ],
        },
      ],
    },
    { type: 'horizontalRule', attrs: { id: 'hr1' } },
    { type: 'callout', attrs: { id: 'co1', tone: 'warn' }, content: [p('cop1', [t('Mind the gap.')])] },
    { type: 'mathBlock', attrs: { id: 'mb1', latex: '\\int_0^1 x\\,dx = \\tfrac12' } },
    { type: 'diagram', attrs: { id: 'dg1', source: 'graph TD\n  A --> B' } },
    { type: 'chart', attrs: { id: 'ch1', source: 'sales.csv', spec: '{"mark":"bar"}' } },
    { type: 'pending', attrs: { id: 'pd1', intent: 'Write the risks section' } },
    // ── the states GFM has no syntax for (Decision Log 15): the dialect's own forms must give each back ──
    p('r1', [
      t('An '),
      t('amber', [{ type: 'highlight', attrs: { color: '#fde68a' } }]),
      t(' and a '),
      t('blue', [{ type: 'highlight', attrs: { color: '#bfdbfe' } }]),
      t(' highlight, '),
      t('bold with a space ', [{ type: 'bold' }]),
      t('then '),
      t('a`tick', [{ type: 'code' }]),
      t(', '),
      t('<c:literal>', [{ type: 'code' }]),
      t(', '),
      t('a filed link', [{ type: 'link', attrs: { href: 'https://example.com/a file (draft).pdf', title: 'Say "draft"' } }]),
      t(' and an uploaded '),
      { type: 'image', attrs: { src: 'maws-artifact://asset/as1', alt: '', assetId: 'as1' } },
      t('.'),
    ]),
    p('r2', [t('\u00A0\u00A0')]),
    p('r3', []),
    { type: 'codeBlock', attrs: { id: 'c2', language: 'md' }, content: [t('```\n<c:chart/>\n```')] },
    {
      type: 'table',
      attrs: { id: 'tb2' },
      content: [
        {
          type: 'tableRow',
          attrs: { id: 'tr20' },
          content: [{ type: 'tableHeader', attrs: { id: 'th21', colspan: 2, rowspan: 1, colwidth: [160, 80], align: 'center' }, content: [p('thp21', [t('Quarter')])] }],
        },
        {
          type: 'tableRow',
          attrs: { id: 'tr21' },
          content: [
            { type: 'tableCell', attrs: { id: 'td21', colspan: 1, rowspan: 2, colwidth: null, align: null }, content: [p('tdp21', [t('First')]), p('tdp22', [t('Second')])] },
            {
              type: 'tableCell',
              attrs: { id: 'td22', colspan: 1, rowspan: 1, colwidth: null, align: 'right' },
              content: [{ type: 'bulletList', attrs: { id: 'ul3' }, content: [{ type: 'listItem', attrs: { id: 'li6' }, content: [p('lp6', [t('Listed')])] }] }],
            },
          ],
        },
        { type: 'tableRow', attrs: { id: 'tr22' }, content: [{ type: 'tableCell', attrs: { id: 'td23', colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [] }] },
      ],
    },
    {
      type: 'table',
      attrs: { id: 'tb3' },
      content: [
        {
          type: 'tableRow',
          attrs: { id: 'tr30' },
          content: [
            { type: 'tableCell', attrs: { id: 'td31', colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [p('tdp31', [t('No header')])] },
            { type: 'tableCell', attrs: { id: 'td32', colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [p('tdp32', [t('row')])] },
          ],
        },
      ],
    },
    { type: 'chart', attrs: { id: 'ch2', source: 'revenue.csv', spec: { mark: 'line', encoding: { x: 'month', y: 'total' } } } },
    { type: 'diagram', attrs: { id: 'dg2', source: 'graph LR\n:::\n  A --> B' } },
    { type: 'mathBlock', attrs: { id: 'mb2', latex: 'a\n$$\nb' } },
    p('r4', [t('Inline '), { type: 'math', attrs: { latex: '' } }, t(' and '), { type: 'math', attrs: { latex: 'x^2\n+ 1' } }, t('.')]),
    p('p9', [t('The end.')]),
  ],
});
