// The pasted-tag id of a session's messages (the terminal's form, `pastedTagId`): from its engine session id, as the
// composer's serialiser frames with it, or four random hex digits for a session that has none yet. UX wave U1c: the tag
// the one-writer rule frames a consent line with at the sites that send the person's free text without the serialiser.
import { pastedTagId } from '@shared/composer/pasted-framing';
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../../stores/sessions';

export function sessionPastedTag(appSessionId: AppSessionId): string {
  const sessions = useSessions.getState();
  return pastedTagId(sessions.engine.get(appSessionId)?.engineSessionId ?? sessions.records.get(appSessionId)?.engineSessionId ?? null);
}
