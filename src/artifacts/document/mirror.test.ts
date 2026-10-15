// The document kind's linked-directory mirror writer (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; the
// ledger's §7 `registerMirrorWriter`): a document in a linked Space is mirrored as `<slug>.md`, its lossless Markdown
// export (every tab, ids and comment milestones off), so an agent's grep finds its text.
import { describe, expect, it } from 'vitest';
import type { Artifact } from '@shared/artifacts/entity';
import { newDoc } from '../yjs';
import { mirrorSlug } from '../library/mirror';
import { exportMarkdown } from './export/markdown';
import { exportSource } from './export/source';
import { documentMirrorWriter } from './mirror';
import { schemaFor } from './schema';
import { addTab, createDocument } from './tabs';

const artifact = { id: '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e', kind: 'document', title: 'Launch plan: Q4' } as Artifact;

const paragraphs = (...texts: string[]) => {
  const schema = schemaFor();
  return schema.nodes.doc.create(
    null,
    texts.map((text, i) => schema.nodes.paragraph.create({ id: `p${i}aaaaaa` }, schema.text(text))),
  );
};

describe('documentMirrorWriter', () => {
  it('writes the document as <slug>.md, its Markdown export with every tab', () => {
    const doc = newDoc();
    const first = createDocument(doc, { title: 'Overview', body: paragraphs('The launch waits for the review.') });
    addTab(doc, { title: 'Notes', body: paragraphs('안녕하세요, 팀 여러분.'), after: first });
    const { files } = documentMirrorWriter({ artifact, doc });
    expect(Object.keys(files)).toEqual([`${mirrorSlug(artifact)}.md`]);
    const markdown = files[`${mirrorSlug(artifact)}.md`] as string;
    expect(markdown).toBe(exportMarkdown(exportSource(doc, artifact.title)));
    expect(markdown).toContain('The launch waits for the review.');
    expect(markdown).toContain('# Notes');
    expect(markdown).not.toMatch(/\^p0aaaaaa/); // no block ids in a file meant for people and grep
  });

  it('writes nothing for a document the host could not read, and an empty file for one with no tabs yet', () => {
    expect(documentMirrorWriter({ artifact })).toEqual({ files: {} });
    expect(documentMirrorWriter({ artifact, doc: newDoc() })).toEqual({ files: { [`${mirrorSlug(artifact)}.md`]: '\n' } });
  });
});
