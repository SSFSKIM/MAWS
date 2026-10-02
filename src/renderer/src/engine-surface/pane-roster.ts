// The pane roster per session as the engine holds it (R2; filled by panes.ts), and the client the panes' asks go
// through: the app's, or the one a test connected. A module of its own so the pane tool and the panel's "+" menu read it
// without importing the connection.
import { create } from 'zustand';
import type { PaneRoster } from '@shared/engine/surface';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';

interface PaneRosters {
  rosters: ReadonlyMap<AppSessionId, PaneRoster>;
}
export const usePaneRosters = create<PaneRosters>()(() => ({ rosters: new Map() }));

const NO_PANES: PaneRoster['panes'] = [];
export const usePaneRoster = (appSessionId: AppSessionId | null): PaneRoster | null => usePaneRosters((s) => (appSessionId === null ? null : (s.rosters.get(appSessionId) ?? null)));
export const usePanes = (appSessionId: AppSessionId | null): PaneRoster['panes'] => usePaneRosters((s) => (appSessionId === null ? NO_PANES : (s.rosters.get(appSessionId)?.panes ?? NO_PANES)));

let client: MawsBridge = ipc;
export const panesClient = (): MawsBridge => client;
export const setPanesClient = (next: MawsBridge): void => void (client = next);
