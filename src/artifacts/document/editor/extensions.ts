// The editor's extension list (M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the schema module's list
// with the node views attached by name (`extend` adds a view and leaves the node's spec, hence the schema and every
// storage key, as the module built it; nodes.dom.test.tsx compares the fingerprints), then the binding, find, code
// highlighting and the table cells' fill. Every editor of the document kind builds from here.
import type { AnyExtension, Extensions } from '@tiptap/core';
import { Collaboration, type CollaborationOptions } from '../collab';
import { extensions } from '../schema';
import { Find } from './find-plugin';
import { CodeHighlight } from './nodes/code-highlight';
import { renderMermaid } from './nodes/mermaid';
import { TableCellFill } from './nodes/table';
import { nodeViews, type ViewEnvironment } from './nodes/views';

export type EditorEnvironment = Omit<ViewEnvironment, 'renderDiagram'> & Partial<Pick<ViewEnvironment, 'renderDiagram'>>;

export function editorExtensions({
  collaboration,
  env,
  generateID,
}: {
  /** The binding's options; null for an editor bound to nothing (a test's, an export's). */
  collaboration: Partial<CollaborationOptions> | null;
  env: EditorEnvironment;
  generateID?: () => string;
}): Extensions {
  const views = nodeViews({ renderDiagram: renderMermaid, ...env });
  const withViews = extensions(generateID ? { generateID } : {}).map((extension: AnyExtension) => {
    const view = views[extension.name];
    return view ? (extension as unknown as { extend(config: object): AnyExtension }).extend({ addNodeView: () => view }) : extension;
  });
  return [...withViews, ...(collaboration ? [Collaboration.configure(collaboration)] : []), Find, CodeHighlight, TableCellFill];
}
