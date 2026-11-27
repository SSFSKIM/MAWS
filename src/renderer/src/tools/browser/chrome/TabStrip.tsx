// E4a (Task 3.3): the chrome's first row (Design §4 "Tab strip"; Decision Log 17): one chip per tab of the session, in
// main's order, and "+". In the panel a chip selects its tab (the tool shows the session's selected tab); in a main tab,
// which shows its own tab, a chip opens that tab's own main tab, so one tab of a session is reachable from another.
// Chips shrink to a minimum and the strip then scrolls sideways; a suspended tab's chip is muted, a loading one's title
// shimmers. Closing a chip closes the browser tab (its ×'s tooltip the word Close, its name the tab's: the word cut,
// T426). P3-G (M2): `trailing` sits at the row's right end (the floating card's pill while the card is closed over this
// page in the panel). P5 O7 M3: a tab whose page is on a forward's local listener carries the machine's name after its
// title (the word cut, T429: "forwarded from" for a screen reader alone). P5 O17 M10: on another machine's session, the agent's tabs
// there follow the person's as their own group (`agent`, remote/View.tsx's AgentGroup); a chip of the person's or "+"
// tells the surface the person's own tabs are shown again (`onLocal`), and while an agent tab is shown no chip of the
// person's reads selected; their first chip is then the strip's tab stop, so each group keeps one.
import type { KeyboardEvent, ReactNode } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../../ipc/client';
import { useMachines } from '../../../stores/machines';
import { machineName } from '../../../stores/org-projects';
import { NamedGlyph } from '../../../ui/glyph';
import { Tip } from '../../../ui/tip';
import { closeTab, openMainTab, openTab, selectTab } from '../actions';
import { BROWSER_COPY } from '../copy';
import { forwardMarkOf } from '../forward';
import { BrowserIcon, CloseIcon, PlusIcon } from '../icons';
import { tabTitle } from '../store';
import './chrome.css';

export interface TabStripProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  tabs: BrowserTab[];
  shownId: string | null; // the tab the surface shows
  trailing?: ReactNode;
  agent?: ReactNode; // P5 O17 M10: the agent's tabs on the session's machine, after the person's
  onLocal?(): void; // P5 O17 M10: the person's own tabs are shown again
}

export function TabStrip({ appSessionId, surface, tabs, shownId, trailing, agent, onLocal }: TabStripProps) {
  const show = (tabId: string) => {
    onLocal?.();
    if (tabId === shownId) return;
    if (surface === 'panel') selectTab(appSessionId, tabId);
    else openMainTab(appSessionId, tabId);
  };
  // "+": an empty tab, selected in the session; a main tab moves to the new tab's own main tab.
  const add = () => {
    onLocal?.();
    void openTab(appSessionId, null).then((tab) => {
      if (tab && surface === 'main') openMainTab(appSessionId, tab.tabId);
    });
  };
  const stop = tabStop(tabs.map((tab) => tab.tabId), shownId);

  return (
    <div className="flex h-(--row-h) shrink-0 items-center gap-0.5 px-1">
      <div role="tablist" aria-label={BROWSER_COPY.tabs} onKeyDown={moveAlongTabs} className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => (
          <Chip key={tab.tabId} tab={tab} selected={tab.tabId === shownId} tabbable={tab.tabId === stop} onSelect={() => show(tab.tabId)} />
        ))}
      </div>
      <NamedGlyph label={BROWSER_COPY.newTabAction} onClick={add} className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
        <PlusIcon className="size-3.5" />
      </NamedGlyph>
      {agent /* P5 O17 M10 */}
      {trailing && <div className="ml-auto flex shrink-0 items-center pl-1">{trailing}</div>}
    </div>
  );
}

// Arrow keys move focus along a tablist's chips (the WAI-ARIA tabs pattern, manual activation), as the panel's strip does.
export function moveAlongTabs(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  const chips = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const at = chips.indexOf(document.activeElement as HTMLButtonElement);
  if (at === -1) return;
  event.preventDefault();
  chips[(at + (event.key === 'ArrowRight' ? 1 : chips.length - 1)) % chips.length]!.focus();
}

/** A tablist's one tab stop: its shown chip, else its first (P5 O17 M10: a group with nothing shown stays in reach). */
export const tabStop = (tabIds: string[], shownId: string | null): string | null => (shownId !== null && tabIds.includes(shownId) ? shownId : (tabIds[0] ?? null));

// A chip's tooltip, which keyboard focus opens too (board ticket 815): its title in full and its address, then what its
// marks say (the acting dot, the agent's badge, the forwarded mark), which sit inside the chip and take no focus of their
// own. The address and the marks' facts the chip's name does not already read are its description.
export function chipTip(title: string, url: string, marks: { fact: string; named: boolean }[]) {
  const lines = [title, url, ...marks.map((mark) => mark.fact)].filter((line) => line !== '');
  const description = [url, ...marks.filter((mark) => !mark.named).map((mark) => mark.fact)].filter((part) => part !== '').join(' · ');
  return {
    content: (
      <>
        {lines.map((line, index) => (
          <span key={index} className="block">
            {line}
          </span>
        ))}
      </>
    ),
    description,
  };
}

function Chip({ tab, selected, tabbable, onSelect }: { tab: BrowserTab; selected: boolean; tabbable: boolean; onSelect(): void }) {
  const title = tabTitle(tab) || BROWSER_COPY.newTab;
  const forward = forwardMarkOf(tab);
  const machine = useMachines((s) => (forward === null ? null : machineName(s.machines, forward.machine, ipc.localMachine)));
  const tip = chipTip(title, tab.internal === null ? tab.url : '' /* an internal tab's URL is never drawn (cua #90) */, [
    ...(tab.control === 'agent' ? [{ fact: BROWSER_COPY.acting, named: true }] : []), // the dot's name is the words
    ...(tab.agentBadge !== null ? [{ fact: BROWSER_COPY.agentBadge, named: false }] : []),
    ...(forward !== null && machine !== null ? [{ fact: BROWSER_COPY.forwarded.markTitle(machine, forward.port), named: false }] : []),
  ]);
  const tone = selected ? 'bg-bg text-fg' : tab.suspended ? 'text-fg-muted hover:bg-bg-hover' : 'text-fg-muted hover:bg-bg-hover hover:text-fg';
  const revealed = selected ? '' : 'invisible group-hover:visible group-focus-within:visible';
  return (
    <div data-browser-chip={tab.tabId} data-suspended={tab.suspended || undefined} className={`group flex h-6 w-44 min-w-16 shrink items-center rounded-sm ${tone}`}>
      <Tip content={tip.content} description={tip.description}>
        <button
          type="button"
          role="tab"
          aria-selected={selected}
          tabIndex={tabbable ? 0 : -1}
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
          {forward !== null && machine !== null && <ForwardMark machine={machine} /> /* P5 O7 M3 */}
        </button>
      </Tip>
      <NamedGlyph
        label={BROWSER_COPY.closeTabNamed(title)}
        tip={BROWSER_COPY.close}
        onClick={() => closeTab(tab.tabId)}
        className={`mr-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:visible focus-visible:outline-2 ${revealed}`}
      >
        <CloseIcon className="size-3" />
      </NamedGlyph>
    </div>
  );
}

// E4c start: the acting tab (E4c execution document, Design §9): the chip of the tab the agent holds (`control: 'agent'`)
// carries a small accent dot before its title, so the person sees which of the session's tabs the agent is using. Its
// words are its name and a line of the chip's tooltip (`chipTip`).
export function ActingDot() {
  return <span data-browser-acting role="img" aria-label={BROWSER_COPY.acting} className="size-1.5 shrink-0 rounded-full bg-accent" />;
}
// E4c end

// E13 start: a tab an agent created through cua (the in-app browser spec of 2026-10-08): a small badge after the title
// with the text main gives it ("agent", or the name the agent gave its session), in the agent tint mentions use. What
// it means is a line of the chip's tooltip and part of its description (`chipTip`).
function AgentBadge({ text }: { text: string }) {
  return (
    <span data-agent-badge="" className="max-w-20 shrink-0 truncate rounded-sm bg-accent-soft px-1 text-fg">
      {text}
    </span>
  );
}
// E13 end

// P5 O7 M3 start: the forwarded mark (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Forwarding"): the page is
// another machine's loopback, served through a port forwarded over its link, so the strip says whose it is. Its port
// and what it means are a line of the chip's tooltip and part of its description (`chipTip`).
function ForwardMark({ machine }: { machine: string }) {
  return (
    <span data-forward-mark="" className="max-w-24 shrink-0 truncate rounded-sm bg-bg-raised px-1 text-fg-muted">
      <span className="sr-only">{BROWSER_COPY.forwarded.markLead}</span>
      {BROWSER_COPY.forwarded.mark(machine)}
    </span>
  );
}
// P5 O7 M3 end
