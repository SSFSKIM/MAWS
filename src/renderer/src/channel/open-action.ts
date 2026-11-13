// The project Channel reached from outside the sidebar (UX wave U11a M5; S-10; Interfaces §F, "The Channel's entries" and
// "The action"): the ⌘K palette's "<project> · channel" entries with what waits in each, and View › Project channel.
// The action's handler is registered exactly while the tab in front names a project that has a channel: a Channel tab's
// own project, or a session tab's row as `sessionRow` reads it (U13a), the row the title bar's chip names: its project's,
// a listed session's (either lane) where its listing's row is, an unstarted chat's by its intent, and none until the
// session's machine has answered in this run. A machine's own row has no channel. Unregistered, the menu item is greyed
// and the palette's row says why. Both open the tab, or bring it forward, through the layout's `openTab`.
import type { Strip } from '@shared/ipc/schema/layout';
import { ipc } from '../ipc/client';
import { registerAction, sessionRow, subscribeSessionRows } from '../keymap/actions-runtime';
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { selectOrgIndex } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { channelOfRow, channelProjects, waitingFor } from './project';

/** The channel of the tab in front: a Channel tab's project, or a session tab's row's channel; null for any other. */
export function frontChannel(strip: Strip): string | null {
  const tab = activeTab(strip);
  if (tab?.kind === 'channel') return tab.project;
  if (tab?.kind !== 'session') return null;
  const row = sessionRow(tab.appSessionId);
  return row === null || row === undefined ? null : channelOfRow(row, selectOrgIndex(useSessions.getState(), ipc.localMachine));
}

/** Opens the project's Channel tab, or brings it forward. */
export const openProjectChannel = (project: string) => useLayout.getState().openTab({ kind: 'channel', project });

/** Keeps `channel.open` registered while the tab in front has a channel; returns its removal. */
export function connectChannelAction(): () => void {
  const front = () => frontChannel(useLayout.getState().main);
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
  const unsubscribe = [useLayout.subscribe(sync), subscribeSessionRows(sync)]; // the tab in front, and what `sessionRow` reads
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
