// The sessions the owner keeps open in a main tab, as the renderer last wrote `main.tabs` (every project's set): a
// session's own tab or one of its agents' (the tabs an archive closes). A value the renderer would not read either
// opens none, as the renderer then shows its default tabs. The parse is kept for the value it was made from, so a sweep
// asking about every session reads the layout once per write.
import type { AppSessionId } from '@shared/graph/ids';
import { StoredMainSchema } from '@shared/ipc/schema/layout';
import type { LayoutStore } from './store';

export function openSessionTabs(layout: Pick<LayoutStore, 'get'>): (appSessionId: AppSessionId) => boolean {
  let read: unknown = undefined;
  let open = new Set<AppSessionId>();
  return (appSessionId) => {
    const value = layout.get('main.tabs');
    if (value !== read) {
      read = value;
      open = sessionsIn(value);
    }
    return open.has(appSessionId);
  };
}

function sessionsIn(value: unknown): Set<AppSessionId> {
  const parsed = StoredMainSchema.safeParse(value);
  if (!parsed.success) return new Set();
  const main = parsed.data;
  const sets = main.version === 2 ? Object.values(main.sets) : [main];
  const open = new Set<AppSessionId>();
  for (const set of sets) for (const pane of set?.panes ?? []) for (const tab of pane.tabs) if (tab.kind === 'session' || tab.kind === 'agent') open.add(tab.appSessionId);
  return open;
}
