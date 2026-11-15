// One cell: its collapsed line (the X3 label, code spans as code, edit counts in the diff colours) as a disclosure
// whose state lives in the store, and its detail when open. The status shows as a mark drawn by CSS from
// `data-status`, so the line's text is the label alone. A standalone denied cell is itself focusable (tabindex -1,
// scroll-margin) so the divider's count can land on it.
import { createContext, useContext, type ReactNode } from 'react';
import { useTranscriptStore } from '../../../stores/transcript';
import { DisclosureBody } from '../../../ui/disclosure';
import { baseName, descriptionLabel, SHELL_CELL } from '../../model/copy';
import { blockedLabel, shellToolOf } from '../../model/cells';
import { blockedStates, hiddenTurnsOf, isBlockedCell, lineNamesWhole, readsApproved, withoutRefusalText, type BlockedState } from '../../model/blocked'; // UX wave U1c
import { shortCommand } from '../../model/short-command';
import type { Cell, TurnId } from '../../model/rows';
import { useTranscriptContext } from '../context';
import { Chevron, CodeText, LineCounts } from '../rows/parts';
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

// The model's label as it is: a refusal's diagnostic, and the one form of a stopped call (UX wave U2, decision 23, R2)
const asLabelled = (cell: Cell) => cell.classification.denial !== null || cell.status === 'stopped';

// UX wave U2 (O-49; the U2a document, decision 5, Interfaces §D): what a shell call's row reads, the one function its
// row and its run's line call. In order: the model's label for a refused call that stands alone and for a stopped call;
// the moved label of a call the engine moved to the background (UX wave U4a); the description, always, when the call
// gave one (the agent's own summary, inflected); else the verb and the short form of the command, in code marks; else
// the verb and `a command`. A shell tool with no command line of its own reads the verb and its name.
export function shellLabel(cell: Cell): string {
  if (cell.detail.kind !== 'shell' || asLabelled(cell)) return cell.label;
  if (cell.moved === true) return cell.label; // UX wave U4a (decision 33): the model's moved label first, before a description
  const description = cell.detail.description?.trim().split(/\r?\n/, 1)[0];
  if (description) return descriptionLabel(description, cell.status);
  const status = cell.status === 'running' ? 'running' : cell.status === 'error' ? 'error' : 'done';
  const shell = shellToolOf(cell.toolName);
  if (shell === null) return SHELL_CELL.tool(status, cell.toolName);
  const short = shortCommand(cell.detail.command, shell);
  return short === null ? SHELL_CELL.aCommand[status] : SHELL_CELL.command(status, short);
}

// What a call's row reads, as its line draws it; a run's line reads a call by this same component (UX wave U2,
// decision 5), inside the run's FilePathsContext.
export function CellLabel({ cell }: { cell: Cell }) {
  if (cell.detail.kind === 'shell') return <CodeText text={shellLabel(cell)} />;
  const counts = cell.detail.kind === 'edit' && !asLabelled(cell) ? EDIT_COUNTS.exec(cell.label) : null;
  const label = counts ? cell.label.slice(0, counts.index) : cell.label;
  if (!asLabelled(cell)) {
    if (cell.detail.kind === 'edit') return <FileLabel label={label} path={cell.detail.filePath} target={cell.detail.filePath} />;
    if (cell.detail.kind === 'read' && cell.detail.files.length === 1) {
      const path = cell.detail.files[0].path;
      return <FileLabel label={label} path={path} target={baseName(path)} />;
    }
  }
  return <CodeText text={label} />;
}

// UX wave U1c (Design 3; Interfaces §D): what the rule says of a blocked call's row, read from the store's rows (before
// any projection, so a fold changes nothing it answers); undefined at once for every other cell
function useBlockedState(storeKey: string, cell: Cell): BlockedState | undefined {
  const blocked = isBlockedCell(cell);
  return useTranscriptStore((state) => {
    const entry = blocked ? state.entries[storeKey] : undefined;
    return entry === undefined ? undefined : blockedStates(entry.rows, hiddenTurnsOf(entry.state)).get(cell.id);
  });
}

export function CellLine({ cell: model, turnId, focusable = false, renderDetail, onToggle }: { cell: Cell; turnId: TurnId | null; focusable?: boolean; renderDetail?: (cell: Cell) => ReactNode; onToggle?: () => void }) {
  const { storeKey, variant, actions } = useTranscriptContext();
  const blocked = useBlockedState(storeKey, model);
  const cell = blocked === undefined ? model : { ...model, label: blockedLabel(model, blocked) }; // UX wave U1c: "again", "· approved"
  // UX wave U1c (Design 6; Interfaces §D): "Approve and retry" under a blocked row that does not read approved, in a
  // session's own transcript only (a subagent's grant never reaches the subagent: ruling J), where the mount supplies it;
  // the line wraps to hold the subject whole where it names it, else the control draws the subject itself
  const offered = blocked !== undefined && !readsApproved(blocked) && variant === 'session' && actions.renderBlockedCall !== undefined ? blocked : null;
  const onLine = offered !== null && lineNamesWhole(model, offered.call);
  const opened = withoutRefusalText(model); // UX wave U1c (M2 fix 1): an opened blocked row draws no refusal text as output
  const counts = cell.detail.kind === 'edit' && !asLabelled(cell) ? EDIT_COUNTS.exec(cell.label) : null;
  return (
    <div
      className="transcript-cell"
      data-cell-id={cell.id}
      data-status={cell.status}
      data-expanded={cell.expanded ? '' : undefined}
      data-names-whole={onLine ? '' : undefined}
      tabIndex={focusable ? -1 : undefined}
    >
      <button type="button" className="transcript-cell-line" title={cell.paths.length > 0 ? cell.paths.join('\n') : undefined} aria-expanded={cell.expanded} onClick={onToggle ?? (() => useTranscriptStore.getState().toggleCell(storeKey, cell.id))}>
        <span className="transcript-cell-label">
          <CellLabel cell={cell} />
          {cell.error !== undefined && <>{' '}<span className="transcript-cell-reason">{cell.error}</span></>}
        </span>
        {counts && <LineCounts added={Number(counts[1])} removed={Number(counts[2])} />}
        <Chevron />
      </button>
      {offered !== null && actions.renderBlockedCall!({ cell: model.id, call: offered.call, again: offered.again, grant: offered.grant as 'none' | 'waiting', onLine })}
      <DisclosureBody open={cell.expanded}>
        {renderDetail ? renderDetail(opened) : <CellDetailView cell={opened} turnId={turnId} />}
      </DisclosureBody>
    </div>
  );
}
