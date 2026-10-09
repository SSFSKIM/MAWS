// cua #90: the bookmarks bar (cua board #90's spec, "The bar"): an imported profile's Chrome bookmarks bar under the
// navigation row, 28 px, read-only. Chips in Chrome's order, each its 16 px favicon then its name (an unnamed bookmark
// is its icon alone, as in Chrome); folders open a native menu, which macOS draws above the page so the page stays live
// (no cover is held). The chips the bar cannot fit are measured on every resize and hidden; the » slot at the right
// end lists them and, after a separator, Other bookmarks and Mobile bookmarks (main builds and pops that menu too).
//
// A chip's click loads the bookmark in the tab (main stamps it as the person's, cua board #98); ⌘-click or the middle
// button opens it in a new unselected tab. Every command names the tab, from which main reads the partition. The tree
// re-reads on `browser.bookmarks.changed` (import/store.ts invalidates it); icons are the ones the partition's pages
// already showed (`browser.bookmarks.favicons`, no fetch), else a page glyph.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { BookmarkNode, BookmarkTree } from '@shared/browser/bookmarks';
import type { BrowserTab } from '@shared/browser/tab';
import { ipc } from '../../../ipc/client';
import { useCommand } from '../../../ipc/query';
import { BROWSER_COPY } from '../copy';
import { FolderIcon, MoreBookmarksIcon, PageIcon } from '../icons';
import { useBrowserImport } from '../import/store';
import { useBookmarksBar } from '../settings';
import { barOrigins, barShown, chipHow, firstHidden, originOf } from './bookmarks-bar';

export const BOOKMARKS_BAR_HEIGHT = 28; // px, a whole number (the rows' rule: the pane starts on an integral edge)

// The bar for a tab of an imported profile; nothing for any other tab or while it has nothing to show.
export function BookmarksBar({ tab }: { tab: BrowserTab }) {
  const { partition } = tab;
  const record = useBrowserImport((s) => s.records.find((candidate) => candidate.partition === partition));
  const setting = useBookmarksBar();
  const wanted = record?.bookmarks != null && setting === 'shown';
  const tree = useCommand('browser.bookmarks.tree', { partition }, { enabled: wanted }).data?.tree;
  if (!barShown(record, setting, tree)) return null;
  return <Bar tab={tab} tree={tree!} />;
}

type Anchor = { x: number; y: number };
// Where a native menu pops for a control: under its left edge, in the window's CSS px.
const below = (element: Element): Anchor => {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.left), y: Math.round(rect.bottom) };
};

function Bar({ tab, tree }: { tab: BrowserTab; tree: BookmarkTree }) {
  const { tabId, partition, favicon } = tab;
  const chips = tree.bar.children;
  const list = useRef<HTMLDivElement>(null);
  const [hiddenFrom, setHiddenFrom] = useState<number | null>(null);
  const origins = useMemo(() => barOrigins(chips), [chips]);
  const icons = useCommand('browser.bookmarks.favicons', { partition, origins });
  const { refetch } = icons;
  useEffect(() => void refetch(), [favicon, refetch]); // a page of the partition showed a (new) icon

  // The chips that fit, measured after every layout that can move them: a resize of the bar (the window, the panel, the
  // » appearing) and a change of the chips or their icons.
  const iconData = icons.data;
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const left = element.getBoundingClientRect().left;
      const rights = [...element.children].map((chip) => chip.getBoundingClientRect().right - left);
      setHiddenFrom(firstHidden(rights, element.clientWidth));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [chips, iconData]);

  const open = (nodeId: number, how: 'current' | 'newTab') =>
    void ipc.invoke('browser.bookmarks.open', { tabId, nodeId, how }).then((result) => {
      if (!result.ok) console.warn(`[browser] a bookmark could not be opened: ${result.error.message}`);
    });
  const menu = (request: { kind: 'folder'; nodeId: number } | { kind: 'overflow'; hiddenFrom: number }, anchor: Anchor) =>
    void ipc.invoke('browser.bookmarks.menu', { tabId, request, anchor }).then((result) => {
      if (!result.ok) console.warn(`[browser] a bookmarks menu could not be opened: ${result.error.message}`);
    });

  const roots = tree.other.children.length > 0 || tree.mobile.children.length > 0;
  return (
    <div role="toolbar" aria-label={BROWSER_COPY.bookmarks.bar} data-bookmarks-bar="" className="flex h-7 shrink-0 items-center gap-0.5 px-1">
      <div ref={list} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {chips.map((node, index) => (
          <Chip
            key={node.id}
            node={node}
            icon={node.kind === 'url' ? (iconData?.icons[originOf(node.url) ?? ''] ?? null) : null}
            hidden={hiddenFrom !== null && index >= hiddenFrom}
            onOpen={(how) => open(node.id, how)}
            onMenu={(anchor) => menu({ kind: 'folder', nodeId: node.id }, anchor)}
          />
        ))}
      </div>
      {(hiddenFrom !== null || roots) && (
        <button
          type="button"
          data-bookmarks-more=""
          aria-label={BROWSER_COPY.bookmarks.more}
          title={BROWSER_COPY.bookmarks.more}
          onClick={(event) => menu({ kind: 'overflow', hiddenFrom: hiddenFrom ?? chips.length }, below(event.currentTarget))}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
        >
          <MoreBookmarksIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

interface ChipProps {
  node: BookmarkNode;
  icon: string | null;
  hidden: boolean; // past the room: listed in the » menu instead
  onOpen(how: 'current' | 'newTab'): void;
  onMenu(anchor: Anchor): void;
}

const CHIP = 'flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';

function Chip({ node, icon, hidden, onOpen, onMenu }: ChipProps) {
  if (node.kind === 'folder') {
    return (
      <button
        type="button"
        data-bookmark-folder={node.id}
        title={BROWSER_COPY.bookmarks.folderTitle(node.name)}
        onClick={(event) => onMenu(below(event.currentTarget))}
        className={`${CHIP} ${hidden ? 'invisible' : ''}`}
        inert={hidden}
      >
        <FolderIcon className="size-4 text-fg-muted" />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
    );
  }
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onOpen(chipHow(event));
  };
  return (
    <button
      type="button"
      data-bookmark={node.id}
      aria-label={node.name === '' ? node.url : undefined}
      title={BROWSER_COPY.bookmarks.chipTitle(node.name, node.url)}
      onClick={click}
      onAuxClick={(event) => event.button === 1 && click(event)}
      className={`${CHIP} ${hidden ? 'invisible' : ''}`}
      inert={hidden}
    >
      {icon ? <img alt="" src={icon} className="size-4 shrink-0" /> : <PageIcon className="size-4 text-fg-muted" />}
      {node.name !== '' && <span className="min-w-0 truncate">{node.name}</span>}
    </button>
  );
}
