// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Which machine an artifact is on"): a main
// `artifact` tab carries its artifact's machine beside the id (P5 O6 M2), persisted with the layout, so a tab restored at
// launch, or moved in from the panel, tells the page's table where its artifact is before its body reads anything (an
// editor's first reads run in its own effects, before the tab's).
import { allTabs } from '../stores/layout-model';
import { useLayout } from '../stores/layout';
import { ipc } from '../ipc/client';
import { recordArtifactMachine } from './machines';

export function connectArtifactTabMachines(): () => void {
  let seen: unknown = null;
  const record = () => {
    const { main } = useLayout.getState();
    if (main === seen) return;
    seen = main;
    for (const tab of allTabs(main)) if (tab.kind === 'artifact') recordArtifactMachine(tab.artifactId, tab.machine, ipc.localMachine);
  };
  record();
  return useLayout.subscribe(record);
}
