import { EventEmitter } from 'node:events';
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserTab } from '@shared/browser/tab';

vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn() }, clipboard: { writeText: vi.fn() } }));

const { attachContextMenu, contextMenuTemplate, registerContextMenuExtras } = await import('./context-menu');

const tab = { canGoBack: true, canGoForward: false } as BrowserTab;
const params = (more: Partial<ContextMenuParams> = {}): ContextMenuParams =>
  ({
    x: 10,
    y: 20,
    linkURL: '',
    srcURL: '',
    mediaType: 'none',
    isEditable: false,
    selectionText: '',
    editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canDelete: false, canSelectAll: false, canEditRichly: false },
    ...more,
  }) as ContextMenuParams;

function actions() {
  return { openInNewTab: vi.fn(), openExternal: vi.fn(), copyText: vi.fn(), navigate: vi.fn(), edit: vi.fn(), inspect: vi.fn() };
}

// The template as label and enabled, separators as '-'.
const shape = (template: MenuItemConstructorOptions[]) => template.map((item) => (item.type === 'separator' ? '-' : `${item.label}${item.enabled === false ? ' (disabled)' : ''}`));
const click = (template: MenuItemConstructorOptions[], label: string) => (template.find((item) => item.label === label)!.click as () => void)();

describe('contextMenuTemplate (E4a Design §4)', () => {
  it('always: Back, Forward, Reload, then Inspect, enabled from the tab\'s history', () => {
    const a = actions();
    const template = contextMenuTemplate(params(), tab, a, []);
    expect(shape(template)).toEqual(['Back', 'Forward (disabled)', 'Reload', '-', 'Inspect']);
    click(template, 'Back');
    expect(a.navigate).toHaveBeenCalledWith('back');
    click(template, 'Inspect');
    expect(a.inspect).toHaveBeenCalledWith(10, 20);
  });

  it('on a link: Open link in new tab, Open in external browser, Copy link address', () => {
    const a = actions();
    const template = contextMenuTemplate(params({ linkURL: 'https://b.test/x' }), tab, a, []);
    expect(shape(template).slice(0, 4)).toEqual(['Open link in new tab', 'Open in external browser', 'Copy link address', '-']);
    click(template, 'Open link in new tab');
    expect(a.openInNewTab).toHaveBeenCalledWith('https://b.test/x');
    click(template, 'Open in external browser');
    expect(a.openExternal).toHaveBeenCalledWith('https://b.test/x');
    click(template, 'Copy link address');
    expect(a.copyText).toHaveBeenCalledWith('https://b.test/x');
  });

  it('a mailto: link cannot open in a tab but may go out; another scheme can only be copied', () => {
    expect(shape(contextMenuTemplate(params({ linkURL: 'mailto:e4a@example.test' }), tab, actions(), [])).slice(0, 3)).toEqual([
      'Open link in new tab (disabled)',
      'Open in external browser',
      'Copy link address',
    ]);
    expect(shape(contextMenuTemplate(params({ linkURL: 'zoommtg://x' }), tab, actions(), [])).slice(0, 3)).toEqual([
      'Open link in new tab (disabled)',
      'Open in external browser (disabled)',
      'Copy link address',
    ]);
  });

  it('on an image: Copy image address; on a selection: Copy', () => {
    const a = actions();
    const image = contextMenuTemplate(params({ mediaType: 'image', srcURL: 'https://b.test/i.png' }), tab, a, []);
    expect(shape(image)[0]).toBe('Copy image address');
    click(image, 'Copy image address');
    expect(a.copyText).toHaveBeenCalledWith('https://b.test/i.png');
    const selection = contextMenuTemplate(params({ selectionText: 'words' }), tab, a, []);
    expect(shape(selection).slice(0, 2)).toEqual(['Copy', '-']);
    click(selection, 'Copy');
    expect(a.edit).toHaveBeenCalledWith('copy');
  });

  it('in an editable field: Cut, Copy, Paste, Select all, enabled from editFlags', () => {
    const a = actions();
    const template = contextMenuTemplate(
      params({ isEditable: true, selectionText: 'x', editFlags: { canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: false, canDelete: false, canSelectAll: true, canEditRichly: false } }),
      tab,
      a,
      [],
    );
    expect(shape(template).slice(0, 5)).toEqual(['Cut', 'Copy', 'Paste (disabled)', 'Select all', '-']);
    click(template, 'Select all');
    expect(a.edit).toHaveBeenCalledWith('selectAll');
  });

  it('registered extras join before Inspect, consulted at popup time with the params and the tab', () => {
    const extra = vi.fn(() => [{ label: 'Comment' }]);
    const unregister = registerContextMenuExtras(extra);
    try {
      const p = params();
      expect(shape(contextMenuTemplate(p, tab, actions()))).toEqual(['Back', 'Forward (disabled)', 'Reload', '-', 'Comment', '-', 'Inspect']);
      expect(extra).toHaveBeenCalledWith(p, tab);
    } finally {
      unregister();
    }
    expect(shape(contextMenuTemplate(params(), tab, actions()))).toEqual(['Back', 'Forward (disabled)', 'Reload', '-', 'Inspect']);
  });
});

describe('attachContextMenu', () => {
  it('pops the menu up over the view\'s window; the actions reach the navigator, the store and the page', () => {
    const webContents = Object.assign(new EventEmitter(), { cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn(), openDevTools: vi.fn(), inspectElement: vi.fn() });
    const host = { id: 1 };
    const entry = { tab: { ...tab, tabId: 'b_000000000001', appSessionId: 'App-A' }, view: { webContents }, host };
    const store = { entry: () => entry, open: vi.fn() };
    const navigator = { navigate: vi.fn() };
    const openExternal = vi.fn();
    const popup = vi.fn();
    attachContextMenu(entry as never, { store: store as never, navigator, openExternal, popup });
    webContents.emit('context-menu', {}, params({ linkURL: 'https://b.test/x', isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } as never }));
    const [template, window] = popup.mock.calls[0]! as [MenuItemConstructorOptions[], unknown];
    expect(window).toBe(host);
    click(template, 'Open link in new tab');
    expect(store.open).toHaveBeenCalledWith({ appSessionId: 'App-A', url: 'https://b.test/x', select: false });
    click(template, 'Reload');
    expect(navigator.navigate).toHaveBeenCalledWith('b_000000000001', 'reload');
    click(template, 'Paste');
    expect(webContents.paste).toHaveBeenCalled();
    click(template, 'Inspect');
    expect(webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
    expect(webContents.inspectElement).toHaveBeenCalledWith(10, 20);
  });
});
