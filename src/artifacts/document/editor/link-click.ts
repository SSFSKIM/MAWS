// A link opened from the page (P3-F, F1; the owner's sitting, step N.3): ⌘-click or Ctrl-click on a link opens the link
// mark's href through the host's opener (in the app main's one scheme-checked `layout.openExternal`, so a scheme it
// refuses stays refused) and is consumed at the press: no caret moves, and ProseMirror's own modifier-click, which
// selects the node clicked (the whole paragraph), never runs. A plain click stays the page's, the caret placed as
// anywhere else (the Link mark keeps `openOnClick: false`). DOM event handlers, which a read-only view runs too.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export interface LinkClickOptions {
  /** Opens a URL outside the app (the host's `openExternal`). */
  open(url: string): void;
}

// The link under a modifier-click's target (its href, '' for a link without one); null when the press is no such click.
function linkClicked(view: EditorView, event: MouseEvent): string | null {
  if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return null;
  const anchor = event.target instanceof Element ? event.target.closest('a') : null;
  if (!anchor || !view.dom.contains(anchor)) return null;
  const link = view.state.doc.nodeAt(view.posAtDOM(anchor, 0))?.marks.find((mark) => mark.type.name === 'link');
  if (!link) return null;
  return typeof link.attrs.href === 'string' ? link.attrs.href : '';
}

export const LinkClick = Extension.create<LinkClickOptions>({
  name: 'linkClick',
  addOptions: () => ({ open: () => {} }),
  addProseMirrorPlugins() {
    const { open } = this.options;
    return [
      new Plugin({
        key: new PluginKey('linkClick'),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (linkClicked(view, event) === null) return false;
              event.preventDefault();
              return true;
            },
            click: (view, event) => {
              const href = linkClicked(view, event);
              if (href === null) return false;
              event.preventDefault();
              if (href) open(href);
              return true;
            },
          },
        },
      }),
    ];
  },
});
