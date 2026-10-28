// `engine.pendingItems` (P5 O10): for the endpoint's lane B counts, how many of each session's broker items wait on an
// answer (`waitsOnAnswer`, the rule the endpoint applies to each live `session.brokerItems`), never the items
// themselves, whose summaries and payloads are unbounded. A session with none is left out: the endpoint reads the
// answer as the whole set, so a session absent from it waits on nothing. Its size is therefore bounded by the sessions
// waiting on an answer, one `{appSessionId, waiting}` each (a MAWS-minted id and a count, well under 100 bytes), and
// never by what an item carries: kilobytes for any table the engine host's budget allows, against the 64 MiB line cap.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { waitsOnAnswer } from '@shared/attention/kinds';

type Row = { status(): { appSessionId: AppSessionId }; brokerItems(): AttentionItem[] };

export function pendingCounts(rows: Iterable<Row>): { sessions: Array<{ appSessionId: AppSessionId; waiting: number }> } {
  const sessions: Array<{ appSessionId: AppSessionId; waiting: number }> = [];
  for (const row of rows) {
    const waiting = row.brokerItems().filter(waitsOnAnswer).length;
    if (waiting > 0) sessions.push({ appSessionId: row.status().appSessionId, waiting });
  }
  return { sessions };
}
