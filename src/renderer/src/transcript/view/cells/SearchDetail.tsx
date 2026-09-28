// A search's detail (Grep, Glob): the match count when known and the output, bounded.
import { plural } from '../../model/copy';
import type { CellDetail } from '../../model/rows';
import { Output } from './Truncated';

type Search = Extract<CellDetail, { kind: 'search' }>;

export function SearchDetail({ detail }: { detail: Search }) {
  return (
    <div className="transcript-search">
      {detail.matches !== null && <div className="transcript-detail-note">{plural(detail.matches, 'match', 'matches')}</div>}
      {detail.output && <Output text={detail.output} />}
    </div>
  );
}
