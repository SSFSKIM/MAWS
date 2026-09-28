// An edit's detail: the file as a chip that opens it at the first changed line, and the engine's structuredPatch hunks
// as diff lines with line numbers and the add and del backgrounds (`--diff-add-bg`, `--diff-del-bg`). No third-party
// diff component: C8's Review owns that.
import { baseName, DETAIL } from '../../model/copy';
import type { CellDetail, Hunk } from '../../model/rows';
import { useActions } from '../context';

type Edit = Extract<CellDetail, { kind: 'edit' }>;
type DiffKind = 'add' | 'del' | 'context' | 'meta';

// Each line with its number: old numbering for a removed line, new numbering otherwise; `\` lines carry none.
function linesOf(hunk: Hunk): { kind: DiffKind; number: number | null; sign: string; text: string }[] {
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

export function EditDetail({ detail }: { detail: Edit }) {
  const actions = useActions();
  return (
    <div className="transcript-edit">
      <button type="button" className="transcript-chip" title={detail.filePath} onClick={() => actions.openFile(detail.filePath, detail.hunks[0]?.newStart)}>
        {baseName(detail.filePath)}
      </button>
      {detail.hunks.length === 0 ? (
        <p className="transcript-detail-note">{DETAIL.noDiff}</p>
      ) : (
        <div className="transcript-diff">
          {detail.hunks.map((hunk, h) => (
            <div key={h} className="transcript-diff-hunk">
              {linesOf(hunk).map((line, i) => (
                <div key={i} className="transcript-diff-line" data-diff={line.kind}>
                  <span className="transcript-diff-number" data-line-number="">
                    {line.number ?? ''}
                  </span>
                  <span className="transcript-diff-sign" aria-hidden="true">
                    {line.sign}
                  </span>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
