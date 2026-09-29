// The engine's echo after a slash command (`local_command`): a replayed row under its header, never a bubble.
import { LOCAL_COMMAND_HEADER } from '../../model/copy';
import type { Row } from '../../model/rows';

export function LocalCommandRow({ row }: { row: Extract<Row, { kind: 'local_command' }> }) {
  return (
    <div className="transcript-replayed">
      <div className="transcript-replayed-header">{LOCAL_COMMAND_HEADER}</div>
      <pre className="transcript-replayed-output">{row.text}</pre>
    </div>
  );
}
