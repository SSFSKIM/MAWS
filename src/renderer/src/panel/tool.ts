// X5, canonical (C8 spec *X5, final*; C8a execution document, Interfaces): what a right-panel tool declares and what
// the host hands it. Owned by C8a; C8b, C8c, C9 and C11 register tools against these names through `registerPanelTool`
// (`host.ts`). A tool's live state is its `S`, created once per tab and kept by the host outside React; everything a
// tool shows is re-derived from its context or an external owner, since a tab persists only as `PanelTabRef`.
import type { ComponentType } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { panelHost } from './host';

export interface PanelToolInit<P = void> {
  appSessionId: AppSessionId | null; // the target session; null only for a pinned tool opened with no session shown
  session: SessionRecord | null; // C5's X1 record for it: directory, additionalDirectories, worktree, holder
  instanceId: string; // the PanelTabRef.id; C9 uses it as the terminal label
  params: P; // the addTool call's params, `undefined` when it gave none; `undefined` too for a tab restored from layout.json (every P is void or all-optional)
  restored?: true; // E10: set only for a tab restored from layout.json (the host's restore path); a tab an addTool opened has none
}

export interface PanelToolContext {
  appSessionId: AppSessionId | null; // the shown session; changes under a pinned tab; null on Overview, Diagnostics, Settings
  session: SessionRecord | null;
  status: EngineSessionStatus | null; // C3's status when the shown session is live in this app
  pinned: boolean;
  visible: boolean; // this tab is selected and regions.panel.collapsed is false
  // Increments on selection and on the collapsed → open transition while selected. One counter per tab that only grows
  // and lives as long as the tab's state (across unmounts), so a tool can remember the last value it acted on.
  focusRequest: number;
  setTitle(suffix: string | null): void; // "Terminal · claude"
  close(): void; // panelHost.closeTab(instanceId): beforeClose, then dispose
  openTool: typeof panelHost.addTool; // a tool opening another
}

export interface PanelTool<S, P = void> {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  pinnable: boolean;
  multiInstance: boolean;
  menu?: boolean; // offered from "+"; default true; false for Log
  createState(init: PanelToolInit<P>): S;
  open?(state: S, params: P): void; // addTool on an existing single-instance tab re-targets it (a restored tab never shown gets its createState first)
  beforeClose(state: S): Promise<boolean>; // false vetoes; the tool shows its own inline confirmation and calls ctx.close() later, and its next beforeClose passes
  dispose(state: S): void; // releases everything the instance owns, a running process included: the host disposes without beforeClose when reconciliation finds the ref gone (a removed session; ruling O4, 2026-09-29)
  render: ComponentType<{ state: S; ctx: PanelToolContext }>;
  summary?: ComponentType<{ appSessionId: AppSessionId; open(params?: P): void }>;
}
