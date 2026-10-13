// P3-B's file in the binding module (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, "One Yjs import path"): the
// `@y/y` runtime names the document kind needs that the module's entry (index.ts, P3-A's) exports only as types or not
// at all: the node constructor for the tabs and threads maps, the relative positions a thread's anchor stores, the
// undo manager the editor scopes to its binding, and the renderer and gc-off docs of history. Kept to exactly these;
// P3-A absorbs them into index.ts at the next re-pin and this file goes.
import * as Y from '@y/y';

export {
  Node as YNode,
  UndoManager,
  DiffRenderer,
  createDiffRenderer,
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromJSON,
  createRelativePositionFromTypeIndex,
  relativePositionToJSON,
} from '@y/y';

// History's throwaway docs (a version's state and the state it is compared with) keep deleted content, so the diff
// renderer can show what a change removed; the live doc is gc on (index.ts's `newDoc`).
export const newDocGcOff = (): Y.Doc => new Y.Doc({ gc: false });
