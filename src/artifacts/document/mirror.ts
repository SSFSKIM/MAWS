// The document kind's linked-directory mirror writer (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; the
// ledger's §7, L's `registerMirrorWriter`): a document in a Space linked to a project directory is mirrored read-only
// as `<slug>.md`, its Markdown export (M6: the agent's lossless dialect with block ids and comment milestones off, every
// tab under its title), so an agent's grep over the project finds the document's words. Pure and portable: the engine
// host's mirror registers it with the document kind and runs it after a change settles.
//
// P3-F (F11, the sitting's candidate 18): the image assets the document names are copied into `<slug>/assets/` beside
// the `.md`, the deck's layout, and the mirrored `src` of each names its copy (`<slug>/assets/<name>`, relative to the
// `.md`), so an agent reading the mirror finds the picture; a shared `assets/` would hold two documents' `image-1.png`
// under one name. Each is a copy, read only when the mirror lacks it (a ref names one content for good), as the deck's
// are; one the document stops naming goes at the next pass by the mirror's leftover rule. An image that is not one of
// the artifact's assets (an https address, an asset it no longer holds) is written as stored.
import type { Node as PMNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import type { MirrorOutput, MirrorWriter } from '../library/mirror';
import { mirrorSlug } from '../library/mirror';
import { exportMarkdown } from './export/markdown';
import { exportSource } from './export/source';

export const documentMirrorWriter: MirrorWriter = ({ artifact, doc, assets = [], readAsset }) => {
  if (!doc) return { files: {} };
  const slug = mirrorSlug(artifact);
  const held = new Set(readAsset ? assets.map(({ ref }) => ref) : []);
  const copies: MirrorOutput['files'] = {};
  const source = exportSource(doc, artifact.title);
  const tabs = source.tabs.map((tab) => ({
    ...tab,
    body: withImageSources(tab.body, (src) => {
      if (!held.has(src)) return undefined;
      copies[`${slug}/${src}`] = { read: () => readAsset!(src) };
      return `${slug}/${src}`;
    }),
  }));
  return { files: { [`${slug}.md`]: exportMarkdown({ ...source, tabs }, { mode: 'mirror' }), ...copies } };
};

// `body` with the `src` of each image that `to` answers for replaced: the export's own tree, the document untouched.
function withImageSources(body: PMNode, to: (src: string) => string | undefined): PMNode {
  const tr = new Transform(body);
  body.descendants((node, pos) => {
    const src = node.type.name === 'image' && typeof node.attrs.src === 'string' ? to(node.attrs.src) : undefined;
    if (src !== undefined) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src });
    return true;
  });
  return tr.doc;
}
