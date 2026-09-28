// A web call's detail (WebFetch, WebSearch): the URL, which opens outside through C5, or the query, then the output as
// text, bounded (never rendered as markup: it is fetched content).
import type { CellDetail } from '../../model/rows';
import { useActions } from '../context';
import { Output } from './Truncated';

type Web = Extract<CellDetail, { kind: 'web' }>;

export function WebDetail({ detail }: { detail: Web }) {
  const actions = useActions();
  const url = detail.url;
  return (
    <div className="transcript-web">
      {url ? (
        <button type="button" className="transcript-link" title={url} onClick={() => actions.openExternal(url)}>
          {url}
        </button>
      ) : (
        detail.query && <div className="transcript-detail-note">{detail.query}</div>
      )}
      {detail.output && <Output text={detail.output} truncation={detail.truncated} />}
    </div>
  );
}
