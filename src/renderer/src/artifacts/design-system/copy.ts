// The Design System page's app-side words (P3-D; docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D10, D12, D14):
// its X32 header, its tab's states, the delete sheet and the adopt request.
export const DESIGN_SYSTEM_COPY = {
  untitled: 'Design system',
  check: 'Check against law',
  setDefault: 'Set as my default',
  exportClaude: 'Export for Claude',
  exported: (path: string) => `Exported for Claude to ${path}`,
  exportFailed: (reason: string) => `Could not export for Claude: ${reason}`,
  opening: 'Opening the design system…',
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
  theirDefaults: 'Their defaults (the Space’s, else yours)',
  moveAndDelete: 'Move and delete',
  moveFailed: (title: string, reason: string) => `Could not move “${title}” · ${reason}`,
  // "Ask the agent to adopt it" (D12)
  noSession: 'Open a session to ask the agent.',
  adoptRequest: (name: string, artifactId: string) =>
    `Adopt a law for the design system “${name}” (artifact ${artifactId}): read it with artifact_read, write its DESIGN.md through the designer skill’s adopt route (record “adopted from ${name}”, its nine sections, the hard don’ts tagged where they can be checked), and publish it with artifact_publish. Keep its tokens as they are.`,
  adoptAsked: 'The request is in the chat’s message box; send it when it reads right.',
} as const;
