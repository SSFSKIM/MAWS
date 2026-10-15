// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D1, D8 "Text in place"; M5): the @y/prosemirror 2
// names the deck's text box needs, beside B's `src/artifacts/yjs/prosemirror.ts`; the package's global types come from
// B's `y-prosemirror-globals.d.ts` (the shim this file carried folded into it at the merge of B). A text element's `<doc>` node is
// @y/prosemirror 2's node shape (slides.ts), so a Tiptap editor binds to it with the package's `syncPlugin`, configured
// once the view exists (S6's `binding-v14`). Callers see ProseMirror types only, never a Yjs one.
import type { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { configureYProsemirror, syncPlugin } from '@y/prosemirror';
import * as Y from '@y/y';
import { transact, type Doc } from './doc';
import { elementScalars, hasText, SLIDES_ROOT, writeText } from './slides';

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
