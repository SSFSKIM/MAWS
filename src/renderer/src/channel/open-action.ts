// The project Channel reached from outside the sidebar (UX wave U11a M5; S-10; Interfaces §F, "The Channel's entries" and
// "The action"): the ⌘K palette's "<project> · channel" entries with what waits in each, and View › Project channel.
// The action's handler is registered exactly while the tab in front names a project that has a channel: a Channel tab's
// own project, or a session tab's row (a New chat's by its intent), as `ipc/events.ts` files the session's tabs
// (`sessionSetKey`); a session this Mac knows only by another machine's listing (a lane A one has no record) by that
// listing's row, as the sidebar files it, or its project's key when every checkout of that project here is hidden. Unregistered, the menu item is greyed and the palette's row says why. Both open the tab, or bring it
// forward, through the layout's `openTab`.
import type { AppSessionId } from '@shared/graph/ids';
import type { LayoutMain } from '@shared/ipc/schema/layout';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { currentTabRetention, registerAction, unstartedProjectOf } from '../keymap/actions-runtime';
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { rowOfListed, selectOrgIndex, sessionSetKey, type RowKey } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { channelOfRow, channelProjects, waitingFor } from './project';

type SessionsState = ReturnType<typeof useSessions.getState>;

/** The project a session's tabs are filed under is its intent's while it is unstarted, as the shell's `projectOf` reads it. */
const intentOf = (state: SessionsState, appSessionId: AppSessionId) => () => {
  const retention = currentTabRetention();
  const unstarted = retention ? retention.retains(appSessionId) : state.unstarted.has(appSessionId);
  return unstarted ? unstartedProjectOf(appSessionId) : undefined;
};

/** The channel of the tab in front: a Channel tab's project, or a session tab's row's channel; null for any other. */
export function frontChannel(main: LayoutMain, state: SessionsState, local: MachineRef): string | null {
  const tab = activeTab(main);
  if (tab?.kind === 'channel') return tab.project;
  if (tab?.kind !== 'session') return null;
  const index = selectOrgIndex(state, local);
  const listing = state.records.has(tab.appSessionId) ? undefined : state.listed.get(tab.appSessionId);
  const row: RowKey | null | undefined = listing === undefined ? sessionSetKey(state, local, tab.appSessionId, intentOf(state, tab.appSessionId)) : (rowOfListed(index, listing) ?? listing.orgKey);
  return row === null || row === undefined ? null : channelOfRow(row, index);
}

/** Opens the project's Channel tab, or brings it forward. */
export const openProjectChannel = (project: string) => useLayout.getState().openTab({ kind: 'channel', project });

/** Keeps `channel.open` registered while the tab in front has a channel; returns its removal. */
export function connectChannelAction(): () => void {
  const front = () => frontChannel(useLayout.getState().main, useSessions.getState(), ipc.localMachine);
  let unregister: (() => void) | null = null;
  const sync = () => {
    const has = front() !== null;
    if (has && unregister === null) {
      unregister = registerAction('channel.open', () => {
        const project = front();
        if (project !== null) openProjectChannel(project);
      });
    } else if (!has && unregister !== null) {
      unregister();
      unregister = null;
    }
  };
  sync();
  const unsubscribe = [useLayout.subscribe(sync), useSessions.subscribe(sync)];
  return () => {
    unsubscribe.forEach((off) => off());
    unregister?.();
    unregister = null;
  };
}

/** The palette's entries: every project that has a channel, with the length of its Channel's "Waiting on you" list. */
export function usePaletteChannels(): { project: string; name: string; waiting: number }[] {
  const index = useSessions((s) => selectOrgIndex(s, ipc.localMachine));
  const projects = useSessions((s) => s.projects);
  const records = useSessions((s) => s.records);
  const listed = useSessions((s) => s.listed);
  const bySession = useAttention((s) => s.bySession);
  const greyed = useAttention((s) => s.greyed);
  return channelProjects(index).map((entry) => ({ ...entry, waiting: waitingFor({ project: entry.project, index, projects, records, listed, bySession, greyed }).length }));
}
