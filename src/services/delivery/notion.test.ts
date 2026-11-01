// P4-B5: what MAWS asks of Notion's `notion-create-pages` and how it reads the answer (./notion.ts): one page titled by
// the artifact, a parent only when named, answered at once; the page's address from the answer's JSON, its text, or the
// page's id; the tool's own error as the owner's words.
import { describe, expect, it } from 'vitest';
import { notionArguments, notionTitle, readNotionAnswer } from './notion';

const text = (value: unknown) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });

describe('the Notion target', () => {
  it('asks for one page titled by the artifact, private unless a parent page is named', () => {
    expect(notionArguments({ title: 'Memo', content: '# A' })).toEqual({ pages: [{ properties: { title: 'Memo' }, content: '# A' }], allow_async: false });
    expect(notionArguments({ title: 'Memo', content: '', parent: 'abc' }).parent).toEqual({ type: 'page_id', page_id: 'abc' });
  });

  it('titles a page with no control characters, never empty, within Notion’s bound', () => {
    expect(notionTitle('  a\tb\u0007c  ')).toBe('a b c');
    expect(notionTitle('   ')).toBe('Untitled');
    expect([...notionTitle('가'.repeat(3_000))]).toHaveLength(2_000);
  });

  it('reads the page made from the answer’s JSON, its id, or an address in its text', () => {
    expect(readNotionAnswer(text({ pages: [{ id: 'x', url: 'https://www.notion.so/Memo-0123', properties: { title: 'Memo' } }] }))).toEqual({ ok: true, url: 'https://www.notion.so/Memo-0123', name: 'Memo' });
    expect(readNotionAnswer(text({ pages: [{ id: '01234567-89ab-cdef-0123-456789abcdef' }] }))).toEqual({ ok: true, url: 'https://www.notion.so/0123456789abcdef0123456789abcdef' });
    expect(readNotionAnswer(text('Created https://acme.notion.site/Memo-1 and done'))).toEqual({ ok: true, url: 'https://acme.notion.site/Memo-1' });
    expect(readNotionAnswer({ structuredContent: { pages: [{ url: 'https://notion.so/p' }] }, content: [] })).toEqual({ ok: true, url: 'https://notion.so/p' });
    expect(readNotionAnswer(text('Created a page'))).toEqual({ ok: true, url: null });
  });

  it('never takes an address on another host for the page', () => {
    expect(readNotionAnswer(text({ pages: [{ url: 'https://evil.example/notion.so' }] }))).toEqual({ ok: true, url: null });
  });

  it('answers the tool’s own error, bounded', () => {
    expect(readNotionAnswer({ isError: true, content: [{ type: 'text', text: 'Could not find page' }] })).toEqual({ ok: false, message: 'Could not find page' });
    expect((readNotionAnswer({ isError: true, content: [{ type: 'text', text: 'x'.repeat(1_000) }] }) as { message: string }).message).toHaveLength(300);
  });
});
