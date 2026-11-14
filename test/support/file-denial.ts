// A call refused because auto mode was unavailable, by the three ways its result reaches the machine's services (UX wave
// U2, the U2a execution document's M1 and the architect's ruling R3): the events `recordToEvents` makes from a transcript
// file (a fresh follower's backfill: `seq: null`), the same rows as the normaliser's rebuild from the transcript
// (`transcript_reseed`: the row's `seq`, `reseeded: true`), and the result over the wire. Content invented. Shared by the
// attention service's test (`src/services/attention/file-denial.test.ts`) and the notifier's
// (`src/main/attention/file-denial.test.ts`), which the services library's import boundary keeps apart.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { parseTranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../src/engine-host/fs/backfill';
import { Normalizer } from '../../src/engine-host/normalizer';

export const FILE_DENIAL_SESSION = '7b6a5d4c-0000-4000-8000-0000000a0b0c';
export const REFUSED_CALL = 'toolu_file_denial_1';
const at = (s: number) => `2026-11-13T09:00:${String(s).padStart(2, '0')}.000Z`;

/** The transcript rows: a prompt, the call, its result refused as `automode-unavailable`, the model's answer, a later prompt. */
export const FILE_DENIAL_ROWS: Record<string, unknown>[] = [
  { type: 'user', uuid: 'fd-1', parentUuid: null, timestamp: at(1), sessionId: FILE_DENIAL_SESSION, message: { role: 'user', content: 'Publish the preview build.' } },
  { type: 'assistant', uuid: 'fd-2', parentUuid: 'fd-1', timestamp: at(2), sessionId: FILE_DENIAL_SESSION, message: { id: 'msg_fd_1', role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id: REFUSED_CALL, name: 'Bash', input: { command: 'make publish-preview' } }] } },
  {
    type: 'user', uuid: 'fd-3', parentUuid: 'fd-2', timestamp: at(3), sessionId: FILE_DENIAL_SESSION, toolDenialKind: 'automode-unavailable',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: REFUSED_CALL, is_error: true, content: 'Auto mode is unavailable for this request.' }] },
  },
  { type: 'assistant', uuid: 'fd-4', parentUuid: 'fd-3', timestamp: at(4), sessionId: FILE_DENIAL_SESSION, message: { id: 'msg_fd_2', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'Auto mode is unavailable; switch modes and I will go on.' }] } },
  { type: 'user', uuid: 'fd-5', parentUuid: 'fd-4', timestamp: at(30), sessionId: FILE_DENIAL_SESSION, message: { role: 'user', content: 'Switched; go on.' } },
];

/** A fresh follower's backfill of the file: every event `seq: null`. */
export function fileBackfillEvents(): SessionEvent[] {
  const ctx = createBackfillContext({ sessionId: FILE_DENIAL_SESSION as SessionId, agent: null });
  return FILE_DENIAL_ROWS.flatMap((row) => recordToEvents(parseTranscriptRecord(row), ctx));
}

const normalizer = () => new Normalizer({ appSessionId: 'app-file-denial' as AppSessionId, launchId: 'LAUNCH01', sessionId: FILE_DENIAL_SESSION as SessionId });

/** The same rows as the normaliser's rebuild from the transcript: the journal row's `seq`, marked `reseeded`. */
export function reseedEvents(): SessionEvent[] {
  return normalizer().push({ seq: 41, direction: 'meta', at: at(31), frame: { event: 'transcript_reseed', rows: FILE_DENIAL_ROWS } });
}

/** The refused result over the wire, as its own frame: the call, then its result with the wire's kind. */
export function wireEvents(): SessionEvent[] {
  const n = normalizer();
  return [
    ...n.push({ seq: 1, direction: 'in', at: at(2), frame: { type: 'assistant', uuid: 'fd-2', session_id: FILE_DENIAL_SESSION, parent_tool_use_id: null, message: { id: 'msg_fd_1', role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id: REFUSED_CALL, name: 'Bash', input: { command: 'make publish-preview' } }], stop_reason: 'tool_use', usage: {} } } }),
    ...n.push({
      seq: 2, direction: 'in', at: at(3),
      frame: { type: 'user', uuid: 'fd-3', session_id: FILE_DENIAL_SESSION, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: REFUSED_CALL, is_error: true, content: 'Auto mode is unavailable for this request.' }] }, tool_result_meta: [{ id: REFUSED_CALL, non_execution_kind: 'automode-unavailable' }] },
    }),
  ];
}

/** The events as one batch, and as two split immediately after the refused result. */
export function batchingsOf(events: SessionEvent[]): { name: string; batches: SessionEvent[][] }[] {
  const refused = events.findIndex((event) => event.kind === 'tool.result' && event.toolUseId === REFUSED_CALL);
  if (refused < 0) throw new Error('no refused result among the events');
  return [
    { name: 'one batch', batches: [events] },
    { name: 'two batches, split after the refused result', batches: [events.slice(0, refused + 1), events.slice(refused + 1)] },
  ];
}
