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

// ---- the Artifacts tab (M4) --------------------------------------------------------------------------------------------

export const KIND_PLURAL_LABELS: Record<ArtifactKind, string> = {
  document: 'Documents',
  presentation: 'Presentations',
  design: 'Designs',
  design_system: 'Design systems',
  dashboard: 'Dashboards',
  html: 'HTML pages',
  file: 'Files',
};

// "Make something new": what each kind is for, and the composer's opening words when Claude is asked to make one.
export const KIND_BLURBS: Record<ArtifactKind, string> = {
  document: 'Notes, specs and reports',
  presentation: 'A slide deck',
  design: 'Artboards on a canvas',
  design_system: 'Colours, type and components',
  dashboard: 'Charts bound to data',
  html: 'A page Claude builds',
  file: 'Any file from your Mac',
};
// A kind as a noun in a sentence.
const KIND_NOUNS: Record<ArtifactKind, string> = {
  document: 'document',
  presentation: 'presentation',
  design: 'design',
  design_system: 'design system',
  dashboard: 'dashboard',
  html: 'HTML page',
  file: 'file',
};
export const askClaudePrefill = (kind: ArtifactKind): string => `Make ${kind === 'html' ? 'an' : 'a'} ${KIND_NOUNS[kind]}: `;
export const untitledTitle = (kind: ArtifactKind): string => `Untitled ${KIND_NOUNS[kind]}`;

export const GROUP_COPY = {
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  older: 'Older',
  noSpace: 'No Space',
};

export const LIBRARY_PAGE = {
  title: 'Artifacts',
  views: { all: 'All', pinned: 'Pinned', bySpace: 'By Space' },
  viewLabel: 'View',
  search: 'Search artifacts',
  typeFilter: 'Filter by type',
  allTypes: 'All types',
  newSpace: 'New Space',
  allSpaces: 'All Spaces',
  makeNew: 'Make something new',
  create: 'New',
  addFile: 'Add a file…',
  askClaude: 'Ask Claude',
  reading: 'Reading the library…',
  readFailed: (message: string) => `Couldn’t read the library: ${message}`,
  retry: 'Try again',
  // empty states: what puts artifacts here
  emptyAll: 'Nothing here yet. Documents, decks, HTML pages and the files your sessions send land here, and so does anything you make above.',
  emptyPinned: 'Pin an artifact from its menu to keep it here.',
  emptySpaces: 'A Space is a named folder for artifacts. Link it to a project folder and its artifacts are copied, read-only, into that folder’s artifacts/ directory, where agents can read them.',
  emptySpace: (name: string) => `Nothing in ${name} yet. Move an artifact here from its menu, or make one above.`,
  emptySpaceGroup: 'Nothing in this Space yet',
  noMatch: (query: string) => `No artifacts match “${query}”.`,
  noKind: (kind: ArtifactKind) => `No ${KIND_PLURALS[kind]} here.`,
  linkedTo: (dir: string) => `Mirrored to ${dir}/artifacts`,
};

export const ROW_COPY = {
  menu: (title: string) => `Actions for ${title}`,
  pinned: 'Pinned',
  edited: (ago: string, by: string) => `Edited ${ago} by ${by}`,
  untitledSession: 'Untitled session',
  more: (n: number) => `+${n}`,
  moreTitle: (titles: string[]) => titles.join('\n'),
  roles: { created: 'created', edited: 'edited', viewed: 'viewed', commented: 'commented' } as const,
  sessionTitle: (title: string, roles: string, ago: string) => `${title}: ${roles}, ${ago}`,
  open: 'Open',
  pin: 'Pin',
  unpin: 'Unpin',
  rename: 'Rename…',
  moveToSpace: 'Move to Space',
  noSpace: 'No Space',
  newSpace: 'New Space…',
  duplicate: 'Duplicate',
  delete: 'Delete…',
};

export const DIALOG_COPY = {
  renameTitle: 'Rename artifact',
  titleField: 'Title',
  rename: 'Rename',
  deleteTitle: (title: string) => `Delete “${title}”?`,
  deleteBody: 'It leaves the library and every session’s list. Its history stays in the store.',
  delete: 'Delete',
  inUseTitle: 'This design system is in use',
  inUseBody: (title: string) => `“${title}” styles the artifacts below. Move them to another design system before deleting it.`,
  inUseReading: 'Finding them…',
  close: 'Close',
  newSpaceTitle: 'New Space',
  nameField: 'Name',
  create: 'Create',
  createAndMove: (title: string) => `Create and move “${title}”`,
  folderNone: 'Not linked to a folder',
  folderLinked: (dir: string) => `Mirrored to ${dir}/artifacts`,
  chooseFolder: 'Link a folder…',
  changeFolder: 'Change folder…',
  clearFolder: 'Don’t link',
  renameSpaceTitle: 'Rename Space',
  deleteSpaceTitle: (name: string) => `Delete the Space “${name}”?`,
  deleteSpaceBody: (count: number) => (count === 0 ? 'The Space is empty.' : `Its ${count === 1 ? 'artifact stays' : `${count} artifacts stay`} in the library, in no Space.`),
  deleteSpaceLinked: 'The copies it mirrored into the linked folder are removed.',
};

export const SPACE_COPY = {
  menu: (name: string) => `Actions for the Space ${name}`,
  open: 'Show only this Space',
  rename: 'Rename…',
  link: 'Link a folder…',
  changeFolder: 'Change folder…',
  unlink: 'Unlink folder',
  delete: 'Delete Space…',
};
