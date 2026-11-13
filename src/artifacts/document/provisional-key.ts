// P4-A2 (X35, rule 1): the document editor's provisional layer's plugin key, apart from the React-bound extension
// (editor/provisional.ts); a redraw carries this key's meta. The schema's repairs once told a redraw by it; since U10a
// they answer only a change of the person's to the content (`guard` in ./schema.ts), so no redraw is named there.
import { PluginKey } from '@tiptap/pm/state';

export const provisionalKey = new PluginKey('provisional');
