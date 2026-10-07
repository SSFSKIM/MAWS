// E4a (Task 3.3): the navigation row's "…" (Design §4 "Navigation row"): a Radix DropdownMenu, so while it is open its
// popper covers the pane under it (Design §3's popper rule). What it offers needs a tab, and a live page where the page
// itself acts (find, zoom, Inspect): a suspended tab or one that never navigated has none.
import { DropdownMenu } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import { validateBrowserUrl } from '@shared/browser/url';
import type { AppSessionId } from '@shared/graph/ids';
import { IconButton } from '../../../app/IconButton';
import { panelHost } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { closeTab, inspect, openExternal, zoom } from '../actions';
import { BROWSER_COPY } from '../copy';
import { MoreIcon } from '../icons';
import { raiseNotice } from '../store';

export interface OverflowMenuProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  tab: BrowserTab | null;
  onFind(): void;
}

const ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

export function OverflowMenu({ appSessionId, surface, tab, onFind }: OverflowMenuProps) {
  const copy = BROWSER_COPY.menu;
  const web = tab ? validateBrowserUrl(tab.url) : null;
  const url = web?.ok ? web.url : null; // the page's address, when it has one
  const live = tab !== null && !tab.suspended && tab.url !== ''; // a page in a view
  const toFind = useRef(false); // Find in page chosen: the find bar keeps the keyboard, not the menu's trigger
  const copyUrl = (tab: BrowserTab, url: string) =>
    void navigator.clipboard.writeText(url).then(
      () => raiseNotice({ appSessionId, tabId: tab.tabId, kind: 'urlCopied' }),
      (error: unknown) => console.warn('[browser] copying the URL failed', error),
    );
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={BROWSER_COPY.options}>
          <MoreIcon />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          onCloseAutoFocus={(event) => {
            if (!toFind.current) return;
            toFind.current = false;
            event.preventDefault();
          }}
          className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg"
        >
          <Item disabled={url === null} onSelect={() => url && openExternal(url)}>
            {copy.openExternal}
          </Item>
          <Item
            disabled={!live}
            onSelect={() => {
              toFind.current = true;
              onFind();
            }}
          >
            {copy.find}
          </Item>
          <Separator />
          <Item disabled={!live} onSelect={() => tab && zoom(tab.tabId, 'in')}>
            {copy.zoomIn}
          </Item>
          <Item disabled={!live} onSelect={() => tab && zoom(tab.tabId, 'out')}>
            {copy.zoomOut}
          </Item>
          <Item disabled={!live || tab?.zoom === 1} onSelect={() => tab && zoom(tab.tabId, 'reset')}>
            {copy.resetZoom}
          </Item>
          <Separator />
          {surface === 'panel' ? (
            <Item disabled={tab === null} onSelect={() => tab && useLayout.getState().openTab({ kind: 'browser', appSessionId, browserTabId: tab.tabId })}>
              {copy.openInTab}
            </Item>
          ) : (
            <Item disabled={tab === null} onSelect={() => tab && panelHost.addTool('browser', { appSessionId, params: { tabId: tab.tabId, appSessionId } })}>
              {copy.showInPanel}
            </Item>
          )}
          <Item disabled={url === null} onSelect={() => tab && url && copyUrl(tab, url)}>
            {copy.copyUrl}
          </Item>
          <Item disabled={!live} onSelect={() => tab && inspect(tab.tabId)}>
            {copy.inspect}
          </Item>
          <Separator />
          <Item disabled={tab === null} onSelect={() => tab && closeTab(tab.tabId)}>
            {copy.closeTab}
          </Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Item({ disabled, onSelect, children }: { disabled: boolean; onSelect(): void; children: ReactNode }) {
  return (
    <DropdownMenu.Item disabled={disabled} onSelect={onSelect} className={ITEM}>
      {children}
    </DropdownMenu.Item>
  );
}

const Separator = () => <DropdownMenu.Separator className="my-1 h-px bg-border" />;
