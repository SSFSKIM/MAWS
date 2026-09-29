// Trouble, one line each (§5.3): the engine's API retries (updated in place), a reconnect episode (updated in place,
// gone once reconnected), the session process exiting (with the approvals it lost), notices, and turn or task errors.
// The severity sets the mark and colour: transient (still trying), error, notice.
import type { Row } from '../../model/rows';

const MARK = { transient: '↻', error: '✕', notice: 'ⓘ' } as const;

export function ErrorRow({ row }: { row: Extract<Row, { kind: 'error' }> }) {
  return (
    <div className="transcript-error" data-severity={row.severity} data-scope={row.scope}>
      <span className="transcript-error-mark" aria-hidden="true" data-mark={MARK[row.severity]} />
      <span>{row.text}</span>
    </div>
  );
}
