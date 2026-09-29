// `/diff` (C11 execution document, the widget table): `get_workspace_diff`'s stats and one row per file with its
// `+n −n`, with the skipped-large and restricted counts. "Open in Review" hands the session to C8c's Review tool
// through C8a's panel host once that tool is registered; until then the per-file rows are the whole view.
import type { AppSessionId } from '@shared/graph/ids';
import type { GetWorkspaceDiffResponse } from '@shared/wire/control';
import { ARRIVES_WITH } from '../panel/arrives-with';
import { panelHost, usePanelHost } from '../panel/host';
import { NO_DIFF, OPEN_IN_REVIEW, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Mono, num, Row, Rows, TextButton } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

export interface DiffView {
  line: string;
  files: { path: string; stat: string; note: string | null }[];
  skippedLarge: number;
  restricted: number;
}

const plural = (n: number, one: string) => `${num(n)} ${one}${n === 1 ? '' : 's'}`;

export function present({ diff }: GetWorkspaceDiffResponse): DiffView {
  if (diff === null) return { line: NO_DIFF, files: [], skippedLarge: 0, restricted: 0 };
  const where = diff.source.kind === 'branch' ? `against ${String(diff.source.baseBranch)}` : 'working tree';
  return {
    line: `${plural(diff.stats.filesCount, 'file')} · +${num(diff.stats.linesAdded)} −${num(diff.stats.linesRemoved)} · ${where}`,
    files: diff.perFileStats.map((f) => {
      const marks = [f.isBinary ? 'binary' : null, f.isUntracked ? 'untracked' : null].filter((m) => m !== null);
      return { path: f.path, stat: f.isBinary ? '' : `+${num(f.added)} −${num(f.removed)}`, note: marks.length > 0 ? marks.join(' · ') : null };
    }),
    skippedLarge: diff.skippedLarge.length,
    restricted: diff.restricted.length,
  };
}

export function DiffBody({ view, appSessionId, close }: { view: DiffView; appSessionId: AppSessionId; close(): void }) {
  const review = usePanelHost((s) => s.tools.has('review'));
  const open = () => {
    close();
    panelHost.addTool('review', { appSessionId });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <p className="m-0 flex-1">{view.line}</p>
        <TextButton onClick={open} disabled={!review} title={review ? undefined : `arrives with ${ARRIVES_WITH.review}`}>
          {OPEN_IN_REVIEW}
        </TextButton>
      </div>
      {view.files.length > 0 && (
        <Rows label="Changed files">
          {view.files.map((f) => (
            <Row key={f.path} main={<Mono>{f.path}</Mono>} note={[f.stat, f.note].filter(Boolean).join(' · ')} />
          ))}
        </Rows>
      )}
      {(view.skippedLarge > 0 || view.restricted > 0) && (
        <p className="m-0 text-ui-sm text-fg-muted">
          {[view.skippedLarge > 0 ? `${plural(view.skippedLarge, 'large file')} skipped` : null, view.restricted > 0 ? `${plural(view.restricted, 'restricted file')} not shown` : null]
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
