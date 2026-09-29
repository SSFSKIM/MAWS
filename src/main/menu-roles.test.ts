// C11 (M6, the carried M5 Minor): the chord capture refuses the application menu's role chords from one list in
// `@shared/keymap/menu-roles`. This pins that list to the menu main actually builds: every role item in the template is
// listed, with a chord or without one, and nothing is listed that the template does not hold.
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { ACTIONS, ACTION_IDS, effectiveChord, type ActionId } from '@shared/keymap/actions';
import { parseChord } from '@shared/keymap/chord';
import { MENU_ROLE_CHORDS, MENU_ROLES_WITHOUT_CHORD } from '@shared/keymap/menu-roles';

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (template: unknown) => ({ template }), setApplicationMenu: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { menuTemplate } = await import('./menu');

type Item = MenuItemConstructorOptions;
const items = (template: Item[]): Item[] => template.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? items(item.submenu) : [])]);

describe('the reserved menu-role chords follow the menu', () => {
  it('lists exactly the role items the template builds', () => {
    const template = menuTemplate(ACTIONS, {}, new Set<ActionId>(ACTION_IDS), vi.fn());
    // A submenu's own role (`window`, `help`) names the menu, not an item with a chord.
    const roles = items(template).filter((item) => item.role !== undefined && item.submenu === undefined).map((item) => item.role as string);
    const listed = [...MENU_ROLE_CHORDS.map((r) => r.role), ...MENU_ROLES_WITHOUT_CHORD];
    expect([...roles].sort()).toEqual([...listed].sort());
  });

  it('every reserved chord parses, and no action is bound to one by default', () => {
    const same = (a: string, b: string) => JSON.stringify(parseChord(a)) === JSON.stringify(parseChord(b));
    for (const { chord } of MENU_ROLE_CHORDS) {
      expect(() => parseChord(chord)).not.toThrow();
      for (const id of ACTION_IDS) {
        const held = effectiveChord(id, {});
        if (held !== null) expect(same(held, chord), `${id} holds ${chord}`).toBe(false);
      }
    }
  });
});
