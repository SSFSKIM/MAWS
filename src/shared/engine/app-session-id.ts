// The engine host's storage boundary for app session ids (C3 execution document, Decision Log "M5 review"): an
// `appSessionId` names a journal directory and a state file, and archive deletes that directory recursively, so an id is
// accepted there only when it is one plain path component. C1's `AppSessionIdSchema` stays a plain brand; the check
// lives where the id meets the filesystem, before any access.
import { HostCommandError } from '../host/runtime';

const SAFE_APP_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/; // no separator, never `.` or `..`, never empty

export function isSafeAppSessionId(id: string): boolean {
  return SAFE_APP_SESSION_ID.test(id);
}

export function assertSafeAppSessionId(id: string): void {
  if (!isSafeAppSessionId(id)) throw new HostCommandError({ code: 'invalid_input', message: 'invalid appSessionId' });
}
