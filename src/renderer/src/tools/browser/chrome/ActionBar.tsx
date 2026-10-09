// cua #90: the extensions action bar (its spec's "The extensions action bar"): right of the address field, one 24 px
// button per extension loaded in the tab's imported profile, its icon (a puzzle piece without one) and its title as the
// tooltip, as Chrome's toolbar draws them. A click opens the extension's popup, which main places under the button as a
// native view above the page (so no cover is held); the button stays pressed while it is open, and a second click
// closes it. An extension with no popup here is drawn dimmed, its tooltip saying so, and a click does nothing.
// Right-click pops the action's native menu (its name, Options, Manage extensions…).
//
// When the inline icons would leave the address field under 160 px (the session panel), they fold into one puzzle
// button whose native menu lists every action, Options per extension, and Manage extensions…; a wide main tab shows
// them all. Every command names the tab, from which main reads the partition and the window.
import { useLayoutEffect, useState, type MouseEvent } from 'react';
import type { ExtensionAction } from '@shared/browser/extensions';
import { DEFAULT_PARTITION, type BrowserTab } from '@shared/browser/tab';
import { ipc } from '../../../ipc/client';
import { useCommand } from '../../../ipc/query';
import { BROWSER_COPY } from '../copy';
import { PuzzleIcon } from '../icons';
import { useExtensionPopup } from '../store';
import { foldsActions } from './action-bar';

const COPY = BROWSER_COPY.extensions;
const BUTTON =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent [-webkit-app-region:no-drag] hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-pressed:bg-bg-active aria-pressed:text-fg';

// A control's box in the window's CSS px, whole, where main anchors the popup or the menu.
const boxOf = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
};
const warned = (what: string) => (result: { ok: boolean; error?: { message: string } }) => {
  if (!result.ok) console.warn(`[browser] ${what} failed: ${result.error?.message}`);
};

export interface ActionBarProps {
  tab: BrowserTab;
  addressBox: HTMLElement | null; // the address field's slot on screen, whose width decides the fold
}

// The bar for a tab of an imported profile with extensions loaded; nothing otherwise (the Default partition has none,
// and asks nothing).
export function ActionBar(props: ActionBarProps) {
  return props.tab.partition === DEFAULT_PARTITION ? null : <ProfileActions {...props} />;
}

function ProfileActions({ tab, addressBox }: ActionBarProps) {
  const actions = useCommand('browser.extensions.actions', { partition: tab.partition }).data?.actions ?? [];
  return actions.length === 0 ? null : <Bar tab={tab} actions={actions} addressBox={addressBox} />;
}

function Bar({ tab, actions, addressBox }: ActionBarProps & { actions: ExtensionAction[] }) {
  const { tabId } = tab;
  const open = useExtensionPopup(tabId);
  const [folded, setFolded] = useState(false);
  const count = actions.length;

  // The fold follows the address field's width on every layout that moves it (the window, the panel, the icons), and
  // the slot itself: a new element (an internal tab's field for a page's, or back) is measured and observed in its stead.
  useLayoutEffect(() => {
    const element = addressBox;
    if (!element) return;
    const measure = () => setFolded((was) => foldsActions(element.getBoundingClientRect().width, was, count));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [addressBox, count]);

  const click = (action: ExtensionAction, button: Element) => {
    if (!action.hasPopup) return;
    void ipc.invoke('browser.extensions.action.click', { tabId, extensionId: action.extensionId, anchor: boxOf(button) }).then(warned('opening an extension popup'));
  };
  const menu = (action: ExtensionAction, event: MouseEvent) => {
    event.preventDefault();
    const anchor = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
    void ipc.invoke('browser.extensions.action.menu', { tabId, extensionId: action.extensionId, anchor }).then(warned('an extension menu'));
  };

  if (folded) {
    return (
      <button
        type="button"
        data-extensions-puzzle=""
        aria-label={COPY.puzzle}
        title={COPY.puzzle}
        aria-pressed={open !== null}
        onClick={(event) => void ipc.invoke('browser.extensions.puzzle', { tabId, anchor: boxOf(event.currentTarget) }).then(warned('the extensions menu'))}
        className={BUTTON}
      >
        <PuzzleIcon className="size-4" />
      </button>
    );
  }
  return (
    <div role="toolbar" aria-label={COPY.bar} data-extension-actions="" className="flex shrink-0 items-center gap-0.5">
      {actions.map((action) => (
        <button
          key={action.extensionId}
          type="button"
          data-extension-action={action.extensionId}
          aria-label={action.title}
          aria-description={action.hasPopup ? undefined : COPY.noPopup}
          aria-disabled={!action.hasPopup || undefined}
          aria-pressed={action.hasPopup ? open === action.extensionId : undefined}
          title={COPY.actionTitle(action.title, action.hasPopup)}
          onClick={(event) => click(action, event.currentTarget)}
          onContextMenu={(event) => menu(action, event)}
          className={BUTTON}
        >
          <span className={`inline-flex ${action.hasPopup ? '' : 'opacity-50'}`}>
            {action.icon ? <img alt="" src={action.icon} draggable={false} className="size-4" /> : <PuzzleIcon className="size-4" />}
          </span>
        </button>
      ))}
    </div>
  );
}
