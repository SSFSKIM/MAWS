// E2 (M4): the summary's Deliverables section as the tool fills it (X5 `summary`, under the panel's section heading;
// Design §4 "The summary"): `N delivered · <latest title>`, or that nothing was delivered yet, and Open, which opens the
// tool on its list. The counts are the session's list in the store, read on mount: the tool may not be open. A refused
// read says so (the list's words), never that nothing was delivered.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { actionClass, Row } from '../../panel/summary/Section';
import { DELIVERABLES_COPY } from './copy';
import type { DeliverablesParams } from './DeliverablesTool';
import { titleOf } from './model';
import { ensureSession, useDeliverables } from './store';

export function DeliverablesSummary({ appSessionId, open }: { appSessionId: AppSessionId; open(params?: DeliverablesParams): void }) {
  useEffect(() => ensureSession(appSessionId), [appSessionId]);
  const list = useDeliverables((s) => s.sessions.get(appSessionId));
  const latest = list?.records[0]; // the store keeps a session's list newest first
  const line =
    list && latest
      ? DELIVERABLES_COPY.summary(list.records.length, titleOf(latest))
      : list?.status === 'error'
        ? DELIVERABLES_COPY.couldNotList
        : list?.status === 'ready'
          ? DELIVERABLES_COPY.nothingYet
          : DELIVERABLES_COPY.loading;
  const action = (
    <button type="button" className={actionClass} onClick={() => open()}>
      {DELIVERABLES_COPY.open}
    </button>
  );
  return (
    <div data-summary="deliverables" className="flex flex-col gap-1.5">
      <Row action={action}>
        <span className="block truncate">{line}</span>
      </Row>
    </div>
  );
}
