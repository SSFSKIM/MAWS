import type { JournalRow } from '@shared/wire/journal';

// Explicit synthetic variant of pass2/rewind for the app's guarded rewind API. The original probe omitted the
// stale-anchor guard at seq 39 and interrupt_if_running at both rewinds. Raw conformance keeps those original rows.
export function withAppRewindGuards(rows: JournalRow[]): JournalRow[] {
  const second = rows.find((row) => row.seq === 19)!.frame as { uuid: string };
  return rows.map((row) => {
    if (row.direction !== 'out' || ![39, 41].includes(row.seq)) return row;
    const frame = row.frame as { request: Record<string, unknown> };
    return { ...row, frame: { ...frame, request: { ...frame.request, last_seen_user_message_uuid: row.seq === 39 ? frame.request.target_message_uuid : second.uuid, interrupt_if_running: false } } };
  });
}
