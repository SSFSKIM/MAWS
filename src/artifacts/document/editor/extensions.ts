// The editor's extension list (M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the schema module's list
// with the node views attached by name (`extend` adds a view and leaves the node's spec, hence the schema and every
// storage key, as the module built it; nodes.dom.test.tsx compares the fingerprints), then the binding, the comment
// plugins (M4), find, code highlighting and the table cells' fill, and (M5) the other replicas' presence and the
// history preview's paint. Every editor of the document kind builds from here.
import type { AnyExtension, Extensions } from '@tiptap/core';
import { Collaboration, type CollaborationOptions } from '../collab';
import { Presence, cursorBuilders } from './awareness';
import { extensions } from '../schema';
import { Comments, type CommentsOptions } from './comments/plugins';
import { Find } from './find-plugin';
import { HistoryPaint } from './history/paint';
import { CodeHighlight } from './nodes/code-highlight';
import { renderMermaid } from './nodes/mermaid';
import { TableCellFill } from './nodes/table';
import { nodeViews, type ViewEnvironment } from './nodes/views';

export type EditorEnvironment = Omit<ViewEnvironment, 'renderDiagram'> & Partial<Pick<ViewEnvironment, 'renderDiagram'>>;

export function editorExtensions({
  collaboration,
  comments,
  env,
  generateID,
}: {
  /** The binding's options; null for an editor bound to nothing (a test's, an export's). */
  collaboration: Partial<CollaborationOptions> | null;
  /** The comment plugins' options (M4); none for an editor with no threads map. */
  comments?: Partial<CommentsOptions>;
  env: EditorEnvironment;
  generateID?: () => string;
}): Extensions {
  const views = nodeViews({ renderDiagram: renderMermaid, ...env });
  const withViews = extensions(generateID ? { generateID } : {}).map((extension: AnyExtension) => {
    const view = views[extension.name];
    return view ? (extension as unknown as { extend(config: object): AnyExtension }).extend({ addNodeView: () => view }) : extension;
  });
  const awareness = collaboration?.awareness ?? null;
  const live = collaboration ? [Collaboration.configure({ ...(awareness ? { cursors: cursorBuilders(awareness) } : {}), ...collaboration }), Presence.configure({ awareness })] : [];
  return [...withViews, ...live, ...(comments ? [Comments.configure(comments)] : []), Find, CodeHighlight, TableCellFill, HistoryPaint];
}
