// The Design System page's app-side words (P3-D; docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D10, D12, D14):
// its X32 header, its tab's states, the delete sheet and the adopt request.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4): a word kept only as an accessible name
// is named `…Name`.
import { nameSlot } from '@shared/engine/grant'; // ticket 733a

const adoptRequest = (name: string, artifactId: string) =>
  `Adopt a law for the design system “${name}” (artifact ${artifactId}): read it with artifact_read, write its DESIGN.md through the designer skill’s adopt route (record “adopted from ${name}”, its nine sections, the hard don’ts tagged where they can be checked), and publish it with artifact_publish. Keep its tokens as they are.`;
export const DESIGN_SYSTEM_COPY = {
  untitled: 'Design system',
  check: 'Check against law',
  setDefault: 'Set as my default',
  alreadyDefault: 'Already your default', // G558: why the star does nothing on the default system
  exportClaude: 'Export for Claude',
  exported: (path: string) => `Exported for Claude to ${path}`,
  exportFailed: (reason: string) => `Could not export for Claude: ${reason}`,
  // the close guard (whole-branch review F-I1): edits the store has not acknowledged
  unsavedTitle: (name: string) => `Discard unsaved changes to “${name}”?`,
  unsavedBody: 'Some edits are not saved to the artifact store yet. Cancel keeps the tab open until they save; discarding loses them.',
  discardChanges: 'Discard changes',
  openingName: 'Opening the design system…', // G562: the quiet spinner's name while the tab opens the system
  openFailed: (reason: string) => `Could not open this design system · ${reason}`,
  // the delete sheet (D10)
  deleteAction: 'Delete design system…',
  deleteTitle: (name: string) => `Delete “${name}”?`,
  deleteBody: 'It leaves the library. Versions of documents and decks that were made with it keep rendering with it.',
  delete: 'Delete',
  inUseTitle: 'Still in use',
  inUseBody: (name: string, count: number) => `“${name}” styles ${count === 1 ? 'an artifact' : `${count} artifacts`}. Move ${count === 1 ? 'it' : 'them'} to another system to delete it.`,
  inUseList: 'Artifacts styled by this system',
  moveTo: 'Move them to…',
  theirDefaults: 'Their default system', // G591
  moveAndDelete: 'Move and delete',
  moveFailed: (title: string, reason: string) => `Could not move “${title}” · ${reason}`,
  // "Ask the agent to adopt it" (D12)
  noSession: 'Open a session to ask the agent.',
  // ticket 733a: the system's title, which its author gave, goes into the person's draft by the name's rule
  adoptRequest: (title: string, artifactId: string) => adoptRequest(nameSlot(title), artifactId),
  adoptAsked: 'Request added to the message box', // G582
} as const;
