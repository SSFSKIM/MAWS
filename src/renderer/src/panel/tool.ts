// X5, the right panel's tool contract. Owner: C8 (C8a lands the product host). Written by C9 from C8's "X5, final"
// (`docs/doperpowers/plans/2026-09-28-c8-right-panel.md`) so that C8a adopts this file instead of C9 adapting later;
// until C8a lands, the `#panel` harness (`harness/terminal/PanelHarness.tsx`) is the host that honours it.
// Host rules every tool relies on: `createState` runs once per tab and its result is kept across visibility changes,
// panel collapse and session switches under a pin; unselected tools are unmounted; `beforeClose` can veto a close.
import type { ComponentType } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { panelHost } from './host';

export interface PanelToolInit<P = void> {
  appSessionId: AppSessionId | null; // null when opened with no session shown (pinned tools only)
  session: SessionRecord | null; // the X1 record: directory, additionalDirectories, worktree, holder
  instanceId: string; // the tab id; the Terminal tool uses it as the terminal's label
  params: P; // tool-specific open parameters
}

export interface PanelToolContext {
  appSessionId: AppSessionId | null; // the session the panel shows; changes under a pinned tab
  session: SessionRecord | null;
  status: EngineSessionStatus | null; // C3's status when the session is live in this app; null for a disk-only session
  pinned: boolean;
  visible: boolean; // selected and the panel is not collapsed
  focusRequest: number; // increments when the host wants the tool to take focus (tab selection, panel opened)
  setTitle(suffix: string | null): void; // "Terminal · claude"
  close(): void; // runs beforeClose, then dispose
  openTool: typeof panelHost.addTool; // a tool opening another
}

export interface PanelTool<S, P = void> {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  pinnable: boolean;
  multiInstance: boolean;
  menu?: boolean; // offered from "+"; default true
  createState(init: PanelToolInit<P>): S; // once per tab
  open?(state: S, params: P): void; // addTool on an existing single-instance tab re-targets it
  beforeClose(state: S): Promise<boolean>; // false vetoes; the tool shows its own confirmation and calls ctx.close() later
  dispose(state: S): void;
  render: ComponentType<{ state: S; ctx: PanelToolContext }>;
  summary?: ComponentType<{ appSessionId: AppSessionId; open(params?: P): void }>; // a section of the resting summary
}
