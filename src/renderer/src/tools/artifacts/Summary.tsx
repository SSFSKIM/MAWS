// The summary's Artifacts section as the tool fills it (X5 `summary`, under the panel's section heading; P3-L M6b, the
// summary section E2's Deliverables filled until the cutover): "N artifacts · <latest title>" for the session's
// lineage (the list's This session), or that nothing was made yet, and Open, which opens the tool on its list. Read from
// main's library index on mount (the tool may not be open); a refused read says so, never that nothing was made.
import type { AppSessionId } from '@shared/graph/ids';
import { actionClass, Row } from '../../panel/summary/Section';
import { useLibraryList } from '../../library/store';
import type { ArtifactsParams } from './ArtifactsTool';
import { ARTIFACTS_TOOL_COPY } from './copy';

export function ArtifactsSummary({ appSessionId, open }: { appSessionId: AppSessionId; open(params?: ArtifactsParams): void }) {
  const read = useLibraryList({ appSessionId, lineage: true });
  const rows = read.value?.rows;
  const latest = rows?.[0]; // main's order: newest first
  const line =
    rows && latest
      ? ARTIFACTS_TOOL_COPY.summary(rows.length, latest.title)
      : read.status === 'error' && rows === undefined
        ? ARTIFACTS_TOOL_COPY.couldNotList(read.error ?? '')
        : rows
          ? ARTIFACTS_TOOL_COPY.nothingYet
          : ARTIFACTS_TOOL_COPY.reading;
  const action = (
    <button type="button" className={actionClass} onClick={() => open()}>
      {ARTIFACTS_TOOL_COPY.open}
    </button>
  );
  return (
    <div data-summary="artifacts" className="flex flex-col gap-1.5">
      <Row action={action}>
        <span className="block truncate">{line}</span>
      </Row>
    </div>
  );
}
