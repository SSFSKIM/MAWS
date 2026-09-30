// `/diff` (C11 execution document, the widget table): `get_workspace_diff`'s stats and one row per file with its
// `+n −n`, with the skipped-large and restricted counts. "Open in Review" hands the session to C8c's Review tool
// through C8a's panel host once that tool is registered, on the scope the read compared, and a file's row opens it at
// that file; until then the per-file rows are the whole view.
import type { AppSessionId } from '@shared/graph/ids';
import type { GetWorkspaceDiffResponse } from '@shared/wire/control';
import { panelHost, usePanelHost } from '../panel/host';
import { DIFF, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Mono, num, Row, Rows, TextButton } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

export interface DiffView {
  line: string;
  files: { path: string; stat: string; note: string | null }[];
  skippedLarge: number;
  restricted: number;
  scope: 'uncommitted' | 'branch'; // the Review tool's scope for what this read compared
}

export function present({ diff }: GetWorkspaceDiffResponse): DiffView {
  if (diff === null) return { line: DIFF.none, files: [], skippedLarge: 0, restricted: 0, scope: 'uncommitted' };
  const where = diff.source.kind === 'branch' ? DIFF.against(String(diff.source.baseBranch)) : DIFF.workingTree;
  return {
    line: `${DIFF.files(num(diff.stats.filesCount), diff.stats.filesCount === 1)} · +${num(diff.stats.linesAdded)} −${num(diff.stats.linesRemoved)} · ${where}`,
    files: diff.perFileStats.map((f) => {
      const marks = [f.isBinary ? DIFF.binary : null, f.isUntracked ? DIFF.untracked : null].filter((m) => m !== null);
      return { path: f.path, stat: f.isBinary ? '' : `+${num(f.added)} −${num(f.removed)}`, note: marks.length > 0 ? marks.join(' · ') : null };
    }),
    skippedLarge: diff.skippedLarge.length,
    restricted: diff.restricted.length,
    scope: diff.source.kind === 'branch' ? 'branch' : 'uncommitted',
  };
}

export function DiffBody({ view, appSessionId, close }: { view: DiffView; appSessionId: AppSessionId; close(): void }) {
  const review = usePanelHost((s) => s.tools.has('review'));
  // C8c's ReviewParams: the read's scope, and a file's path to open at
  const open = (path?: string) => {
    close();
    panelHost.addTool('review', { appSessionId, params: { scope: view.scope, ...(path === undefined ? {} : { path }) } });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <p className="m-0 flex-1">{view.line}</p>
        <TextButton onClick={() => open()} disabled={!review} title={review ? undefined : DIFF.reviewUnavailable}>
          {DIFF.openInReview}
        </TextButton>
      </div>
      {view.files.length > 0 && (
        <Rows label={DIFF.list}>
          {view.files.map((f) => (
            <Row
              key={f.path}
              main={
                review ? (
                  <button type="button" onClick={() => open(f.path)} className="rounded-sm text-left outline-accent hover:underline focus-visible:outline-2">
                    <Mono>{f.path}</Mono>
                  </button>
                ) : (
                  <Mono>{f.path}</Mono>
                )
              }
              note={[f.stat, f.note].filter(Boolean).join(' · ')}
            />
          ))}
        </Rows>
      )}
      {(view.skippedLarge > 0 || view.restricted > 0) && (
        <p className="m-0 text-ui-sm text-fg-muted">
          {[view.skippedLarge > 0 ? DIFF.skipped(num(view.skippedLarge), view.skippedLarge === 1) : null, view.restricted > 0 ? DIFF.restricted(num(view.restricted), view.restricted === 1) : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

export function DiffWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getWorkspaceDiff', { appSessionId });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.diff} command="diff" foot={WIDGET_FOOT.diff} state={read.state} error={read.error} close={close}>
      {read.data && <DiffBody view={present(read.data)} appSessionId={appSessionId} close={close} />}
    </WidgetFrame>
  );
}
