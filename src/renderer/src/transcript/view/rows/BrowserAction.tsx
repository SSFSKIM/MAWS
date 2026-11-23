// E4c (M3, Design §10): a browser tool call's row, kept to render journals written before the browser tools left the
// `maws` server (P1 A-54). One compact line: the browser glyph, what the agent did to which page or element ("Clicked
// button "Submit""), the time it took and any wait the person or a sheet caused; quiet actions on the right: Show
// snapshot or Show value when the result carries text to read, a screenshot's Open (its File artifact, P3-L M6b), and Open
// tab (the Browser tool on the row's tab). Under the line, a refusal's reason, or a cancelled call's note. It stays in
// view when its turn folds (isPersistentRow). The live waiting line main reported while a call ran left with the tools.
// The word cut (T105, T106): the time a done call took, and its wait, are the line's tooltip, shown on pointing anywhere
// along it, and the phrase's description (the phrase takes the keyboard for them), and stand on the line where nothing
// points; the quiet actions show on pointing or focus within the line, while the snapshot is open, and always where
// nothing points.
import { useRef } from 'react';
import { Tip } from '../../../ui/tip';
import { TouchFact } from '../../../ui/touch-fact';
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
  const line = useRef<HTMLDivElement>(null);
  const time = row.state === 'done' && row.ms !== null ? [took(row.ms), ...(row.waitedFor !== null && row.waitedMs !== null ? [BROWSER_ACTION.waited(row.waitedFor, row.waitedMs)] : [])].join(' · ') : null;
  return (
    <section className="transcript-browser-action" data-tool={row.tool} data-state={row.state} data-open={open && detail !== null ? '' : undefined}>
      <div ref={line} className="transcript-browser-action-line">
        <BrowserIcon />
        <Tip content={time} description={time} pointedWithin={line}>
          <span className="transcript-browser-action-heading" data-browser-heading="" tabIndex={time === null ? undefined : 0}>
            {browserActionHeading(row)}
          </span>
        </Tip>
        {/* the touch rule (fix wave, scalpel-3#1): where nothing points no tip opens, so the time stands on the line */}
        <TouchFact>{time}</TouchFact>
        {running && <RunningTime startedAt={row.at} />}
        {appSessionId !== null && (detail !== null || shot !== null || tab !== null) && (
          <span className="transcript-browser-action-actions" data-on-hover="">
            {detail !== null && (
              <button type="button" className="transcript-quiet-button" aria-expanded={open} onClick={toggle}>
                {open ? BROWSER_ACTION.hide(row.tool) : BROWSER_ACTION.show(row.tool)}
              </button>
            )}
            {shot !== null && (
              <button type="button" className="transcript-quiet-button" onClick={() => actions.openArtifact(appSessionId, shot)}>
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
