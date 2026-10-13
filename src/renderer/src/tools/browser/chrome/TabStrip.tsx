// E4a (Task 3.3): the chrome's first row (Design §4 "Tab strip"; Decision Log 17): one chip per tab of the session, in
// main's order, and "+". In the panel a chip selects its tab (the tool shows the session's selected tab); in a main tab,
// which shows its own tab, a chip opens that tab's own main tab, so one tab of a session is reachable from another.
// Chips shrink to a minimum and the strip then scrolls sideways; a suspended tab's chip is muted, a loading one's title
// shimmers. Closing a chip closes the browser tab. P3-G (M2): `trailing` sits at the row's right end (the floating
// card's pill while the card is closed over this page in the panel).
import type { KeyboardEvent, ReactNode } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { closeTab, openMainTab, openTab, selectTab } from '../actions';
import { BROWSER_COPY } from '../copy';
import { BrowserIcon, CloseIcon, PlusIcon } from '../icons';
import { tabTitle } from '../store';
import './chrome.css';

export interface TabStripProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  tabs: BrowserTab[];
  shownId: string | null; // the tab the surface shows
  trailing?: ReactNode;
}

export function TabStrip({ appSessionId, surface, tabs, shownId, trailing }: TabStripProps) {
  const show = (tabId: string) => {
    if (tabId === shownId) return;
    if (surface === 'panel') selectTab(appSessionId, tabId);
    else openMainTab(appSessionId, tabId);
  };
  // "+": an empty tab, selected in the session; a main tab moves to the new tab's own main tab.
  const add = () =>
    void openTab(appSessionId, null).then((tab) => {
      if (tab && surface === 'main') openMainTab(appSessionId, tab.tabId);
    });
  // Arrow keys move focus along the chips (the WAI-ARIA tabs pattern, manual activation), as the panel's strip does.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const chips = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    event.preventDefault();
    chips[(at + (event.key === 'ArrowRight' ? 1 : chips.length - 1)) % chips.length]!.focus();
  };

  return (
    <div className="flex h-(--row-h) shrink-0 items-center gap-0.5 px-1">
      <div role="tablist" aria-label={BROWSER_COPY.tabs} onKeyDown={onKeyDown} className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => (
          <Chip key={tab.tabId} tab={tab} selected={tab.tabId === shownId} onSelect={() => show(tab.tabId)} />
        ))}
      </div>
      <button
        type="button"
        aria-label={BROWSER_COPY.newTabAction}
        title={BROWSER_COPY.newTabAction}
        onClick={add}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
      >
        <PlusIcon className="size-3.5" />
      </button>
      {trailing && <div className="ml-auto flex shrink-0 items-center pl-1">{trailing}</div>}
    </div>
  );
}

function Chip({ tab, selected, onSelect }: { tab: BrowserTab; selected: boolean; onSelect(): void }) {
  const title = tabTitle(tab) || BROWSER_COPY.newTab;
  const tone = selected ? 'bg-bg text-fg' : tab.suspended ? 'text-fg-muted hover:bg-bg-hover' : 'text-fg-muted hover:bg-bg-hover hover:text-fg';
  const revealed = selected ? '' : 'invisible group-hover:visible group-focus-within:visible';
  return (
    <div data-browser-chip={tab.tabId} data-suspended={tab.suspended || undefined} className={`group flex h-6 w-44 min-w-16 shrink items-center rounded-sm ${tone}`}>
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        title={tab.url === '' ? title : `${title}\n${tab.url}`}
        onClick={onSelect}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm pr-0.5 pl-2 text-ui-sm outline-accent focus-visible:outline-2"
      >
        {tab.favicon ? (
          <img alt="" src={tab.favicon} className={`size-3.5 shrink-0 ${tab.suspended ? 'opacity-50' : ''}`} />
        ) : (
          <BrowserIcon className={`size-3.5 ${tab.suspended ? 'text-fg-faint' : ''}`} />
        )}
        {tab.control === 'agent' && <ActingDot /> /* E4c */}
        <span className={`min-w-0 truncate ${tab.loading ? 'browser-chip-loading' : ''}`}>{title}</span>
        {tab.agentBadge !== null && <AgentBadge text={tab.agentBadge} /> /* E13 */}
      </button>
      <button
        type="button"
        aria-label={BROWSER_COPY.closeTabNamed(title)}
        title={BROWSER_COPY.closeTabNamed(title)}
        onClick={() => closeTab(tab.tabId)}
        className={`mr-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:visible focus-visible:outline-2 ${revealed}`}
      >
        <CloseIcon className="size-3" />
      </button>
    </div>
  );
}

// E4c start: the acting tab (E4c execution document, Design §9): the chip of the tab the agent holds (`control: 'agent'`)
// carries a small accent dot before its title, so the person sees which of the session's tabs the agent is using.
function ActingDot() {
  return <span data-browser-acting role="img" aria-label={BROWSER_COPY.acting} title={BROWSER_COPY.acting} className="size-1.5 shrink-0 rounded-full bg-accent" />;
}
// E4c end

// E13 start: a tab an agent created through cua (the in-app browser spec of 2026-10-08): a small badge after the title
// with the text main gives it ("agent", or the name the agent gave its session), in the agent tint mentions use.
function AgentBadge({ text }: { text: string }) {
  return (
    <span data-agent-badge="" title={BROWSER_COPY.agentBadge} className="max-w-20 shrink-0 truncate rounded-sm bg-accent-soft px-1 text-fg">
      {text}
    </span>
  );
}
// E13 end
