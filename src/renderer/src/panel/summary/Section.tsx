// One collapsible part of the summary (Codex §3: a sticky muted heading, the chevron a glyph) whose expansion is the
// summary store's, and the parts its rows share: a row with its action on the right, and the action that opens a tool
// (disabled, naming the child that brings it, while the tool is not registered; enabled the moment it registers).
import type { ComponentType, ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SummarySection } from '@shared/ipc/schema/layout';
import { ChevronDownIcon } from '../../app/IconButton';
import { useSummary } from '../../stores/summary';
import { arrivesWith, SUMMARY_COPY } from '../copy';
import { panelHost, usePanelHost } from '../host';

export function Section({ id, children }: { id: SummarySection; children: ReactNode }) {
  const collapsed = useSummary((s) => s.collapsed.has(id));
  const title = SUMMARY_COPY.sections[id];
  const contentId = `panel-summary-${id}`;
  return (
    <section aria-label={title} className="border-b border-border">
      <h3 className="sticky top-0 z-10 bg-bg">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : contentId}
          onClick={() => useSummary.getState().toggle(id)}
          className="flex h-8 w-full items-center justify-between rounded-sm text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2"
        >
          {title}
          <ChevronDownIcon className={`size-3.5 ${collapsed ? '-rotate-90' : ''}`} />
        </button>
      </h3>
      {!collapsed && (
        <div id={contentId} className="flex flex-col gap-1.5 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

export function Row({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-7 min-w-0 items-center justify-between gap-2 text-ui text-fg">
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export const actionClass =
  'shrink-0 rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:border-transparent disabled:text-fg-faint disabled:hover:bg-transparent';

// Opens `toolId` in the session through the host (`addTool`, no params: the tool picks its own default).
export function ToolButton({ toolId, label, appSessionId }: { toolId: string; label: string; appSessionId: AppSessionId }) {
  const registered = usePanelHost((s) => s.tools.has(toolId));
  if (!registered) {
    return (
      <button type="button" disabled className={actionClass}>
        {arrivesWith(toolId)}
      </button>
    );
  }
  return (
    <button type="button" className={actionClass} onClick={() => panelHost.addTool(toolId, { appSessionId })}>
      {label}
    </button>
  );
}

// A registered tool's own summary component (X5 `summary`), which fills the section in place of the host's baseline.
export function useToolSummary(toolId: string): ComponentType<{ appSessionId: AppSessionId; open(params?: unknown): void }> | undefined {
  return usePanelHost((s) => s.tools.get(toolId)?.summary);
}

export function ToolSummary({ toolId, appSessionId, component: Component }: { toolId: string; appSessionId: AppSessionId; component: ComponentType<{ appSessionId: AppSessionId; open(params?: unknown): void }> }) {
  return <Component appSessionId={appSessionId} open={(params) => panelHost.addTool(toolId, { appSessionId, params })} />;
}
