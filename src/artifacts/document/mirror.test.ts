// The document kind's linked-directory mirror writer (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; the
// ledger's §7 `registerMirrorWriter`): a document in a linked Space is mirrored as `<slug>.md`, its lossless Markdown
// export (every tab, ids and comment milestones off), so an agent's grep finds its text.
import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import type { Artifact } from '@shared/artifacts/entity';
import { newDoc } from '../yjs';
import { isMirrorCopy, mirrorSlug, type MirrorAsset } from '../library/mirror';
import { exportMarkdown } from './export/markdown';
import { exportSource } from './export/source';
import { comparable, sourceOf } from './convert.fixture';
import { importMarkdown } from './import/markdown';
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
    expect(markdown).toBe(exportMarkdown(exportSource(doc, artifact.title), { mode: 'mirror' }));
    expect(markdown).toContain('The launch waits for the review.');
    expect(markdown).toContain('# Notes');
    expect(markdown).not.toMatch(/\^p0aaaaaa/); // no block ids in a file meant for people and grep
  });

  it('keeps chip metadata, ordinary text marks and trailing paragraphs in the mirror without changing the document', () => {
    const doc = newDoc();
    const body = sourceOf([
      { type: 'paragraph', content: [
        { type: 'text', text: 'Due ', marks: [{ type: 'bold' }] },
        { type: 'date', attrs: { iso: '2026-10-23' } },
        { type: 'text', text: ' · ' },
        { type: 'mention', attrs: { kind: 'person', ref: 'person-1', label: '*Mina*' } },
        { type: 'text', text: ' · ' },
        { type: 'dropdown', attrs: { options: ['[Ready]', 'Later'], value: '[Ready]' } },
      ] },
      { type: 'paragraph' },
      { type: 'paragraph' },
    ]).tabs[0].body;
    createDocument(doc, { title: 'Overview', body });
    const before = exportSource(doc, artifact.title).tabs[0].body.toJSON();
    expect(comparable(before)).toEqual(comparable(body));
    const markdown = documentMirrorWriter({ artifact, doc }).files[`${mirrorSlug(artifact)}.md`] as string;
    expect(comparable(importMarkdown(markdown))).toEqual(comparable(body));
    expect(exportSource(doc, artifact.title).tabs[0].body.toJSON()).toEqual(before);
  });

  it('retains the mirror’s reader-formatted line endings rather than canonical newline escapes', () => {
    const doc = newDoc();
    createDocument(doc, { title: 'Overview', body: paragraphs('First\nSecond') });
    const markdown = documentMirrorWriter({ artifact, doc }).files[`${mirrorSlug(artifact)}.md`] as string;
    expect(markdown).not.toContain('&#10;');
    expect(new Marked().parse(markdown)).toMatch(/<p>First<br>\s*Second<\/p>/);
  });

  it('writes nothing for a document the host could not read, and an empty file for one with no tabs yet', () => {
    expect(documentMirrorWriter({ artifact })).toEqual({ files: {} });
    expect(documentMirrorWriter({ artifact, doc: newDoc() })).toEqual({ files: { [`${mirrorSlug(artifact)}.md`]: '\n' } });
  });

  // P3-F (F11, the sitting's candidate 18): the mirrored `<img src="assets/…">` named no file, so an agent reading the
  // mirror met a broken image
  describe('its image assets (P3-F F11)', () => {
    const schema = schemaFor();
    const slug = mirrorSlug(artifact);
    const asset = (name: string): MirrorAsset => ({ ref: `assets/${name}`, name, mime: 'image/png', size: 3 });
    const withImages = (...images: { src: string; assetId: string | null }[]) => {
      const doc = newDoc();
      const inline = [schema.text('See '), ...images.map((image) => schema.nodes.image.create({ ...image, alt: 'A sample' }))];
      createDocument(doc, { title: 'Overview', body: schema.nodes.doc.create(null, [schema.nodes.paragraph.create({ id: 'p0aaaaaa' }, inline)]) });
      return doc;
    };

    it('copies each asset image the document names into <slug>/assets/, read only when written, and points its src there', () => {
      const reads: string[] = [];
      const doc = withImages({ src: 'assets/sample-image.png', assetId: 'as1' }, { src: 'https://example.com/figure.png', assetId: null }, { src: 'assets/gone.png', assetId: 'as9' });
      const { files } = documentMirrorWriter({ artifact, doc, assets: [asset('sample-image.png'), asset('unused.png')], readAsset: (ref) => (reads.push(ref), new Uint8Array([1, 2, 3])) });
      expect(Object.keys(files)).toEqual([`${slug}.md`, `${slug}/assets/sample-image.png`]);
      const markdown = files[`${slug}.md`] as string;
      expect(markdown).toContain(`src="${slug}/assets/sample-image.png"`); // resolves beside the .md
      expect(markdown).toContain('(https://example.com/figure.png)'); // not an asset: as stored
      expect(markdown).toContain('src="assets/gone.png"'); // an asset the artifact no longer holds: as stored, nothing copied
      expect(reads).toEqual([]);
      const copy = files[`${slug}/assets/sample-image.png`];
      expect(isMirrorCopy(copy) && [...copy.read()]).toEqual([1, 2, 3]);
      expect(reads).toEqual(['assets/sample-image.png']);
    });

    it('writes no assets folder for a document that names none of the artifact’s assets', () => {
      const doc = withImages({ src: 'https://example.com/figure.png', assetId: null });
      const never = () => {
        throw new Error('an asset the document does not name is never read');
      };
      expect(Object.keys(documentMirrorWriter({ artifact, doc, assets: [asset('unused.png')], readAsset: never }).files)).toEqual([`${slug}.md`]);
    });
  });
});
