// The Artifacts tool's list (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5; parent §4.1: "the session's own list
// with 'All artifacts' one click away"): a scope row (This session · All) with "Open library" beside it, then the
// artifacts grouped by kind in the kinds' order, each group present only when it has rows, newest first (main's
// order). This session is the session's lineage (the session and its side-thread ancestors, X9's scope); All is the
// whole library. A row: the kind's glyph, the title and "Edited <ago> by <who>". The scope and the scroll are the
// tool state's, so Back returns to where the list was.
import { useEffect, useRef, useState } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryFilter, LibraryRow } from '@shared/ipc/schema/library';
import { formatAgo } from '../../app/date-format';
import { useNow } from '../../app/use-now';
import { KIND_PLURAL_LABELS, LIBRARY_COPY } from '../../library/copy';
import { KindIcon } from '../../library/icons';
import { refreshLibrary, useLibraryList } from '../../library/store';
import { openArtifacts } from '../../main/artifacts';
import { ARTIFACTS_TOOL_COPY } from './copy';

export type ArtifactsScope = 'session' | 'all';

const control = 'rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';
const segment = 'px-2 py-0.5 text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2 aria-pressed:bg-bg-active aria-pressed:text-fg';

interface Props {
  appSessionId: AppSessionId | null;
  scope: ArtifactsScope;
  scrollTop: number;
  onScope(scope: ArtifactsScope): void;
  onScroll(scrollTop: number): void;
  onOpen(artifactId: string): void;
}

export function ArtifactsList({ appSessionId, scope, scrollTop, onScope, onScroll, onOpen }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [restoreTo] = useState(scrollTop); // Back and a remount return to where the list was
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = restoreTo;
  }, [restoreTo]);
  // Another scope is another list: it starts at its top (the tool state's offset is zeroed with it).
  const shownScope = useRef(scope);
  useEffect(() => {
    if (shownScope.current === scope) return;
    shownScope.current = scope;
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [scope]);
  const filter: LibraryFilter | null = scope === 'all' ? {} : appSessionId === null ? null : { appSessionId, lineage: true };
  return (
    <div data-artifacts-list="" ref={scroller} onScroll={(e) => onScroll(e.currentTarget.scrollTop)} className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="m-3 mb-1 flex shrink-0 items-center gap-2">
        <div role="group" aria-label={ARTIFACTS_TOOL_COPY.scopeLabel} className="flex overflow-hidden rounded-sm border border-border">
          {(['session', 'all'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={scope === value} onClick={() => onScope(value)} className={segment}>
              {ARTIFACTS_TOOL_COPY.scopes[value]}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={openArtifacts} className="shrink-0 rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
          {ARTIFACTS_TOOL_COPY.openLibrary}
        </button>
      </div>
      {filter === null ? <Quiet>{ARTIFACTS_TOOL_COPY.noSession}</Quiet> : <Groups filter={filter} scope={scope} onOpen={onOpen} />}
    </div>
  );
}

// A refused read, retryable: alone before the first answer, above the last good list after it (the store keeps it).
function Failure({ message }: { message: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 px-3 py-2 text-ui text-fg">
      <p className="m-0">{message}</p>
      <button type="button" onClick={() => refreshLibrary()} className={control}>
        {ARTIFACTS_TOOL_COPY.retry}
      </button>
    </div>
  );
}

function Groups({ filter, scope, onOpen }: { filter: LibraryFilter; scope: ArtifactsScope; onOpen(artifactId: string): void }) {
  const read = useLibraryList(filter);
  const error = read.status === 'error' ? (read.error ?? '') : null;
  if (read.value === undefined) {
    return error === null ? <Quiet>{ARTIFACTS_TOOL_COPY.reading}</Quiet> : <Failure message={ARTIFACTS_TOOL_COPY.couldNotList(error)} />;
  }
  const { rows } = read.value;
  return (
    <>
      {error !== null && <Failure message={ARTIFACTS_TOOL_COPY.couldNotRefresh(error)} />}
      {rows.length === 0 && <Quiet>{scope === 'all' ? ARTIFACTS_TOOL_COPY.emptyAll : ARTIFACTS_TOOL_COPY.emptySession}</Quiet>}
      {ARTIFACT_KINDS.map((kind) => {
        const ofKind = rows.filter((row) => row.kind === kind);
        if (ofKind.length === 0) return null;
        return (
          <section key={kind} data-artifacts-group={kind} className="flex flex-col pb-2">
            <h3 className="sticky top-0 z-10 m-0 bg-bg-raised px-3 py-1.5 text-ui-sm font-normal text-fg-muted">{KIND_PLURAL_LABELS[kind]}</h3>
            {ofKind.map((row) => (
              <ListRow key={row.id} row={row} onOpen={onOpen} />
            ))}
          </section>
        );
      })}
    </>
  );
}

function ListRow({ row, onOpen }: { row: LibraryRow; onOpen(artifactId: string): void }) {
  const now = useNow();
  const editor = row.lastEditor;
  const by = actorDisplay(editor, editor.kind === 'session' ? row.sessions.find((s) => s.appSessionId === editor.appSessionId)?.title : undefined).name;
  return (
    <button
      type="button"
      data-artifact-row=""
      data-artifact-id={row.id}
      data-kind={row.kind}
      onClick={() => onOpen(row.id)}
      className="flex w-full min-w-0 items-start gap-2.5 px-3 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <KindIcon kind={row.kind} className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-part="title" className="truncate text-ui text-fg">
          {row.title}
        </span>
        <span data-part="line" className="truncate text-ui-sm text-fg-muted">
          {LIBRARY_COPY.edited(formatAgo(Math.max(0, now - row.lastEditedAt)), by)}
        </span>
      </span>
    </button>
  );
}

function Quiet({ children }: { children: string }) {
  return <p className="m-0 px-3 py-2 text-ui text-fg-muted">{children}</p>;
}
