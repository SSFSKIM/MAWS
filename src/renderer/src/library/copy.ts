// The library's words (docs/doperpowers/plans/2026-10-12-p3-l-library.md): what the `artifact` main tab says when it
// cannot show an editor, and the names of the kinds. User-visible copy says Artifact (Decision Log 10).
import type { ArtifactKind } from '@shared/artifacts/entity';

export const KIND_LABELS: Record<ArtifactKind, string> = {
  document: 'Document',
  presentation: 'Presentation',
  design: 'Design',
  design_system: 'Design system',
  dashboard: 'Dashboard',
  html: 'HTML page',
  file: 'File',
};

const KIND_PLURALS: Record<ArtifactKind, string> = {
  document: 'documents',
  presentation: 'presentations',
  design: 'designs',
  design_system: 'design systems',
  dashboard: 'dashboards',
  html: 'HTML pages',
  file: 'files',
};

export const LIBRARY_COPY = {
  fallbackTitle: 'Artifact', // an `artifact` tab whose row is not known (yet)
  reading: 'Opening…',
  readFailed: (message: string) => `Couldn’t read this artifact: ${message}`,
  retry: 'Try again',
  hostUnreachable: (message: string) => `Couldn’t confirm this artifact with its host: ${message}`,
  goneTitle: 'Artifact not found',
  gone: 'This artifact was deleted, or it is not in the library.',
  noEditor: (kind: ArtifactKind) => `No editor for ${KIND_PLURALS[kind]} yet`,
  inSpace: (name: string) => `in ${name}`,
  edited: (ago: string, by: string) => `Edited ${ago} by ${by}`,
  beingSaved: (title: string) => `${title} is being saved`, // the replace rule's reasons, toasted as "…, so it stays open"
  unsaved: (title: string) => `${title} has unsaved changes`,
};
