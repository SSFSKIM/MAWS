// P3-B's entry to `@y/prosemirror` 2.0.0-15 (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, "One Yjs import
// path"): the lint allows `@y/prosemirror` only under src/artifacts/yjs/, so the document kind's editor, writer and
// model import the binding's ProseMirror side from here. A re-pin edits this file with the rest of the directory.
// `DiffRenderer` (history, M5) is `@y/y`'s, not this package's.
export {
  acceptChanges,
  configureYProsemirror,
  defaultMapAttributionToMark,
  pmnodeToDelta,
  redoCommand,
  rejectChanges,
  relativePositionsToResolvedPositions,
  resolvedPositionsToRelativePositions, // M4: a new comment's anchor from the editor's selection
  syncPlugin,
  undoCommand,
  yattr2markname,
  yCursorPlugin,
  ynodeToPmnode,
  ySyncPluginKey,
  yUndoPlugin,
} from '@y/prosemirror';
