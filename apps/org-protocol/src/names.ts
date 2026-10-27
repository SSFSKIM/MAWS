// The names and times every signed shape carries, moved here from desk-hub's protocol module (DX1, DX7), which
// re-exports them unchanged: one rule for a member id, a machine name, a log writer and an ISO time, for the hub, the
// machines and the apps alike.

/** A member id: 128 random bits as lowercase hex. Not a uuid, which sminos would read as a session (`writer_session`). */
export type MemberId = string;
export const isMemberId = (id: string) => /^[0-9a-f]{32}$/.test(id);

// Machine names. A machine writes `<name>/<session>` feeds into files named after them on every machine, so a name is a
// file-name-safe word, unique in the org without regard to case (macOS's disk ignores case), and never a prefix the hub
// gives another meaning: `hub/` (web writes) and `legacy/` (pre-.smns chats).
export const RESERVED_MACHINE_NAMES = ['hub', 'legacy'] as const;
const MACHINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export const machineNameKey = (name: string) => name.toLowerCase();

/**
 * A MachineRef (RL §2.3, RL DL 19): the opaque id a machine's daemon mints at its first run, from at least 128 random
 * bits, and keeps for good. Every contract field named `machine` carries it; the name is a display attribute.
 */
export const isMachineRef = (ref: unknown): ref is string => typeof ref === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(ref);

export function isMachineName(name: string): boolean {
  return MACHINE_NAME.test(name) && !(RESERVED_MACHINE_NAMES as readonly string[]).includes(machineNameKey(name));
}

const ISO_MILLIS = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.[0-9]{3}Z$/;

/**
 * An ISO 8601 UTC time with milliseconds, `YYYY-MM-DDTHH:MM:SS.mmmZ`, naming a real calendar day (leap years by the
 * Gregorian rule), an hour below 24, and minutes and seconds below 60. Checked by these rules alone, not by a date
 * library, so the daemon's Python and this agree on every string. Two such times compare as strings in time order.
 */
export function isIsoMillis(ts: unknown): ts is string {
  if (typeof ts !== 'string') return false;
  const m = ISO_MILLIS.exec(ts);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days && hour < 24 && minute < 60 && second < 60;
}

export const HUB_WRITER_PREFIX = 'hub/';
export const LEGACY_WRITER_PREFIX = 'legacy/';

export const hubWriter = (member: string) => `${HUB_WRITER_PREFIX}${member}`;
export const isHubWriter = (writer: string) => writer.startsWith(HUB_WRITER_PREFIX);

/** A log `seq`: a JSON number whose value is a positive integer no larger than 2^53 − 1. */
export function isLogSeq(seq: unknown): seq is number {
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 1;
}

/**
 * A `hub/` event's position — `writer`, `seq`, `ts`, which the hub assigns and its code leaves out — checked by shape
 * (DX1): the writer is exactly `hub/` and the event's own `member` (32 lowercase hex, which the code covers), the seq a
 * positive integer, the time ISO 8601 UTC with milliseconds. sminos's delivery writes the writer into the frame a
 * session reads, so an unchecked writer could carry text no code covers. `verify` applies it to every `hub/` event.
 */
export function isHubPosition(event: { writer?: unknown; seq?: unknown; ts?: unknown; member?: unknown }): boolean {
  return (
    typeof event.member === 'string' &&
    isMemberId(event.member) &&
    event.writer === hubWriter(event.member) &&
    isLogSeq(event.seq) &&
    isIsoMillis(event.ts)
  );
}

/** The machine a writer belongs to (`<machine>/<session uuid>` or `<machine>/human`), or null for `hub/` and `legacy/`. */
export function writerMachine(writer: string): string | null {
  if (isHubWriter(writer) || writer.startsWith(LEGACY_WRITER_PREFIX)) return null;
  const slash = writer.indexOf('/');
  return slash > 0 ? writer.slice(0, slash) : null;
}
