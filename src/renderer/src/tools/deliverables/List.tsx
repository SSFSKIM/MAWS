// E2 (M4): the Deliverables list (Design §4 "The list"): a scope row (This session · All sessions), then the groups in a
// fixed order (Artifacts, Files, Screenshots), each present only when it has rows, newest first. A row: the kind's glyph,
// the title, a muted second line (an artifact's `v<n> · <when>`; a file's caption, else its directory), and in the All
// scope the session it belongs to. Shared by the panel tool and by a `deliverable` tab whose record is gone; the scope
// and the scroll are the caller's, so Back returns to where the list was.
import { useEffect, useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { displayTitle } from '../../sessions/title';
import { ago } from '../../statusline/format';
import { useSessions } from '../../stores/sessions';
import { DELIVERABLES_COPY } from './copy';
import { KindGlyph } from './icons';
import { changedAt, dirnameOf, groupsOf, homeAbbreviated, latestVersion, titleOf } from './model';
import { ensureSession, loadAll, loadSession, useDeliverables, type RecordList } from './store';

export type DeliverablesScope = 'session' | 'all';

const IDLE: RecordList = { records: [], status: 'idle', error: null };
const control = 'rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';
const segment = 'px-2 py-0.5 text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2 aria-pressed:bg-bg-active aria-pressed:text-fg';

interface Props {
  appSessionId: AppSessionId;
  scope: DeliverablesScope;
  scrollTop: number;
  notice: string | null;
  onScope(scope: DeliverablesScope): void;
  onScroll(scrollTop: number): void;
  onOpen(record: DeliverableRecord): void;
}

export function DeliverablesList({ appSessionId, scope, scrollTop, notice, onScope, onScroll, onOpen }: Props) {
  useEffect(() => ensureSession(appSessionId), [appSessionId]);
  useEffect(() => {
    if (scope === 'all') loadAll(); // each entry into the scope reads afresh: another session's writes reach no event here
  }, [scope]);
  const list = useDeliverables((s) => (scope === 'all' ? s.all : (s.sessions.get(appSessionId) ?? IDLE)));
  const scroller = useRef<HTMLDivElement>(null);
  const [restoreTo] = useState(scrollTop); // Back and a remount return to where the list was
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = restoreTo;
  }, [restoreTo]);

  const retry = () => (scope === 'all' ? loadAll() : loadSession(appSessionId));
  return (
    <div data-deliverables-list="" ref={scroller} onScroll={(e) => onScroll(e.currentTarget.scrollTop)} className="flex h-full min-h-0 flex-col overflow-auto">
      <div role="group" aria-label={DELIVERABLES_COPY.scopeLabel} className="m-3 mb-1 flex shrink-0 self-start overflow-hidden rounded-sm border border-border">
        {(['session', 'all'] as const).map((value) => (
          <button key={value} type="button" aria-pressed={scope === value} onClick={() => onScope(value)} className={segment}>
            {DELIVERABLES_COPY.scopes[value]}
          </button>
        ))}
      </div>
      {notice !== null && (
        <p role="status" data-notice="" className="mx-3 my-1 text-ui-sm text-warning">
          {notice}
        </p>
      )}
      <Groups list={list} scope={scope} retry={retry} onOpen={onOpen} />
    </div>
  );
}

function Groups({ list, scope, retry, onOpen }: { list: RecordList; scope: DeliverablesScope; retry(): void; onOpen(record: DeliverableRecord): void }) {
  if (list.status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 px-3 py-2 text-ui text-fg">
        <p>{scope === 'all' ? DELIVERABLES_COPY.couldNotListAll : DELIVERABLES_COPY.couldNotList}</p>
        <button type="button" onClick={retry} className={control}>
          {DELIVERABLES_COPY.retry}
        </button>
      </div>
    );
  }
  if (list.records.length === 0) {
    const reading = list.status === 'reading' || list.status === 'idle';
    return <p className="px-3 py-2 text-ui text-fg-muted">{reading ? DELIVERABLES_COPY.loading : DELIVERABLES_COPY.empty}</p>;
  }
  return (
    <>
      {groupsOf(list.records).map((group) => (
        <section key={group.kind} data-group={group.kind} className="flex flex-col pb-2">
          <h3 className="sticky top-0 z-10 bg-bg-raised px-3 py-1.5 text-ui-sm text-fg-muted">{DELIVERABLES_COPY.groups[group.kind]}</h3>
          {group.records.map((record) => (
            <ListRow key={`${record.appSessionId}/${record.id}`} record={record} withSession={scope === 'all'} onOpen={onOpen} />
          ))}
        </section>
      ))}
    </>
  );
}

function secondLine(record: DeliverableRecord, now: number): string {
  if (record.kind === 'artifact') return DELIVERABLES_COPY.artifactLine(latestVersion(record), ago(Math.max(0, now - Date.parse(changedAt(record)))));
  return record.caption ?? homeAbbreviated(dirnameOf(record.path));
}

function ListRow({ record, withSession, onOpen }: { record: DeliverableRecord; withSession: boolean; onOpen(record: DeliverableRecord): void }) {
  const session = useSessions((s) => (withSession ? displayTitle(s.records.get(record.appSessionId)) : null));
  const [now] = useState(() => Date.now()); // the relative time as of the row's first draw
  const title = titleOf(record);
  return (
    <button
      type="button"
      data-deliverable-row=""
      data-deliverable-id={record.id}
      data-kind={record.kind}
      onClick={() => onOpen(record)}
      title={record.path}
      className="flex w-full min-w-0 items-start gap-2.5 px-3 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <span className="mt-0.5 shrink-0 text-fg-muted">
        <KindGlyph record={record} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-part="title" className="truncate text-ui text-fg">
          {title}
        </span>
        <span data-part="line" className="truncate text-ui-sm text-fg-muted">
          {secondLine(record, now)}
        </span>
        {session !== null && (
          <span data-part="session" className="truncate text-ui-sm text-fg-faint">
            {session}
          </span>
        )}
      </span>
    </button>
  );
}
