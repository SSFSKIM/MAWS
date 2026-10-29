// The sessions the owner keeps open in a main tab, as the renderer last wrote `main.tabs` (every project's set): a
// session's own tab or one of its agents' (the tabs an archive closes). A value the renderer would not read either
// opens none, as the renderer then shows its default tabs. P5 O3-C (D11): the app's interest (src/main/sessions/
// interest.ts) is this set with the sessions on screen, which main's report sends and the inactive sweep keeps.
// P5 O6 M2 (OX2): the renderer's tabs hold addresses; the set is this machine's, so it keeps the local machine's
// sessions, by their bare ids, and reads a layout from before O6 as the renderer does (lifted with the local machine).
import type { AppSessionId } from '@shared/graph/ids';
import { storedMainSchema } from '@shared/ipc/schema/layout';
import { bareOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';

// The set, from a `main.tabs` value: the local machine's sessions, by their bare ids.
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
