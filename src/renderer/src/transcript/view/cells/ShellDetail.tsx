// A shell call's detail, after mockup 02: the command with Copy command, its cwd, the output bounded with a fade, and
// a footer with the exit status, Copy output and Copy all, plus Open full log (C8's) when the output was cut or spilled.
import { DETAIL, shellFooter } from '../../model/copy';
import type { Cell, CellDetail } from '../../model/rows';
import { useActions } from '../context';
import { copyText } from '../rows/parts';
import { Truncated } from './Truncated';

type Shell = Extract<CellDetail, { kind: 'shell' }>;

const durationOf = (cell: Cell) => (cell.endedAt === null ? 0 : Date.parse(cell.endedAt) - Date.parse(cell.startedAt));

export function ShellDetail({ cell, detail }: { cell: Cell; detail: Shell }) {
  const actions = useActions();
  const output = [detail.stdout, detail.stderr].filter((part) => part.length > 0).join('\n');
  const footer = cell.status === 'done' || cell.status === 'error' || cell.status === 'stopped' ? shellFooter(cell.status, detail.exitCode, durationOf(cell)) : null;
  const all = [`$ ${detail.command}`, detail.cwd ? `${DETAIL.cwd} ${detail.cwd}` : null, output, footer].filter((part) => part !== null && part.length > 0).join('\n');
  return (
    <div className="transcript-shell">
      <div className="transcript-shell-heading">
        <code>$ {detail.command}</code>
        <button type="button" onClick={() => copyText(detail.command)}>
          {DETAIL.copyCommand}
        </button>
      </div>
      {detail.description && <div className="transcript-shell-meta">{detail.description}</div>}
      {detail.cwd && (
        <div className="transcript-shell-meta">
          {DETAIL.cwd} <span className="transcript-mono">{detail.cwd}</span>
        </div>
      )}
      {output.length > 0 && (
        <pre className="transcript-output transcript-output-faded">
          <Truncated text={detail.stdout} truncation={detail.truncated} />
          {detail.stderr && <span className="transcript-stderr">{`${detail.stdout ? '\n' : ''}${detail.stderr}`}</span>}
        </pre>
      )}
      <div className="transcript-shell-footer">
        <span>{footer}</span>
        <span>
          {(detail.truncated || detail.spill) && (
            <button type="button" onClick={() => actions.openFullLog(cell)}>
              {DETAIL.openFullLog}
            </button>
          )}
          <button type="button" onClick={() => copyText(output)}>
            {DETAIL.copyOutput}
          </button>
          <button type="button" onClick={() => copyText(all)}>
            {DETAIL.copyAll}
          </button>
        </span>
      </div>
    </div>
  );
}
