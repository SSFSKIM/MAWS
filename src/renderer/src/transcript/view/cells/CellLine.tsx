// One cell: its collapsed line (the X3 label, code spans as code, edit counts in the diff colours) as a disclosure
// whose state lives in the store, and its detail when open. The status shows as a mark drawn by CSS from
// `data-status`, so the line's text is the label alone. A standalone denied cell is itself focusable (tabindex -1,
// scroll-margin) so the divider's count can land on it.
import { createContext, useContext, type ReactNode } from 'react';
import { useTranscriptStore } from '../../../stores/transcript';
import { DisclosureBody } from '../../../ui/disclosure';
import { baseName, descriptionLabel } from '../../model/copy';
import type { Cell, TurnId } from '../../model/rows';
import { useTranscriptContext } from '../context';
import { Chevron, CodeText, LineCounts } from '../rows/parts';
import { LiveThinkingCellLabel } from '../rows/ThinkingLabel';
import { CellDetailView } from './CellDetail';

const EDIT_COUNTS = / \+(\d+) −(\d+)$/;

// The group supplies peers around both native cells and surface-wrapped cells. Stored paths and copy labels stay whole.
export const FilePathsContext = createContext<readonly string[]>([]);

export function shortestFileSuffix(path: string, peers: readonly string[]): string {
  const parts = path.split('/').filter(Boolean);
  const others = peers.filter((peer) => peer !== path && baseName(peer) === baseName(path)).map((peer) => peer.split('/').filter(Boolean));
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const suffix = parts.slice(-depth).join('/');
    if (!others.some((other) => other.slice(-depth).join('/') === suffix)) return suffix;
  }
  return path;
}

function FileLabel({ label, path, target }: { label: string; path: string; target: string }) {
  const peers = useContext(FilePathsContext);
  return <><span className="transcript-file-verb">{label.slice(0, label.length - target.length).trimEnd()}</span>{' '}<span className="transcript-file-target">{shortestFileSuffix(path, peers)}</span></>;
}

function Label({ cell, turnId }: { cell: Cell; turnId: TurnId | null }) {
  // Bash's description is the agent-authored summary, not a command to reformat. Keep diagnostic denial labels.
  if (cell.detail.kind === 'shell' && !cell.classification.denial) {
    const description = cell.detail.description?.trim().split(/\r?\n/, 1)[0];
    const verb = { running: 'Running', done: 'Ran', error: 'Failed', stopped: 'Stopped', denied: 'Denied' }[cell.status];
    return <>{description ? descriptionLabel(description, cell.status) : `${verb} ${cell.toolName}`}</>;
  }
  if (cell.toolName === 'Skill') return <>Ran /{cell.label.replace(/^Loaded (.*) skill$/, '$1').replace(/^\//, '')}</>;
  if (cell.toolName === 'thinking' && cell.status === 'running') return <LiveThinkingCellLabel cell={cell} turnId={turnId} />; // W8
  const counts = cell.detail.kind === 'edit' && !cell.classification.denial ? EDIT_COUNTS.exec(cell.label) : null;
  const label = counts ? cell.label.slice(0, counts.index) : cell.label;
  if (!cell.classification.denial) {
    if (cell.detail.kind === 'edit') return <FileLabel label={label} path={cell.detail.filePath} target={cell.detail.filePath} />;
    if (cell.detail.kind === 'read' && cell.detail.files.length === 1) {
      const path = cell.detail.files[0].path;
      return <FileLabel label={label} path={path} target={baseName(path)} />;
    }
  }
  return <CodeText text={label} />;
}

export function CellLine({ cell, turnId, focusable = false, renderDetail, onToggle }: { cell: Cell; turnId: TurnId | null; focusable?: boolean; renderDetail?: (cell: Cell) => ReactNode; onToggle?: () => void }) {
  const { storeKey } = useTranscriptContext();
  const counts = cell.detail.kind === 'edit' && !cell.classification.denial ? EDIT_COUNTS.exec(cell.label) : null;
  return (
    <div
      className="transcript-cell"
      data-cell-id={cell.id}
      data-status={cell.status}
      data-bookkeeping={cell.classification.hidden && cell.toolName !== 'thinking' ? '' : undefined}
      data-expanded={cell.expanded ? '' : undefined}
      tabIndex={focusable ? -1 : undefined}
    >
      <button type="button" className="transcript-cell-line" title={cell.paths.length > 0 ? cell.paths.join('\n') : undefined} aria-expanded={cell.expanded} onClick={onToggle ?? (() => useTranscriptStore.getState().toggleCell(storeKey, cell.id))}>
        <span className="transcript-cell-label">
          <Label cell={cell} turnId={turnId} />
        </span>
        {counts && <LineCounts added={Number(counts[1])} removed={Number(counts[2])} />}
        <Chevron />
      </button>
      <DisclosureBody open={cell.expanded}>
        {renderDetail ? renderDetail(cell) : <CellDetailView cell={cell} turnId={turnId} />}
      </DisclosureBody>
    </div>
  );
}
