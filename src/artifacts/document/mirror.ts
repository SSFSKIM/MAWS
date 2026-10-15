// The document kind's linked-directory mirror writer (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; the
// ledger's §7, L's `registerMirrorWriter`): a document in a Space linked to a project directory is mirrored read-only
// as `<slug>.md`, its Markdown export (M6: the agent's lossless dialect with block ids and comment milestones off, every
// tab under its title), so an agent's grep over the project finds the document's words. Pure and portable: the engine
// host's mirror registers it with the document kind and runs it after a change settles.
import type { MirrorWriter } from '../library/mirror';
import { mirrorSlug } from '../library/mirror';
import { exportMarkdown } from './export/markdown';
import { exportSource } from './export/source';

export const documentMirrorWriter: MirrorWriter = ({ artifact, doc }) => (doc ? { files: { [`${mirrorSlug(artifact)}.md`]: exportMarkdown(exportSource(doc, artifact.title)) } } : { files: {} });
