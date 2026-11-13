// Test data only, never in `ACTIONS` (the U6a execution document, Interfaces F and decision 12): rows shaped as the
// wave's siblings will add them, so a test of the menu, the groups, the dispatcher, the palette or the capture can run
// over a table extended with them and prove that a later row needs no edit in U6's files. Each sits where nothing real
// can collide with it: the `menu` row on a chord no row, tab item or menu role holds, in a submenu no real row names (as
// U3's Edit ▸ Find rows will be); the `fixed` row as U4's editor keys will be; the third shares ⌘Enter on purpose, as
// U4's `composer.queue` will with `composer.send`. None of their ids is one build F knows, so none is rebindable.
import { ACTIONS, type ActionId, type ActionSpec, type ActionTable } from './actions';

export const SAMPLE_ROWS = {
  'sample.menu': { title: 'Sample menu row', chord: 'Ctrl+Alt+Shift+F12', sink: 'menu', menu: 'edit', submenu: 'Sample', scope: 'app' },
  'sample.fixed': { title: 'Sample fixed key', chord: 'Shift+Enter', sink: 'renderer', menu: null, scope: 'composer', fixed: true },
  'sample.shared': { title: 'Sample shared chord', chord: 'Cmd+Enter', sink: 'renderer', menu: null, scope: 'composer' },
} as const satisfies Record<string, ActionSpec>;

export const SAMPLE_IDS = Object.keys(SAMPLE_ROWS) as ActionId[];
export const sample = (id: keyof typeof SAMPLE_ROWS) => id as ActionId;

// Today's table with the sample rows after it.
export const EXTENDED_TABLE = { ...ACTIONS, ...SAMPLE_ROWS } as unknown as ActionTable;
