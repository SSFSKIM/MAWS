// An edit's detail: the file as a chip that opens it at the first changed line, and the engine's structuredPatch hunks
// as diff lines with line numbers and the add and del backgrounds (`--diff-add-bg`, `--diff-del-bg`). No third-party
// diff component: C8's Review owns that. The diff is bounded like any output: past 64 KB of line text, its head and tail
// lines around "N lines omitted" and Open full log (a single line past 64 KB is itself capped).
import { partsTruncationOf } from '../../model/cells';
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

// The hunks' lines, bounded as a whole (`partsTruncationOf` over line lengths): past the budget, the head lines and the
// tail lines, each kept in its hunk, with how many lines were left out between them.
type Budgeted = { head: DiffLine[][]; omitted: number; tail: DiffLine[][] };
function budgeted(hunks: Hunk[]): Budgeted {
  const all = hunks.flatMap((hunk, h) => linesOf(hunk).map((line) => ({ h, line })));
  const cut = partsTruncationOf(all.map(({ line }) => line.text.length + 1));
  const byHunk = (lines: typeof all) => {
    const grouped: DiffLine[][] = [];
    lines.forEach(({ h, line }, i) => {
      if (i > 0 && lines[i - 1].h === h) grouped[grouped.length - 1].push(line);
      else grouped.push([line]);
    });
    return grouped;
  };
  if (!cut) return { head: byHunk(all), omitted: 0, tail: [] };
  return { head: byHunk(all.slice(0, cut.head)), omitted: all.length - cut.head - cut.tail, tail: byHunk(all.slice(all.length - cut.tail)) };
}

function DiffHunk({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="transcript-diff-hunk">
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
  );
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
          {diff.head.map((lines, h) => (
            <DiffHunk key={h} lines={lines} />
          ))}
          {diff.omitted > 0 && <Omitted cell={cell} text={DETAIL.linesOmitted(diff.omitted)} />}
          {diff.tail.map((lines, h) => (
            <DiffHunk key={`tail:${h}`} lines={lines} />
          ))}
        </div>
      )}
    </div>
  );
}
