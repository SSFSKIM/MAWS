import { describe, expect, it, vi } from 'vitest';
import { NativeMenus, toNodes } from '../bookmarks/menu';
import type { LoadedAction } from './actions';
import { actionMenu, puzzleMenu } from './menu';

const PROBE = 'nenbjdahllkkbfanbpfmmdacjencdfpg';
const PLAIN = 'ofmpefonpiifpjlopbcacdiahhnegimn';
const loaded = (extensionId: string, name: string, more: Partial<LoadedAction> = {}): LoadedAction => ({
  extensionId, name, title: name, hasPopup: false, hasOptions: false, popupUrl: null, optionsUrl: null, iconPath: null, path: '/ext', ...more,
});
const probe = loaded(PROBE, 'MAWS probe extension', { title: 'MAWS probe', hasPopup: true, hasOptions: true });
const plain = loaded(PLAIN, 'Plain');

function handlers() {
  return { open: vi.fn(), options: vi.fn(), manage: vi.fn() };
}

describe('the puzzle menu', () => {
  it('lists every action, then Options for the ones that have it, then Manage extensions…', () => {
    const on = handlers();
    expect(toNodes(puzzleMenu([probe, plain], on))).toEqual([
      { id: `action:${PROBE}`, label: 'MAWS probe' },
      { id: `action:${PLAIN}`, label: 'Plain', enabled: false }, // no popup here: inert, as its button is
      { separator: true },
      { id: 'options', label: 'Options', children: [{ id: `options:${PROBE}`, label: 'MAWS probe extension' }] },
      { separator: true },
      { id: 'manage', label: 'Manage extensions…' },
    ]);
    expect(toNodes(puzzleMenu([plain], on))).toEqual([{ id: `action:${PLAIN}`, label: 'Plain', enabled: false }, { separator: true }, { id: 'manage', label: 'Manage extensions…' }]);
    expect(toNodes(puzzleMenu([], on))).toEqual([{ id: 'manage', label: 'Manage extensions…' }]);
  });

  it('each item does what its button and menu do, through the seam by id path', () => {
    const on = handlers();
    const menus = new NativeMenus({ e2e: true });
    const present = () => menus.present(puzzleMenu([probe, plain], on), { window: {} as never, x: 0, y: 0 });
    present();
    expect(menus.seam.pick([`action:${PROBE}`])).toBe(true);
    present();
    expect(menus.seam.pick([`action:${PLAIN}`])).toBe(false);
    expect(menus.seam.pick(['options', `options:${PROBE}`])).toBe(true);
    present();
    expect(menus.seam.pick(['manage'])).toBe(true);
    expect(on.open).toHaveBeenCalledWith(PROBE);
    expect(on.options).toHaveBeenCalledWith(PROBE);
    expect(on.manage).toHaveBeenCalledTimes(1);
  });
});

describe('an action\'s context menu', () => {
  it('names the extension, then Options when it has one, then Manage extensions…', () => {
    const on = handlers();
    expect(toNodes(actionMenu(probe, on))).toEqual([
      { id: 'name', label: 'MAWS probe extension', enabled: false },
      { separator: true },
      { id: `options:${PROBE}`, label: 'Options' },
      { id: 'manage', label: 'Manage extensions…' },
    ]);
    expect(toNodes(actionMenu(plain, on))).toEqual([{ id: 'name', label: 'Plain', enabled: false }, { separator: true }, { id: 'manage', label: 'Manage extensions…' }]);
    const menus = new NativeMenus({ e2e: true });
    menus.present(actionMenu(probe, on), { window: {} as never, x: 0, y: 0 });
    expect(menus.seam.pick([`options:${PROBE}`])).toBe(true);
    expect(on.options).toHaveBeenCalledWith(PROBE);
  });
});
