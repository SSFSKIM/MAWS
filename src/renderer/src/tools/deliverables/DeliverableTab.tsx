// E2 (M4): the `deliverableTab` slot (Design §5; X14): a record's viewer as a main tab, with no Back and no Open in tab.
// The tab restores to its record by id; a record that is gone shows the Deliverables list of the tab's session headed by
// the notice (the ledger's restore rule), and a row there opens that record's own tab (one tab per record). The shown
// version and the list's scope are the tab's while it is mounted; the tab's ref names the record alone.
import { useCallback, useState } from 'react';
import type { TabRef } from '@shared/ipc/schema/layout';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { useLayout } from '../../stores/layout';
import { DELIVERABLES_COPY } from './copy';
import { DeliverablesList, type DeliverablesScope } from './List';
import { DeliverableViewer } from './Viewer';

type DeliverableTabRef = Extract<TabRef, { kind: 'deliverable' }>;

const openRecordTab = (record: DeliverableRecord) => useLayout.getState().openTab({ kind: 'deliverable', appSessionId: record.appSessionId, deliverableId: record.id });

export function DeliverableTab({ tab }: { tab: DeliverableTabRef }) {
  const [version, setVersion] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  const [scope, setScope] = useState<DeliverablesScope>('session');
  const [scrollTop, setScrollTop] = useState(0);
  const onGone = useCallback(() => setGone(true), []);
  // P2-E1: the tab is on screen while its pane shows it (the pane mounts the active tab only), unless a maximized panel
  // covers the main region, which stays mounted and inert (the Shell's rule): then its comment card is offscreen too
  const onScreen = useLayout((s) => !(s.regions.panel.maximized && !s.regions.panel.collapsed));
  if (gone) {
    return (
      <div data-deliverable-tab="" className="h-full bg-bg">
        <DeliverablesList
          appSessionId={tab.appSessionId}
          scope={scope}
          scrollTop={scrollTop}
          notice={DELIVERABLES_COPY.notRecorded(tab.deliverableId)}
          onScope={setScope}
          onScroll={setScrollTop}
          onOpen={openRecordTab}
        />
      </div>
    );
  }
  return (
    <div data-deliverable-tab="" className="h-full">
      <DeliverableViewer appSessionId={tab.appSessionId} id={tab.deliverableId} version={version} mode="tab" visible={onScreen} onVersion={setVersion} onGone={onGone} />
    </div>
  );
}
