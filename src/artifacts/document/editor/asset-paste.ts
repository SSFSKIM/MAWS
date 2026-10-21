// P4 (the tracker's 2026-10-19 "P4 document paste" row; P3 Decision Log 65): an image's asset belongs to the document
// it was put in (its `src` is that artifact's `assets/<name>`, drawn against the document showing it, nodes/views.ts),
// so an image pasted from another document is copied into this one first, as the deck and the design do. The editor
// names its artifact on every asset image it writes to the clipboard (a copy, a cut, a drag). A paste whose images name
// another artifact is held while the store copies each asset (`EditorHost.copyAsset`) and then lands with the copies'
// refs, at the selection as it is by then, if the editor still takes writes; a failed copy pastes nothing and the editor
// says why (`assetPasteFailed`, which the toolbar shows). Its paste handler runs after every other plugin's has declined,
// so what it lands is what ProseMirror's own paste would have. A paste within one document, or of anything naming no
// other artifact (from outside MAWS), is ProseMirror's own, unchanged.
import { Extension } from '@tiptap/core';
import { DOMSerializer, Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorHost } from './host-types';

/** On a clipboard image, the artifact its asset belongs to. */
const SOURCE_ATTR = 'data-maws-artifact';

declare module '@tiptap/core' {
  interface EditorEvents {
    /** A paste of another document's images landed nothing; `message` says why. */
    assetPasteFailed: { message: string };
  }
}

export interface AssetPasteOptions {
  /** The document this editor shows. */
  artifactId: string | null;
  copyAsset: EditorHost['copyAsset'] | null;
}

// The schema's own serializer, with every asset image it writes naming `artifactId`.
function stampingSerializer(schema: Schema, artifactId: string): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  return new (class extends DOMSerializer {
    override serializeFragment(...args: Parameters<DOMSerializer['serializeFragment']>): HTMLElement | DocumentFragment {
      const dom = super.serializeFragment(...args);
      for (const img of dom.querySelectorAll('img[data-asset-id]')) img.setAttribute(SOURCE_ATTR, artifactId);
      return dom;
    }
  })(base.nodes, base.marks);
}

// The artifact each clipboard image names, by its asset id.
function namedSources(html: string, document: Document): Map<string, string> {
  const sources = new Map<string, string>();
  if (!html.includes(SOURCE_ATTR)) return sources;
  const template = document.createElement('template'); // inert: nothing in it loads
  template.innerHTML = html;
  for (const img of template.content.querySelectorAll(`img[data-asset-id][${SOURCE_ATTR}]`)) sources.set(img.getAttribute('data-asset-id')!, img.getAttribute(SOURCE_ATTR)!);
  return sources;
}

const keyOf = (source: string, ref: string) => `${source}\n${ref}`;

function mapImages(fragment: Fragment, map: (image: PMNode) => PMNode): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => nodes.push(node.type.name === 'image' ? map(node) : node.isLeaf ? node : node.copy(mapImages(node.content, map))));
  return Fragment.fromArray(nodes);
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const AssetPaste = Extension.create<AssetPasteOptions>({
  name: 'assetPaste',
  priority: 1, // its paste handler last (Tiptap runs a higher priority's plugins first; 0 reads as the default 100)
  addOptions: () => ({ artifactId: null, copyAsset: null }),
  addProseMirrorPlugins() {
    const { artifactId, copyAsset } = this.options;
    if (!artifactId || !copyAsset) return [];
    const editor = this.editor;
    const failed = (view: EditorView, message: string) => void (view.isDestroyed || editor.emit('assetPasteFailed', { message }));

    // what the paste would have landed, with each foreign image's ref and asset id its copy's
    const land = async (view: EditorView, slice: Slice, sources: Map<string, string>, foreign: Map<string, { source: string; ref: string }>) => {
      const copies = new Map<string, { assetId: string; ref: string }>();
      try {
        for (const [key, { source, ref }] of foreign) copies.set(key, await copyAsset(source, ref, artifactId));
      } catch (error) {
        return failed(view, `Couldn’t paste the ${foreign.size === 1 ? 'image' : 'images'} from another document: ${reason(error)}`);
      }
      if (view.isDestroyed) return;
      if (!view.editable) return failed(view, 'Couldn’t paste: the document stopped taking edits while the images were copied');
      const content = mapImages(slice.content, (image) => {
        const source = sources.get(String(image.attrs.assetId));
        const copied = source === undefined ? undefined : copies.get(keyOf(source, String(image.attrs.src)));
        return copied ? image.type.create({ ...image.attrs, src: copied.ref, assetId: copied.assetId }, null, image.marks) : image;
      });
      // as ProseMirror's own paste lands a slice (prosemirror-view's doPaste)
      const single = slice.openStart === 0 && slice.openEnd === 0 && content.childCount === 1 ? content.firstChild : null;
      const tr = single ? view.state.tr.replaceSelectionWith(single, false) : view.state.tr.replaceSelection(new Slice(content, slice.openStart, slice.openEnd));
      view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
    };

    return [
      new Plugin({
        key: new PluginKey('assetPaste'),
        props: {
          clipboardSerializer: stampingSerializer(editor.schema, artifactId),
          handlePaste: (view, event, slice) => {
            const sources = namedSources(event.clipboardData?.getData('text/html') ?? '', view.dom.ownerDocument);
            const foreign = new Map<string, { source: string; ref: string }>();
            slice.content.descendants((node) => {
              const source = node.type.name === 'image' && node.attrs.assetId ? sources.get(String(node.attrs.assetId)) : undefined;
              if (source !== undefined && source !== artifactId) foreign.set(keyOf(source, String(node.attrs.src)), { source, ref: String(node.attrs.src) });
            });
            if (foreign.size === 0) return false;
            void land(view, slice, sources, foreign);
            return true;
          },
        },
      }),
    ];
  },
});
