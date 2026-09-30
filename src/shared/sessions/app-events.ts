// An event main synthesises for a session (C10's `relay:direct_fallback` notice): `seq: null`, as a disk-read event,
// but its id under `<appSessionId>:`, as C3's live ids are. Neither the host's journal nor the transcript on disk holds
// it, so main keeps it (the read model's `appEvents`) and a transcript's snapshot reads it back from there (debt wave 5).
// Shared because main keeps exactly what the page's source lets past its disk-form filter.
import type { SessionEvent } from '../graph/events';
import type { AppSessionId } from '../graph/ids';

export const isAppSynthesised = (appSessionId: AppSessionId, event: SessionEvent): boolean => event.seq === null && event.id.startsWith(`${appSessionId}:`);
