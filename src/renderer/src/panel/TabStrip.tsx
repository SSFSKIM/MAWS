// The panel's strip (C8a execution document, M1): the home glyph, the tabs in `PanelHostProps.tabs` order (pins first),
// and "+". One row that scrolls and never wraps; each tab is `icon · title · suffix`, truncated at a 72 px minimum,
// with its pin and close glyphs revealed on hover, focus and selection (Codex §3). The shown session's own
// interactions write through `onChange`; closing goes through the host so `beforeClose` runs.
import { DropdownMenu } from 'radix-ui';
import type { KeyboardEvent, ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { Icon, IconButton } from '../app/IconButton';
import { COPY } from './copy';
import { openPaneTab, usePanes } from '../engine-surface/panes'; // R2
import { PANE_COPY } from '../engine-surface/PaneTool'; // R2
import { panelHost, requestFocus, togglePinned, usePanelHost, useTabLabel, type PanelHostState } from './host';
import type { PanelHostProps } from './host-slot';

interface TabStripProps {
  appSessionId: AppSessionId | null;
  tabs: PanelTabRef[];
  activeTabId: string | null;
  onChange: PanelHostProps['onChange'];
  bodyId: string;
}

export function TabStrip({ appSessionId, tabs, activeTabId, onChange, bodyId }: TabStripProps) {
  const select = (id: string) => {
    if (id !== activeTabId) onChange({ tabs, activeTabId: id });
    requestFocus(id);
  };
  // Arrow keys move focus along the tabs (the WAI-ARIA tabs pattern, manual activation).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    event.preventDefault();
    buttons[(at + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-1">
      <IconButton label={COPY.home} pressed={activeTabId === null} onClick={() => activeTabId !== null && onChange({ tabs, activeTabId: null })}>
        <HomeIcon />
      </IconButton>
      <div role="tablist" aria-label="Panel tools" onKeyDown={onKeyDown} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} selected={tab.id === activeTabId} canPin={appSessionId !== null} bodyId={bodyId} onSelect={() => select(tab.id)} />
        ))}
      </div>
      <AddMenu appSessionId={appSessionId} tabs={tabs} />
    </div>
  );
}

function Tab({ tab, selected, canPin, bodyId, onSelect }: { tab: PanelTabRef; selected: boolean; canPin: boolean; bodyId: string; onSelect(): void }) {
  const { tool, title, suffix } = useTabLabel(tab); // the header reads the same label (P3-G)
  const closing = usePanelHost((s) => s.closing.has(tab.id));
  const pinnable = tool ? tool.pinnable : true;
  const ToolIcon = tool?.icon;
  const revealed = selected ? '' : 'hidden group-hover:inline-flex group-focus-within:inline-flex'; // unrevealed glyphs take no width

  return (
    <div data-tab-id={tab.id} className={`group flex h-7 max-w-48 min-w-18 shrink-0 items-center rounded-sm ${selected ? 'bg-bg-active text-fg' : 'text-fg-muted hover:bg-bg-hover hover:text-fg'}`}>
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        aria-controls={selected ? bodyId : undefined}
        tabIndex={selected ? 0 : -1}
        onClick={onSelect}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm pr-1 pl-2 text-ui outline-accent focus-visible:outline-2"
      >
        {ToolIcon && <ToolIcon className="size-3.5 shrink-0" />}
        <span className="truncate">
          {title}
          {suffix && <span className="text-fg-faint"> · {suffix}</span>}
        </span>
      </button>
      {pinnable && (
        <GlyphButton
          label={tab.pinned ? COPY.unpin(title) : COPY.pin(title)}
          pressed={tab.pinned}
          disabled={!canPin}
          className={tab.pinned ? 'text-fg' : revealed}
          onClick={() => togglePinned(tab.id)}
        >
          <PinIcon />
        </GlyphButton>
      )}
      <GlyphButton label={COPY.close(title)} disabled={closing} className={revealed} onClick={() => void panelHost.closeTab(tab.id)}>
        <CloseIcon />
      </GlyphButton>
    </div>
  );
}

function GlyphButton(props: { label: string; pressed?: boolean; disabled?: boolean; className: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.pressed}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:pointer-events-none disabled:text-fg-faint ${props.className}`}
    >
      {props.children}
    </button>
  );
}

// The §5.6 order "+" lists tools in; any other registered tool follows in registration order.
const MENU_ORDER: readonly string[] = ['subagents', 'review', 'terminal', 'files', 'background', 'session-info'];

// "+": every registered tool offered from the menu, in the §5.6 order then registration order, less a single-instance
// tool that already has a tab here. With no session shown there is nothing for a tool to read, so it is disabled. R2:
// then the shown session's plugin panes under "Plugin panes", each selecting its pane's tab (added when it has none).
export function menuTools(tools: PanelHostState['tools'], tabs: PanelTabRef[]) {
  const rank = (id: string) => (MENU_ORDER.includes(id) ? MENU_ORDER.indexOf(id) : MENU_ORDER.length);
  return [...tools.values()]
    .filter((t) => t.menu !== false && (t.multiInstance || !tabs.some((r) => r.toolId === t.id)))
    .sort((a, b) => rank(a.id) - rank(b.id));
}

function AddMenu({ appSessionId, tabs }: { appSessionId: AppSessionId | null; tabs: PanelTabRef[] }) {
  const tools = usePanelHost((s) => s.tools);
  const panes = usePanes(appSessionId); // R2: the session's plugin panes, listed under their own heading
  if (appSessionId === null) {
    return (
      <IconButton label={COPY.addNoSession} disabled>
        <PlusIcon />
      </IconButton>
    );
  }
  const offered = menuTools(tools, tabs);
  const anyOffered = [...tools.values()].some((t) => t.menu !== false);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={COPY.add}>
          <PlusIcon />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-44 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
          {offered.length === 0 && (
            <DropdownMenu.Item disabled className="flex h-7 cursor-default items-center rounded-sm px-2 text-fg-faint outline-none select-none">
              {anyOffered ? COPY.allOpen : COPY.noTools}
            </DropdownMenu.Item>
          )}
          {offered.map((tool) => {
            const ToolIcon = tool.icon;
            return (
              <DropdownMenu.Item
                key={tool.id}
                onSelect={() => panelHost.addTool(tool.id, { appSessionId })}
                className="flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover"
              >
                <ToolIcon className="size-3.5 shrink-0 text-fg-muted" />
                {tool.title}
              </DropdownMenu.Item>
            );
          })}
          {panes.length > 0 && (
            <DropdownMenu.Group aria-label={PANE_COPY.menu}>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Label className="px-2 py-1 text-ui-sm text-fg-faint select-none">{PANE_COPY.menu}</DropdownMenu.Label>
              {panes.map((pane) => (
                <DropdownMenu.Item
                  key={pane.id}
                  onSelect={() => openPaneTab(appSessionId, pane.id)}
                  className="flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover"
                >
                  <span className="min-w-0 truncate">{pane.title || pane.id}</span>
                  <span className="ml-auto shrink-0 text-ui-sm text-fg-faint">{pane.plugin}</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// The strip's glyphs, drawn like the shell's 16 px stroke icons.
const HomeIcon = () => (
  <Icon>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M5 6h6M5 8.5h6M5 11h3.5" />
  </Icon>
);
const PinIcon = () => (
  <Icon className="size-3">
    <path d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5" />
  </Icon>
);
const CloseIcon = () => (
  <Icon className="size-3">
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);
const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
