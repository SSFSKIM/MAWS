// The project's audit record as the owner reads it (§6: refused, reported). The hub replays its latest entries on every
// connect (DX3), so most of what a visit shows happened before it: each line says when the hub recorded it and which
// machine (or member) it was about, and the summary says when the latest was, so an old refusal is never read as the
// failure of what the owner just did.
//
// A machine's stream sending for a project it has not opened with `hello` (DX2 `not-open`) is left out: a handshake its
// uplink heals by itself, by sending hello again, about nothing the owner sent and with nothing for them to do. The hub
// keeps it in its record; the replay brought every one ever recorded back as a fresh failure (the owner's desk,
// 2026-10-19: three of them read as a Resume's errors).
import { dateFormats, type DateFormats } from '@shared/app/date-format';
import { byWhom } from '../conversation/stream';
import type { AuditItem } from './connection';

/** What the owner is shown of the audit record: everything but the stream handshakes a machine heals by itself. */
export function shownAudit(audit: readonly AuditItem[]): AuditItem[] {
  return audit.filter((item) => !(item.kind === 'refused' && item.entry.reason === 'not-open'));
}

/** When the hub recorded an entry: its clock time today, its date and time before; the whole of it for a title. */
export function auditWhen(at: string, now: number, formats: DateFormats = dateFormats()): { when: string; title: string } {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return { when: 'at a time it did not record', title: '' };
  const today = new Date(ms).toDateString() === new Date(now).toDateString();
  return { when: today ? formats.clock(ms) : formats.dateTime(ms), title: formats.dateTime(ms) };
}

/**
 * One entry as a sentence that names its machine: the hub's own refusal of what a machine (or a member's browser) sent,
 * or a machine's refusal of an event it was sent.
 */
export function auditText(item: AuditItem, member: string | null): string {
  const message = item.entry.message ? `: ${item.entry.message}` : '';
  if (item.kind === 'rejected') {
    const what = item.entry.event ? `${item.entry.event.writer}:${item.entry.event.seq}` : 'an event';
    return `${item.entry.machine} refused ${what} (${item.entry.reason})${message}`;
  }
  const { writer, seq, machine, member: by, reason } = item.entry;
  const who = machine ?? (by ? byWhom(by, member) : null);
  const what = writer ? `${writer}:${seq ?? '?'}${who ? ` from ${who}` : ''}` : who ? `what ${who} sent` : 'what it was sent';
  return `The hub refused ${what} (${reason})${message}`;
}
