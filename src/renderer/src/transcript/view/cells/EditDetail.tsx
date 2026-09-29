// An edit's detail: the file as a chip that opens it at the first changed line, and the engine's structuredPatch hunks
// as diff lines with line numbers and the add and del backgrounds (`--diff-add-bg`, `--diff-del-bg`). No third-party
// diff component: C8's Review owns that. The diff is bounded like any output: hunks render until 64 KB of line text is
// spent (a single line past 64 KB is itself capped), then "N lines omitted" and Open full log.
import { TRUNCATE_OVER } from '../../model/cells';
import { baseName, DETAIL } from '../../model/copy';
import type { Cell, CellDetail, Hunk } from '../../model/rows';
import { useActions } from '../context';
import { Omitted, Truncated } from './Truncated';

type Edit = Extract<CellDetail, { kind: 'edit' }>;
type DiffKind = 'add' | 'del' | 'context' | 'meta';
type DiffLine = { kind: DiffKind; number: number | null; sign: string; text: string };

// Each line with its number: old numbering for a removed line, new numbering otherwise; `\` lines carry none.
function linesOf(hunk: Hunk): DiffLine[] {
  let old = hunk.oldStart;
  let next = hunk.newStart;
  return hunk.lines.map((line) => {
    const sign = line[0] ?? ' ';
    const text = line.slice(1);
    if (sign === '+') return { kind: 'add', number: next++, sign: '+', text };
    if (sign === '-') return { kind: 'del', number: old++, sign: '−', text };
    if (sign === '\\') return { kind: 'meta', number: null, sign: '', text: line };
    old += 1;
    return { kind: 'context', number: next++, sign: ' ', text: sign === ' ' ? text : line }; // an unprefixed line is context, whole
  });
}

// The hunks' lines up to the budget (the first line always), and how many lines were left out.
function budgeted(hunks: Hunk[]): { hunks: DiffLine[][]; omitted: number } {
  let used = 0;
  let omitted = 0;
  const shown: DiffLine[][] = [];
  for (const hunk of hunks) {
    const lines: DiffLine[] = [];
    for (const line of linesOf(hunk)) {
      if (omitted > 0 || (used > 0 && used + line.text.length + 1 > TRUNCATE_OVER)) {
        omitted += 1;
        continue;
      }
      used += line.text.length + 1;
      lines.push(line);
    }
    if (lines.length > 0) shown.push(lines);
  }
  return { hunks: shown, omitted };
}

export function EditDetail({ cell, detail }: { cell: Cell; detail: Edit }) {
  const actions = useActions();
  const diff = budgeted(detail.hunks);
  return (
    <div className="transcript-edit">
      <button type="button" className="transcript-chip" title={detail.filePath} onClick={() => actions.openFile(detail.filePath, detail.hunks[0]?.newStart)}>
        {baseName(detail.filePath)}
      </button>
      {detail.hunks.length === 0 ? (
        <p className="transcript-detail-note">{DETAIL.noDiff}</p>
      ) : (
        <div className="transcript-diff">
          {diff.hunks.map((lines, h) => (
            <div key={h} className="transcript-diff-hunk">
              {lines.map((line, i) => (
                <div key={i} className="transcript-diff-line" data-diff={line.kind}>
                  <span className="transcript-diff-number" data-line-number="">
                    {line.number ?? ''}
                  </span>
                  <span className="transcript-diff-sign" aria-hidden="true">
                    {line.sign}
                  </span>
                  <span>
                    <Truncated text={line.text} />
                  </span>
                </div>
              ))}
            </div>
          ))}
          {diff.omitted > 0 && <Omitted cell={cell} text={DETAIL.linesOmitted(diff.omitted)} />}
        </div>
      )}
    </div>
  );
}
