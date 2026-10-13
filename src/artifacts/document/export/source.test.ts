// What an export reads from a document's Y.Doc (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the tabs
// in display order with their bodies, the threads and the token overrides, and files written from it.
import { describe, expect, it } from 'vitest';
import { newDoc } from '../../yjs';
import { comparable, HUMAN } from '../convert.fixture';
import { everyKindJSON } from '../fixtures';
import { importMarkdown } from '../import/markdown';
import { setDsOverrides } from '../meta';
import { schemaFor } from '../schema';
import { addTab, createDocument, moveTab, tabBody } from '../tabs';
import { addThread, anchorOfMark } from '../threads';
import { exportHtml } from './html';
import { exportMarkdown } from './markdown';
import { exportSource, tabsOf } from './source';

describe('exportSource', () => {
  it('reads tabs in display order, their bodies, the threads and the overrides', async () => {
    const schema = schemaFor();
    const doc = newDoc();
    const first = createDocument(doc, { title: 'Overview', body: schema.nodeFromJSON(everyKindJSON()) });
    const second = addTab(doc, { title: 'Notes', body: importMarkdown('## 회의 메모\n\n안녕하세요.') });
    moveTab(doc, second, { before: first });
    addThread(doc, { threadId: 't1', tabId: first, blockId: 'p2', quote: 'ships quarterly with design review', anchor: anchorOfMark(tabBody(doc, first)!, 't1')!, by: HUMAN, at: 1, body: 'Is quarterly right?' });
    setDsOverrides(doc, { '--ds-color-accent': '#0b5fff' });

    const source = exportSource(doc, 'Planning');
    expect(source.title).toBe('Planning');
    expect(source.tabs.map(({ id, title }) => [id, title])).toEqual([
      [second, 'Notes'],
      [first, 'Overview'],
    ]);
    expect(comparable(source.tabs[1].body)).toEqual(comparable(schema.nodeFromJSON(everyKindJSON())));
    expect(source.threads.map(({ id, messages }) => [id, messages.map((m) => m.body)])).toEqual([['t1', ['Is quarterly right?']]]);
    expect(source.overrides).toEqual({ '--ds-color-accent': '#0b5fff' });
    expect(tabsOf(source, first).map(({ title }) => title)).toEqual(['Overview']);

    expect(exportMarkdown(source).startsWith('# Notes\n\n## 회의 메모')).toBe(true);
    expect(await exportHtml(source)).toMatch(/\.ds-doc a \{[^}]*color: #0b5fff;/);
  });
});
