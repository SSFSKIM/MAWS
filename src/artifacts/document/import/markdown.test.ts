// The Markdown import (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12): the writer's own parser, so a
// human's import and the agent's `artifact_create {content}` agree; headless in Node (P3-F converts a design system's
// law through it).
import { describe, expect, it } from 'vitest';
import corpus from '../../../../test/fixtures/document/corpus.md?raw';
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

  it('gives an empty file one empty paragraph (a body is never empty)', () => {
    const body = importMarkdown('   \n');
    expect(body.childCount).toBe(1);
    expect(body.firstChild?.type.name).toBe('paragraph');
    expect(body.firstChild?.attrs.id).toMatch(/^[0-9a-z]{8}$/);
  });
});
