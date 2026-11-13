// The editor's extension list (M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the schema module's list
// with the node views attached by name (`extend` adds a view and leaves the node's spec, hence the schema and every
// storage key, as the module built it; nodes.dom.test.tsx compares the fingerprints), then the binding, the comment
// plugins (M4), find, code highlighting and the table cells' fill, (M5) the other replicas' presence and the history
// preview's paint, (P3-F) a modifier-click opening a link, (P4) an image pasted from another document copied into
// this one, (P4-A2, X35) the agent's streaming edit drawn beside its presence, and (U10a) the gap caret. Every editor of
// the document kind builds from here.
import { Extension, type AnyExtension, type Extensions } from '@tiptap/core';
import { gapCursor } from '@tiptap/pm/gapcursor';
import { Plugin } from '@tiptap/pm/state';
import { Collaboration, type CollaborationOptions } from '../collab';
import { AssetPaste } from './asset-paste';
import { Presence, cursorBuilders } from './awareness';
import { extensions } from '../schema';
import { Comments, type CommentsOptions } from './comments/plugins';
import { Find } from './find-plugin';
import { HistoryPaint } from './history/paint';
import { LinkClick } from './link-click';
import { CodeHighlight } from './nodes/code-highlight';
import { renderMermaid } from './nodes/mermaid';
import { TableCellFill } from './nodes/table';
import { nodeViews, type ViewEnvironment } from './nodes/views';
import { Provisional, type ProvisionalOptions } from './provisional';

// U10a (docs/doperpowers/plans/2026-11-12-ux-wave-U10a-unmade-writes.md, decision 9): the place to type after a block
// that holds no text, where no text position is (after a final chart, table, rule, math block, diagram or pending
// upload; before a first one; between two): ProseMirror's gap cursor, set by a click there or an arrow key from the
// block, in a transaction that only sets the selection. What is typed or composed at it makes a paragraph there. The
// trailing paragraph no longer stands in for it, since no repair answers a mere look (`guard` in ../schema.ts). The
// plugin alone: Tiptap's `Gapcursor` wrapper also adds a field to every node's spec, which nothing here reads.
// One amendment: a click on the caret's own place leaves the selection as it was, so the view does not draw it again,
// while the click's press has put the browser's caret in the nearest text; Chromium reports that after the release, and
// the view would take it as the person's selection. After such a click the selection is drawn again (`focus` draws it).
const GapCaret = Extension.create({
  name: 'gapCaret',
  addProseMirrorPlugins: () => {
    const library = gapCursor();
    const click = library.props.handleClick!;
    return [
      new Plugin({
        ...library.spec,
        props: {
          ...library.spec.props,
          handleClick(view, pos, event) {
            const before = view.state.selection;
            if (!click.call(library, view, pos, event)) return false;
            if (view.state.selection.eq(before)) view.focus();
            return true;
          },
        },
      }),
    ];
  },
});

export type EditorEnvironment = Omit<ViewEnvironment, 'renderDiagram'> & Partial<Pick<ViewEnvironment, 'renderDiagram'>>;

export function editorExtensions({
  collaboration,
  comments,
  env,
  generateID,
  provisional,
}: {
  /** The binding's options; null for an editor bound to nothing (a test's, an export's). */
  collaboration: Partial<CollaborationOptions> | null;
  /** The comment plugins' options (M4); none for an editor with no threads map. */
  comments?: Partial<CommentsOptions>;
  env: EditorEnvironment;
  generateID?: () => string;
  /** P4-A2 (X35): the open document's provisional layers, the live editor's only (a bound editor's, beside presence). */
  provisional?: ProvisionalOptions;
}): Extensions {
  const views = nodeViews({ renderDiagram: renderMermaid, ...env });
  const withViews = extensions(generateID ? { generateID } : {}).map((extension: AnyExtension) => {
    const view = views[extension.name];
    return view ? (extension as unknown as { extend(config: object): AnyExtension }).extend({ addNodeView: () => view }) : extension;
  });
  const awareness = collaboration?.awareness ?? null;
  const live = collaboration
    ? [Collaboration.configure({ ...(awareness ? { cursors: cursorBuilders(awareness) } : {}), ...collaboration }), Presence.configure({ awareness }), ...(provisional ? [Provisional.configure(provisional)] : [])]
    : [];
  const linkClick = LinkClick.configure({ open: (url) => env.host.openExternal?.(url) }); // P3-F (F1)
  const assetPaste = AssetPaste.configure({ artifactId: env.artifactId, copyAsset: (from, ref, to) => env.host.copyAsset(from, ref, to) }); // P4
  return [...withViews, linkClick, ...live, ...(comments ? [Comments.configure(comments)] : []), Find, CodeHighlight, TableCellFill, HistoryPaint, assetPaste, GapCaret];
}
