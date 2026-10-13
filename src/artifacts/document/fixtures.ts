// A tab body holding every stored node and mark of the schema (D2), with ids on every block: the parity checks (the
// Yjs round trip, the markdown fixed point) and later the editor's every-kind checks read it. The `--attributed`
// variants and the `y-attributed-*` marks are render-only (the binding never stores them) and are not here.
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
    p('p9', [t('The end.')]),
  ],
});
