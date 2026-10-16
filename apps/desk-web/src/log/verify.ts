// A log event is drawn only after it verifies (§6, DX1) under the project the view serves. Verification is the
// protocol module's `verify`: the code, its canonical spelling, and for a `hub/` event the shape of the position the
// code leaves out (writer, seq, ts). This adds only the reading guard the projection needs (an object with a string
// writer and kind, an integer seq, a mac), so a malformed event is refused as such instead of throwing in a view.
import { verify, type LogEvent, type OrgKey } from 'desk-hub/protocol';

export type Verdict = { ok: true } | { ok: false; reason: 'bad-code' | 'malformed' };

export function isLogEvent(value: unknown): value is LogEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.writer === 'string' && typeof event.kind === 'string' && Number.isInteger(event.seq) && typeof event.mac === 'object' && event.mac !== null;
}

export async function verifyLogEvent(key: OrgKey, project: string, event: unknown): Promise<Verdict> {
  if (!isLogEvent(event)) return { ok: false, reason: 'malformed' };
  return (await verify(key, 'log', project, event)) ? { ok: true } : { ok: false, reason: 'bad-code' };
}
