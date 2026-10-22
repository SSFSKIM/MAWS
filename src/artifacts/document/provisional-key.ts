// P4-A2 (X35, rule 1): the document editor's provisional layer's plugin key, apart from the React-bound extension
// (editor/provisional.ts) so the Node-importable schema can tell the layer's redraws from the person's transactions:
// a redraw carries this key's meta, and the document-repairing plugins (`guard` in ./schema.ts) never answer one.
import { PluginKey } from '@tiptap/pm/state';

export const provisionalKey = new PluginKey('provisional');
