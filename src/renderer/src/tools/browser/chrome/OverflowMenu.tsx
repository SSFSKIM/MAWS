// E4a (Task 3.3): the navigation row's "…" (Design §4 "Navigation row"): a Radix DropdownMenu, so while it is open its
// popper covers the pane under it (Design §3's popper rule). What it offers needs a tab, and a live page where the page
// itself acts (find, zoom, Inspect): a suspended tab or one that never navigated has none. Find and zoom also need this
// chrome's pane to hold the view, since they act on the page as it shows (Inspect opens detached DevTools wherever).
// U12a (the UX wave's U12, l9-browser-delivery-06): Viewport after the zoom group and Copy screenshot after Copy URL, both
// where find and zoom are; Viewport also needs this pane's room (`room`, which only the pane holding the view has) and is
// not offered on an extension's options tab.
import { DropdownMenu } from 'radix-ui';
import { preserveSubmenuPointer } from '@artifacts/ui/menu-pointer';
import { useRef, type ReactNode } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import { validateBrowserUrl } from '@shared/browser/url';
import type { AppSessionId } from '@shared/graph/ids';
import { IconButton } from '../../../app/IconButton';
import { panelHost } from '../../../panel/host';
import { closeTab, copyScreenshot, inspect, openExternal, openMainTab, zoom } from '../actions';
import { BROWSER_COPY } from '../copy';
import { ChevronRightIcon, MoreIcon } from '../icons';
import { raiseNotice, requestShow } from '../store';
import type { Room } from '../viewport';
import { ViewportChoices } from './ViewportChip';

export interface OverflowMenuProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  tab: BrowserTab | null;
  owns: boolean; // this chrome's pane holds the view: find and zoom act on the page it shows
  room: Room | null; // U12a: that pane's room for a device size; null: no size is offered
  onFind(): void;
}

const ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

export function OverflowMenu({ appSessionId, surface, tab, owns, room, onFind }: OverflowMenuProps) {
  const copy = BROWSER_COPY.menu;
  const web = tab ? validateBrowserUrl(tab.url) : null;
  const url = web?.ok ? web.url : null; // the page's address, when it has one
  const live = tab !== null && !tab.suspended && tab.url !== ''; // a page in a view
  const shown = live && owns; // and in this chrome's pane, so find and zoom act on what the person sees
  const sizing = shown && room !== null && tab?.internal === null ? room : null; // U12a: the room a device size is offered in
  const toFind = useRef(false); // Find in page chosen: the find bar keeps the keyboard, not the menu's trigger
  const copyUrl = (tab: BrowserTab, url: string) =>
    void navigator.clipboard.writeText(url).then(
      () => raiseNotice({ appSessionId, tabId: tab.tabId, kind: 'urlCopied' }),
      (error: unknown) => console.warn('[browser] copying the URL failed', error),
    );
  // The tab on the other surface, and the page with it: that surface's pane may already be mounted on the tab and saying
  // "Shown in another pane" (Open in tab, then Show in panel), and it is asked to take the view, as its Show here would.
  const showOn = (target: 'panel' | 'main', tab: BrowserTab) => {
    if (target === 'main') openMainTab(appSessionId, tab.tabId);
    else panelHost.addTool('browser', { appSessionId, params: { tabId: tab.tabId, appSessionId } });
    requestShow(tab.tabId, target);
  };
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
            disabled={!shown}
            onSelect={() => {
              toFind.current = true;
              onFind();
            }}
          >
            {copy.find}
          </Item>
          <Separator />
          <Item disabled={!shown} onSelect={() => tab && zoom(tab.tabId, 'in')}>
            {copy.zoomIn}
          </Item>
          <Item disabled={!shown} onSelect={() => tab && zoom(tab.tabId, 'out')}>
            {copy.zoomOut}
          </Item>
          <Item disabled={!shown || tab?.zoom === 1} onSelect={() => tab && zoom(tab.tabId, 'reset')}>
            {copy.resetZoom}
          </Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger onPointerLeave={preserveSubmenuPointer} disabled={sizing === null} className={`${ITEM} data-[state=open]:bg-bg-hover`}>
              <span className="flex-1">{copy.viewport}</span>
              <ChevronRightIcon className="ml-4 size-3.5 text-fg-muted" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent sideOffset={4} className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
                {tab && sizing && <ViewportChoices tab={tab} room={sizing} />}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <Separator />
          {surface === 'panel' ? (
            <Item disabled={tab === null} onSelect={() => tab && showOn('main', tab)}>
              {copy.openInTab}
            </Item>
          ) : (
            <Item disabled={tab === null} onSelect={() => tab && showOn('panel', tab)}>
              {copy.showInPanel}
            </Item>
          )}
          <Item disabled={url === null} onSelect={() => tab && url && copyUrl(tab, url)}>
            {copy.copyUrl}
          </Item>
          <Item disabled={!shown} onSelect={() => tab && void copyScreenshot(appSessionId, tab.tabId)}>
            {copy.copyScreenshot}
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
