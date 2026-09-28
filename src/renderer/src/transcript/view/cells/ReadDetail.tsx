// A read's detail (a merged read cell lists every file): path chips that open the file at the first line of the range
// read, then what the reads returned, bounded.
import { baseName } from '../../model/copy';
import type { CellDetail } from '../../model/rows';
import { useActions } from '../context';
import { Output } from './Truncated';

type Read = Extract<CellDetail, { kind: 'read' }>;

export function ReadDetail({ detail }: { detail: Read }) {
  const actions = useActions();
  return (
    <div className="transcript-read">
      <div className="transcript-chips">
        {detail.files.map((file, i) => (
          <button key={i} type="button" className="transcript-chip" title={file.path} onClick={() => actions.openFile(file.path, file.range?.[0])}>
            {baseName(file.path)}
            {file.range && <span className="transcript-chip-detail">{`:${file.range[0]}–${file.range[1]}`}</span>}
          </button>
        ))}
      </div>
      {detail.preview && <Output text={detail.preview} truncation={detail.truncated} />}
    </div>
  );
}
