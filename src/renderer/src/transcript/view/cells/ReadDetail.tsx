// A read's detail (a merged read cell lists every file): path chips that open the file at the first line of the range
// read, then what the reads returned, bounded.
import { Tip } from '../../../ui/tip';
import { baseName } from '../../model/copy';
import type { CellDetail } from '../../model/rows';
import { useActions, useRowSession } from '../context';
import { Output } from './Truncated';

type Read = Extract<CellDetail, { kind: 'read' }>;

export function ReadDetail({ detail }: { detail: Read }) {
  const actions = useActions();
  const session = useRowSession();
  return (
    <div className="transcript-read">
      <div className="transcript-chips">
        {detail.files.map((file, i) => (
          // ticket 815: the full path is the chip's tip, which the keyboard reaches
          <Tip key={i} content={file.path} description={file.path}>
            <button type="button" className="transcript-chip" onClick={() => actions.openFile(file.path, file.range?.[0], session)}>
              {baseName(file.path)}
              {file.range && <span className="transcript-chip-detail">{`:${file.range[0]}–${file.range[1]}`}</span>}
            </button>
          </Tip>
        ))}
      </div>
      {detail.preview && <Output text={detail.preview} />}
    </div>
  );
}
