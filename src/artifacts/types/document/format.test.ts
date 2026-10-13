// The document kind's format reference against the dialect it documents (M7 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md; Decision Log 13, 17 to 19): every Markdown example reads back
// exactly as written (the dialect's canonical form, so an agent copying it writes what MAWS reads), the read example's
// footer and milestones are the read format's, the `artifact_edit` example is a valid call that applies to the
// document the other examples make, and the limits it states are the ones the tools enforce.
import { describe, expect, it } from 'vitest';
import { ArtifactEditInputSchema, DOCUMENT_LIMITS } from '@shared/maws/document-tools';
import { newDoc } from '../../yjs';
import { DocIndex } from '../../document/block-index';
import type { Op } from '../../document/edit-ops';
import { docMarkdown, stripMilestones } from '../../document/markdown';
import { applyEdit } from '../../document/patch-writer';
import { schemaFor } from '../../document/schema';
import { createDocument } from '../../document/tabs';
import { KIND_GUIDES } from '../guides';

const format = KIND_GUIDES.document.format;
const fences = (language: string): string[] => [...format.matchAll(new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\\n\`\`\``, 'g'))].map((match) => match[1]);
const md = docMarkdown();
const serialize = (markdown: string): string => md.serialize(schemaFor().node('doc', null, md.parse(markdown)));

describe('the document format reference', () => {
  const examples = fences('markdown');

  it('has a read example, a block example and both table forms', () => {
    expect(examples).toHaveLength(4);
  });

  it('writes every example in the dialect’s canonical form: it reads back exactly as written', () => {
    for (const example of examples.slice(1)) expect(serialize(example)).toBe(example);
  });

  it('shows a read as the read format writes it: milestones that overlap without nesting, then the comments footer', () => {
    const [body, footer] = examples[0].split('\n\n---\n');
    expect(serialize(stripMilestones(body))).toBe(stripMilestones(body));
    expect(body).toContain('<c:t1>**quarterly** with <c:t2>design review</c:t1> notes</c:t2>');
    expect(footer.split('\n')[0]).toMatch(/^Comments: \d+ open \(\d+ orphaned\)$/);
    for (const line of footer.split('\n').slice(1)) expect(line).toMatch(/^- c:\w+ (on|orphaned, near) \^\w+ · ".+" · \d+ messages?$/);
  });

  it('gives an artifact_edit call that is valid and applies to the document the other examples make', () => {
    const [call] = fences('json');
    const input = ArtifactEditInputSchema.parse(JSON.parse(call));
    const doc = newDoc();
    createDocument(doc, { title: 'Launch plan', body: schemaFor().node('doc', null, [...md.parse(examples[1]), ...md.parse(examples[2])]) });
    const applied = applyEdit(doc, input.ops as Op[], {});
    expect(applied.results).toHaveLength(input.ops.length);
    const index = DocIndex.of(doc);
    const text = (id: string) => index.pm(index.find(id)!.top).textContent;
    expect(text('p1')).toContain('The plan ships every month.');
    expect(text('tb1')).toContain('beta3');
  });

  it('states the limits the tools enforce', () => {
    const limits = format.split('## Limits')[1].split('## Examples')[0];
    const number = (value: number) => value.toLocaleString('en-US');
    for (const value of [DOCUMENT_LIMITS.opsPerBatch, DOCUMENT_LIMITS.textChars, DOCUMENT_LIMITS.markdownChars, DOCUMENT_LIMITS.blocksPerTab, DOCUMENT_LIMITS.readCountMax, DOCUMENT_LIMITS.readCount]) expect(limits).toContain(number(value));
    expect(limits).toContain(`at most ${DOCUMENT_LIMITS.tabs} tabs`);
  });
});
