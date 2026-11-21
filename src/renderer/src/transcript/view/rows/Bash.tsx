// A `!` command replayed from the engine's bash tags (Derivation, *Bash rows*): `! {command}`, its output, `exit {code}`
// for a non-zero exit.
// A replayed row, never a user bubble.
import { bashFooter, bashHeader } from '../../model/copy';
import type { Row } from '../../model/rows';
import { Truncated } from '../cells/Truncated';

export function BashRow({ row }: { row: Extract<Row, { kind: 'bash' }> }) {
  return (
    <div className="transcript-replayed" data-replayed="bash">
      <div className="transcript-replayed-header">
        <code>{bashHeader(row.command)}</code>
      </div>
      {(row.stdout || row.stderr) && (
        <pre className="transcript-replayed-output">
          <Truncated text={row.stdout} />
          {row.stderr && (
            <span className="transcript-stderr">
              {row.stdout ? '\n' : ''}
              <Truncated text={row.stderr} />
            </span>
          )}
        </pre>
      )}
      {bashFooter(row.exitCode) !== '' && <div className="transcript-replayed-footer">{bashFooter(row.exitCode)}</div> /* the word cut (T66): none for exit 0 */}
    </div>
  );
}
