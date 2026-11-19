// A web call's detail (WebFetch, WebSearch): the URL, which opens outside through C5, or the query, then the output as
// text, bounded (never rendered as markup: it is fetched content). UX wave U6b-4b (R3): the address opens as a Markdown
// link does, with the row's session and ⌘, so a loopback address follows the session's machine.
import type { CellDetail } from '../../model/rows';
import { useActions, useRowSession } from '../context';
import { Output } from './Truncated';

type Web = Extract<CellDetail, { kind: 'web' }>;

export function WebDetail({ detail }: { detail: Web }) {
  const actions = useActions();
  const session = useRowSession();
  const url = detail.url;
  return (
    <div className="transcript-web">
      {url ? (
        <button
          type="button"
          className="transcript-link"
          title={url}
          onClick={(event) => {
            if (event.metaKey) actions.openExternal(url, session, { external: true });
            else actions.openExternal(url, session);
          }}
        >
          {url}
        </button>
      ) : (
        detail.query && <div className="transcript-detail-note">{detail.query}</div>
      )}
      {detail.output && <Output text={detail.output} />}
    </div>
  );
}
