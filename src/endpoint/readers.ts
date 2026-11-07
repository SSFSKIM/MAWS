// Whose reading a remote member's requests read and write (P5 O8 M6a, docs/doperpowers/plans/2026-10-28-p5-o8-org-
// interface.md, Interfaces §P; P5 Decision Log 36; the architect's rulings on `session.reader.update`). A session's
// pinned, last seen and unread, and its composer's draft, are kept per reader in the machine's index: the machine's
// owners share the session row's (`'owner'`), and every other member has their own rows. The endpoint names the reader
// for each `machine` request it makes on a channel's behalf, from the channel's authenticated member and the owners the
// head gives (never from the request: no schema has a member field), and every record it sends a member carries that
// member's own reading, or none where they have no row.
import type { Reader } from '@shared/ipc/client';

/** The reader `member` reads as: the owners' when they are one of the machine's owners, else their own. */
export function readerOf(member: string, owners: readonly string[]): Reader {
  return owners.includes(member) ? 'owner' : member;
}

/**
 * The machine's commands whose answer or write is their reader's own (src/services/index/register.ts routes them by
 * `context.reader`): a request of one goes only under a reader that still stands (calls.ts, actions.ts).
 */
export const READER_ROUTED: ReadonlySet<string> = new Set(['session.get', 'session.list', 'session.reader.update', 'session.drafts.get', 'session.drafts.set']);

const READER_FIELDS = ['pinned', 'unread', 'lastSeen'] as const;
/** A reader with no row reads unpinned, read and never seen (the index's own default). */
export const NO_READING: Readonly<Record<(typeof READER_FIELDS)[number], unknown>> = { pinned: false, unread: false, lastSeen: { messageUuid: null, at: null } };

/** `record` with the reader fields of `read` (a record as the member reads it), or none when there is no read. */
export function withReading(record: Readonly<Record<string, unknown>>, read: Readonly<Record<string, unknown>> | null): Record<string, unknown> {
  const reading = read ?? NO_READING;
  return { ...record, ...Object.fromEntries(READER_FIELDS.map((field) => [field, reading[field]])) };
}
