// The compaction's row (UX wave U3b, decisions 16 and 17, Interfaces §E): "Compacting session…" in the turn line's
// type, then the time since this window first saw the compaction, once it reaches a second, ticking once a second as
// the turn line's "Working for" does. A polite status whose time is a timer (`TickingStatus`), so a reader hears the
// line when it appears and not each second. It starts at the rows' left edge, not indented to the turn line's words
// (ruled R18).
import { compactingLine } from '../../model/copy';
import type { Row } from '../../model/rows';
import { duration } from '../../model/time';
import { TickingStatus, useTicker } from './parts';

export function ActivityRow({ row }: { row: Extract<Row, { kind: 'activity' }> }) {
  const now = useTicker(true);
  const elapsed = Math.max(0, now - Date.parse(row.since));
  return <TickingStatus className="transcript-activity" line={compactingLine} elapsed={elapsed < 1000 ? null : duration(elapsed)} />;
}
