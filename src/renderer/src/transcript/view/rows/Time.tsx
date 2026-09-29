// A time separator (Derivation, *Time separators*): the model decides where and what; this is its line.
import type { Row } from '../../model/rows';

export function TimeRow({ row }: { row: Extract<Row, { kind: 'time' }> }) {
  return (
    <div role="separator" aria-label={row.label} className="transcript-time">
      {row.label}
    </div>
  );
}
