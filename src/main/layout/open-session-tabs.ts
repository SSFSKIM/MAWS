// The sessions the owner keeps open in a main tab, as the renderer last wrote `main.tabs` (every project's set): a
// session's own tab or one of its agents' (the tabs an archive closes). A value the renderer would not read either
// opens none, as the renderer then shows its default tabs. The parse is kept for the value it was made from, so a sweep
// asking about every session reads the layout once per write. The renderer writes a tab's opening at once (only its
// closing waits for the write delay) but nothing before its layout hydrates, so a session on screen (`onScreen`, the
// visibility the renderer reports at once) counts as open too: a tab opened in that window is the one on screen.
// P5 O6 M2 (OX2): the renderer's tabs hold addresses; the sweep is this machine's, so it keeps the local machine's sessions,
// by their bare ids, and reads a layout from before O6 as the renderer does (lifted with the local machine).
import type { AppSessionId } from '@shared/graph/ids';
import { storedMainSchema } from '@shared/ipc/schema/layout';
import { bareOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { LayoutStore } from './store';

export function openSessionTabs(layout: Pick<LayoutStore, 'get'>, local: MachineRef, onScreen: (appSessionId: AppSessionId) => boolean = () => false): (appSessionId: AppSessionId) => boolean {
  let read: unknown = undefined;
  let open = new Set<AppSessionId>();
  return (appSessionId) => {
    const value = layout.get('main.tabs');
    if (value !== read) {
      read = value;
      open = sessionsInTabs(value, local);
    }
    return open.has(appSessionId) || onScreen(appSessionId);
  };
}

// The set itself, from a `main.tabs` value: the local machine's sessions, by their bare ids (P5 O2 M2: main's interest
// report, src/main/sessions/interest.ts).
export function sessionsInTabs(value: unknown, local: MachineRef): Set<AppSessionId> {
  const parsed = storedMainSchema(local).safeParse(value);
  if (!parsed.success) return new Set();
  const main = parsed.data;
  const sets = main.version === 3 ? Object.values(main.sets) : [main];
  const open = new Set<AppSessionId>();
  for (const set of sets) {
    for (const pane of set?.panes ?? []) {
      for (const tab of pane.tabs) {
        if ((tab.kind === 'session' || tab.kind === 'agent') && isAddress(tab.appSessionId) && machineOf(tab.appSessionId) === local) open.add(bareOf(tab.appSessionId));
      }
    }
  }
  return open;
}
