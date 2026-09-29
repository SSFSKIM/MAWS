// The application menu's role items and the chords Electron gives them (C11, M6: the carried M5 Minor). A role item's
// accelerator holds its chord window-wide, so the Settings tab's chord capture refuses these for every action, naming
// the item. The roles are the ones `src/main/menu.ts` builds (pinned by `src/main/menu-roles.test.ts`); the chords are
// Electron 44's `getDefaultRoleAccelerator()` for each role on macOS, read from a running Electron on 2026-09-29, written
// in C5's accelerator vocabulary.

export interface MenuRoleChord {
  role: string;
  item: string; // the menu item as it reads
  chord: string;
}

export const MENU_ROLE_CHORDS: readonly MenuRoleChord[] = [
  { role: 'undo', item: 'Undo', chord: 'Cmd+Z' },
  { role: 'redo', item: 'Redo', chord: 'Cmd+Shift+Z' },
  { role: 'cut', item: 'Cut', chord: 'Cmd+X' },
  { role: 'copy', item: 'Copy', chord: 'Cmd+C' },
  { role: 'paste', item: 'Paste', chord: 'Cmd+V' },
  { role: 'pasteAndMatchStyle', item: 'Paste and Match Style', chord: 'Cmd+Alt+Shift+V' },
  { role: 'selectAll', item: 'Select All', chord: 'Cmd+A' },
  { role: 'hide', item: 'Hide MAWS', chord: 'Cmd+H' },
  { role: 'hideOthers', item: 'Hide Others', chord: 'Cmd+Alt+H' },
  { role: 'quit', item: 'Quit MAWS', chord: 'Cmd+Q' },
  { role: 'reload', item: 'Reload', chord: 'Cmd+R' },
  { role: 'forceReload', item: 'Force Reload', chord: 'Cmd+Shift+R' },
  { role: 'toggleDevTools', item: 'Toggle Developer Tools', chord: 'Cmd+Alt+I' },
  { role: 'togglefullscreen', item: 'Toggle Full Screen', chord: 'Cmd+Ctrl+F' },
  { role: 'minimize', item: 'Minimize', chord: 'Cmd+M' },
];

// The menu's role items Electron gives no chord.
export const MENU_ROLES_WITHOUT_CHORD: readonly string[] = ['about', 'services', 'unhide', 'delete', 'zoom', 'front'];
