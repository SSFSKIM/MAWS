// U11a M9 (l8-settings-06): Settings › Supervisor, out of Engine: the background supervisor's group (E10; its rows keep
// their group, named "Background supervisor", and the section's heading stands where its own heading was drawn), then the
// memory budget's switch and, while it is on, its two dependent rows (C12; W7: settings version 7).
import type { Settings } from '@shared/ipc/schema';
import { BudgetSwitch, MemoryBudget, StatefulServers } from './BudgetSettings';
import { SupervisorSettings } from './SupervisorSettings';

export function SupervisorSection({ settings }: { settings: Settings }) {
  return (
    <>
      <SupervisorSettings settings={settings} />
      <BudgetSwitch settings={settings} />
      {settings.engine.memoryBudget.enabled && (
        <>
          <MemoryBudget settings={settings} />
          <StatefulServers settings={settings} />
        </>
      )}
    </>
  );
}
