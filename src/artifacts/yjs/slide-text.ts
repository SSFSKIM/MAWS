// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D1, D8 "Text in place"; M5): the @y/prosemirror 2
// names the deck's text box needs, until B's `src/artifacts/yjs/prosemirror.ts` lands, when the merge folds this file
// into B's (and the `declare global` below into B's `y-prosemirror-globals.d.ts`). A text element's `<doc>` node is
// @y/prosemirror 2's node shape (slides.ts), so a Tiptap editor binds to it with the package's `syncPlugin`, configured
// once the view exists (S6's `binding-v14`). Callers see ProseMirror types only, never a Yjs one.
import type { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { configureYProsemirror, syncPlugin } from '@y/prosemirror';
import * as Y from '@y/y';
import { transact, type Doc } from './doc';
import { elementScalars, hasText, SLIDES_ROOT, writeText } from './slides';

// The package's declarations name types only its own global.d.ts declares (B's shim, `y-prosemirror-globals.d.ts`, is
// not on this branch); under `skipLibCheck: false` the subset this file's imports reach, as B's shim spells them.
declare global {
  type YType = import('@y/y').Node;
  type Renderer = import('@y/y').AbstractRenderer;
  type EditorState = import('prosemirror-state').EditorState;
  type EditorView = import('prosemirror-view').EditorView;
  type CommandDispatch = (tr: import('prosemirror-state').Transaction) => void;
  type AttributionMapper = (format: Record<string, unknown> | null, attribution: import('lib0/delta').Attribution) => Record<string, unknown> | null;
  type AttributedNodesPredicate = (nodeName: string, kinds: { insert?: boolean; delete?: boolean; format?: boolean }) => boolean;
  type NodeCompare = (a: import('lib0/delta').DeltaAny, b: import('lib0/delta').DeltaAny) => boolean;
  type IsInitialContent = (doc: import('prosemirror-model').Node) => boolean;
  type SyncPluginState = import('lib0/schema').Unwrap<typeof import('@y/prosemirror').$syncPluginState>;
  type SyncPluginStateUpdate = import('lib0/schema').Unwrap<typeof import('@y/prosemirror').$syncPluginStateUpdate>;
  type ProsemirrorDelta = import('lib0/schema').Unwrap<typeof import('@y/prosemirror').$prosemirrorDelta>;
}

/** A text element's block kind: one `p` for h1-h3/p/th/td, `li` items for ul/ol. */
export type TextKind = 'p' | 'li';
export const textKindOf = (tag: string): TextKind => (tag === 'ul' || tag === 'ol' ? 'li' : 'p');

export interface SlideTextBinding {
  readonly kind: TextKind;
  /** The plugins binding an editor to the element's text; one binding serves one editor. */
  readonly plugins: readonly Plugin[];
  /** The origin of every Y write the binding makes (the sync plugin itself, `ySyncPluginKey.get(state)`). */
  readonly origin: object;
  /** Binds the view to the text once the view exists: the view takes the model's text; nothing is written. */
  bind(view: EditorView): void;
}

/**
 * The binding of an editor to a text element's `<doc>` node. An element without one gains an empty one of its kind
 * first, written in one transaction under `ensureOrigin`; with `ensureOrigin` null (a read-only view) nothing is
 * written and such an element has no binding.
 */
export function bindSlideText(doc: Doc, slideId: string, elementId: string, ensureOrigin: object | null): SlideTextBinding | null {
  const kind = textKindOf(elementScalars(doc, slideId, elementId).tag as string);
  if (!hasText(doc, slideId, elementId)) {
    if (ensureOrigin === null) return null;
    transact(doc, () => writeText(doc, slideId, elementId, [{ type: kind, inline: [] }]), ensureOrigin);
  }
  const slide = doc.get(SLIDES_ROOT).getAttr(slideId) as Y.Node;
  const ytype = ((slide.getAttr('elements') as Y.Node).getAttr(elementId) as Y.Node).getAttr('text') as Y.Node;
  const sync = syncPlugin();
  return {
    kind,
    plugins: [sync],
    origin: sync,
    bind: (view) => {
      if (!view.isDestroyed) configureYProsemirror({ ytype })(view.state, view.dispatch);
    },
  };
}
