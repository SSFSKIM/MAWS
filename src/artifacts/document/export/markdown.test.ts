// The Markdown export (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12): the lossless dialect with ids
// and comment milestones off, so a file read back gives the content it was written from.
import { describe, expect, it } from 'vitest';
import { comparable, everyKindSource } from '../convert.fixture';
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

  it('refuses a tab the document does not have', () => {
    expect(() => exportMarkdown(everyKindSource(), { tab: 'nope' })).toThrow(/no tab nope/);
  });
});
