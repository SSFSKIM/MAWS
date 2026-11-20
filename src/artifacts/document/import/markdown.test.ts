// The Markdown import (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12): the writer's own parser, so a
// human's import and the agent's `artifact_create {content}` agree; headless in Node (P3-F converts a design system's
// law through it).
import { describe, expect, it } from 'vitest';
import corpus from '../../../../test/fixtures/document/corpus.md?raw';
import { docMarkdown } from '../markdown';
import { importMarkdown } from './markdown';

const types = (node: ReturnType<typeof importMarkdown>) => node.content.content.map((block) => block.type.name);

describe('importMarkdown', () => {
  it('reads the corpus into a checked tab body with an id on every block', () => {
    const body = importMarkdown(corpus);
    expect(body.type.name).toBe('doc');
    body.check();
    expect(types(body)).toEqual(['heading', 'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'table', 'horizontalRule', 'heading', 'paragraph']);
    body.descendants((node) => {
      if (node.isBlock) expect(node.attrs.id, node.type.name).toMatch(/^[0-9a-z]{8}$/);
    });
    expect(body.textContent).toContain('안녕하세요, 팀 여러분.');
  });

  it('keeps the ids the dialect names and mints the rest', () => {
    let n = 0;
    const body = importMarkdown('First ^keep0001\n\nSecond', { generateID: () => `minted${++n}`.padEnd(8, '0') });
    expect(body.content.content.map((block) => block.attrs.id)).toEqual(['keep0001', 'minted10']);
  });

  // Ticket 616: the line ending that closes a block's `^id` line at the file's end is no empty paragraph (the agent's
  // `artifact_create` content, and a read's markdown, end with one); an empty paragraph asked for with more stays
  describe('a file’s final line ending after a block’s own `^id` line', () => {
    const minted = () => {
      let n = 0;
      return () => `minted${++n}`.padEnd(8, '0');
    };
    const blocks = (markdown: string) => importMarkdown(markdown, { generateID: minted() }).content.content.map((block) => `${block.type.name}:${block.attrs.id}`);
    const ENDINGS = {
      chart: ':::chart\nsales\n:::\n^c1',
      table: '| a |\n| - |\n| 1 |\n^t1',
      math: '$$\nx\n$$\n^m1',
      rule: '---\n^r1',
    };

    it('reads a chart, then one line ending, as the chart alone', () => {
      expect(blocks(':::chart\nsales\n:::\n^c1\n')).toEqual(['chart:c1']);
      expect(blocks('Intro ^p1\n\n:::chart\nsales\n:::\n^c1\n')).toEqual(['paragraph:p1', 'chart:c1']);
    });

    it.each(Object.entries(ENDINGS))('a document ending in a %s: as written and with a final line ending, the same blocks, and the round trip unchanged', (_, ending) => {
      const markdown = `Intro ^p1\n\n${ending}`;
      const read = importMarkdown(markdown, { generateID: minted() });
      expect(blocks(`${markdown}\n`)).toEqual(blocks(markdown));
      expect(blocks(markdown)).toHaveLength(2);
      const written = docMarkdown().serialize(read);
      expect(blocks(written)).toEqual(blocks(markdown));
      expect(blocks(`${written}\n`)).toEqual(blocks(markdown));
    });

    it('keeps an empty paragraph the file asks for with more line endings, as before', () => {
      expect(blocks(':::chart\nsales\n:::\n^c1\n\n')).toEqual(['chart:c1', 'paragraph:minted10']);
      expect(blocks(':::chart\nsales\n:::\n^c1\n\n\n')).toEqual(['chart:c1', 'paragraph:minted10', 'paragraph:minted20']);
      expect(blocks('Notes ^p1\n\n')).toEqual(['paragraph:p1', 'paragraph:minted10']);
    });

    it('keeps the line ending between an `^id` line and the next block', () => {
      expect(blocks(':::chart\nsales\n:::\n^c1\nNext ^p2\n')).toEqual(['chart:c1', 'paragraph:p2']);
      expect(blocks(':::chart\nsales\n:::\n^c1\n:::chart\nsales\n:::\n^c2\n')).toEqual(['chart:c1', 'chart:c2']);
    });
  });

  it('gives an empty file one empty paragraph (a body is never empty)', () => {
    const body = importMarkdown('   \n');
    expect(body.childCount).toBe(1);
    expect(body.firstChild?.type.name).toBe('paragraph');
    expect(body.firstChild?.attrs.id).toMatch(/^[0-9a-z]{8}$/);
  });
});
