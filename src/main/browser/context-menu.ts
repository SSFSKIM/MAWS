// The page's context menu (E4a execution document, Design §4): a native `Menu.popup`, which macOS draws above the view,
// built per right-click from Electron's `ContextMenuParams` with Codex's words: on a link, Open link in new tab, Open in
// external browser, Copy link address; on an image, Copy image address; on a selection, Copy; in an editable field, Cut,
// Copy, Paste, Select all (enabled from `editFlags`); always Back, Forward, Reload, and last Inspect (DevTools detached).
// Later children add items through `registerContextMenuExtras` (E4d's Comment), consulted at popup time and placed
// before Inspect; E4a registers none.
import { clipboard, Menu, type ContextMenuParams, type MenuItemConstructorOptions, type PopupOptions } from 'electron';
import type { BrowserTab } from '@shared/browser/tab';
import { validateBrowserUrl } from '@shared/browser/url';
import type { Navigator } from './navigation';
import type { TabEntry, TabStore } from './tabs';

export type ContextMenuExtra = (params: ContextMenuParams, tab: BrowserTab) => MenuItemConstructorOptions[];

const extras: ContextMenuExtra[] = [];

export function registerContextMenuExtras(extra: ContextMenuExtra): () => void {
  extras.push(extra);
  return () => {
    const at = extras.indexOf(extra);
    if (at >= 0) extras.splice(at, 1);
  };
}

export interface ContextMenuActions {
  openInNewTab(url: string): void;
  openExternal(url: string): void;
  copyText(text: string): void;
  navigate(to: 'back' | 'forward' | 'reload'): void;
  edit(command: 'cut' | 'copy' | 'paste' | 'selectAll'): void;
  inspect(x: number, y: number): void;
}

const LABELS = {
  openInNewTab: 'Open link in new tab',
  openExternal: 'Open in external browser',
  copyLink: 'Copy link address',
  copyImage: 'Copy image address',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select all',
  back: 'Back',
  forward: 'Forward',
  reload: 'Reload',
  inspect: 'Inspect',
} as const;

const leavesForOutside = (url: string) => validateBrowserUrl(url).ok || /^mailto:/i.test(url); // what openExternalUrl admits

export function contextMenuTemplate(
  params: ContextMenuParams,
  tab: Pick<BrowserTab, 'canGoBack' | 'canGoForward'>,
  actions: ContextMenuActions,
  registered: readonly ContextMenuExtra[] = extras,
): MenuItemConstructorOptions[] {
  const sections: MenuItemConstructorOptions[][] = [];
  const { linkURL, srcURL, mediaType, isEditable, selectionText, editFlags } = params;
  if (linkURL) {
    sections.push([
      { label: LABELS.openInNewTab, enabled: validateBrowserUrl(linkURL).ok, click: () => actions.openInNewTab(linkURL) },
      { label: LABELS.openExternal, enabled: leavesForOutside(linkURL), click: () => actions.openExternal(linkURL) },
      { label: LABELS.copyLink, click: () => actions.copyText(linkURL) },
    ]);
  }
  if (mediaType === 'image' && srcURL) sections.push([{ label: LABELS.copyImage, click: () => actions.copyText(srcURL) }]);
  if (isEditable) {
    sections.push([
      { label: LABELS.cut, enabled: editFlags.canCut, click: () => actions.edit('cut') },
      { label: LABELS.copy, enabled: editFlags.canCopy, click: () => actions.edit('copy') },
      { label: LABELS.paste, enabled: editFlags.canPaste, click: () => actions.edit('paste') },
      { label: LABELS.selectAll, enabled: editFlags.canSelectAll, click: () => actions.edit('selectAll') },
    ]);
  } else if (selectionText.trim() !== '') {
    sections.push([{ label: LABELS.copy, click: () => actions.edit('copy') }]);
  }
  sections.push([
    { label: LABELS.back, enabled: tab.canGoBack, click: () => actions.navigate('back') },
    { label: LABELS.forward, enabled: tab.canGoForward, click: () => actions.navigate('forward') },
    { label: LABELS.reload, click: () => actions.navigate('reload') },
  ]);
  const extra = registered.flatMap((add) => add(params, tab as BrowserTab));
  if (extra.length > 0) sections.push(extra);
  sections.push([{ label: LABELS.inspect, click: () => actions.inspect(params.x, params.y) }]);
  return sections.flatMap((section, i) => (i === 0 ? section : [{ type: 'separator' as const }, ...section]));
}

export interface ContextMenuDeps {
  store: Pick<TabStore, 'entry' | 'open'>;
  navigator: Pick<Navigator, 'navigate'>;
  openExternal(url: string): void;
  popup?(template: MenuItemConstructorOptions[], options: Pick<PopupOptions, 'window' | 'frame'>): void;
}

// The frame the menu was opened on lets macOS offer its own features (Writing Tools) as it would in Chrome.
const nativePopup = (template: MenuItemConstructorOptions[], options: Pick<PopupOptions, 'window' | 'frame'>) => Menu.buildFromTemplate(template).popup(options);

export function attachContextMenu(entry: TabEntry, { store, navigator, openExternal, popup = nativePopup }: ContextMenuDeps): void {
  const view = entry.view!;
  const wc = view.webContents;
  const { tabId } = entry.tab;
  wc.on('context-menu', (_event, params) => {
    if (store.entry(tabId) !== entry || entry.view !== view) return;
    const actions: ContextMenuActions = {
      // Chrome's: in the background; in this page's partition (its cookies), as a window.open child is
      openInNewTab: (url) => void store.open({ appSessionId: entry.tab.appSessionId, url, select: false, partition: entry.tab.partition }),
      openExternal,
      copyText: (text) => clipboard.writeText(text),
      navigate: (to) => void navigator.navigate(tabId, to),
      edit: (command) => wc[command](),
      inspect: (x, y) => {
        wc.openDevTools({ mode: 'detach' });
        wc.inspectElement(x, y);
      },
    };
    popup(contextMenuTemplate(params, entry.tab, actions), { window: entry.host ?? undefined, frame: params.frame ?? undefined });
  });
}
