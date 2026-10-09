// E4c (M3, Design §10): a browser tool call's row, kept to render journals written before the browser tools left the
// `maws` server (P1 A-54). One compact line: the browser glyph, what the agent did to which page or element ("Clicked
// button "Submit""), the time it took and any wait the person or a sheet caused; quiet actions on the right: Show
// snapshot or Show value when the result carries text to read, a screenshot's Open (the Deliverables viewer), and Open
// tab (the Browser tool on the row's tab). Under the line, a refusal's reason, or a cancelled call's note. It stays in
// view when its turn folds (isPersistentRow). The live waiting line main reported while a call ran left with the tools.
import { BROWSER_ACTION, browserActionError, browserActionHeading, took } from '../../model/copy';
import type { Row } from '../../model/rows';
import { Output } from '../cells/Truncated';
import { useActions, useDisclosure, useRowSession, useTranscriptContext } from '../context';
import { BrowserIcon } from './icons';
import { useWorkingMs } from './parts';

type BrowserActionRowData = Extract<Row, { kind: 'browser_action' }>;

export function BrowserActionRow({ row }: { row: BrowserActionRowData }) {
  const actions = useActions();
  const appSessionId = useRowSession();
  const [open, toggle] = useDisclosure(`browser-detail:${row.id}`);
  const running = row.state === 'running';
  const shot = row.state === 'done' && row.deliverableId !== null ? row.deliverableId : null;
  const tab = row.tabId !== null && row.state !== 'error' && !(row.tool === 'browser_tabs' && row.action === 'close') ? row.tabId : null;
  const detail = row.state === 'done' ? row.detail : null;
  return (
    <section className="transcript-browser-action" data-tool={row.tool} data-state={row.state}>
      <div className="transcript-browser-action-line">
        <BrowserIcon />
        <span className="transcript-browser-action-heading" data-browser-heading="">
          {browserActionHeading(row)}
        </span>
        {row.state === 'done' && row.ms !== null && (
          <span className="text-fg-muted" data-browser-took="">
            {took(row.ms)}
            {row.waitedFor !== null && row.waitedMs !== null && ` · ${BROWSER_ACTION.waited(row.waitedFor, row.waitedMs)}`}
          </span>
        )}
        {running && <RunningTime startedAt={row.at} />}
        {appSessionId !== null && (detail !== null || shot !== null || tab !== null) && (
          <span className="transcript-browser-action-actions">
            {detail !== null && (
              <button type="button" className="transcript-quiet-button" aria-expanded={open} onClick={toggle}>
                {open ? BROWSER_ACTION.hide(row.tool) : BROWSER_ACTION.show(row.tool)}
              </button>
            )}
            {shot !== null && (
              <button type="button" className="transcript-quiet-button" onClick={() => actions.openDeliverable(appSessionId, shot)}>
                {BROWSER_ACTION.open}
              </button>
            )}
            {tab !== null && (
              <button type="button" className="transcript-quiet-button" onClick={() => actions.openBrowserTab(appSessionId, tab)}>
                {BROWSER_ACTION.openTab}
              </button>
            )}
          </span>
        )}
      </div>
      {row.state === 'error' && row.error !== null && (
        <p className="transcript-browser-action-note text-danger" data-browser-error="">
          {browserActionError(row.error)}
        </p>
      )}
      {row.state === 'cancelled' && (
        <p className="transcript-browser-action-note text-fg-muted" data-browser-note="">
          {BROWSER_ACTION.cancelled}
        </p>
      )}
      {detail !== null && open && <Output text={detail} />}
    </section>
  );
}

// How long the call has run, once that is a second or more (a quick action would flash "0s").
function RunningTime({ startedAt }: { startedAt: string }) {
  const { storeKey } = useTranscriptContext();
  const ms = useWorkingMs(storeKey, startedAt);
  return ms < 1000 ? null : <span className="text-fg-muted">{took(ms)}</span>;
}
