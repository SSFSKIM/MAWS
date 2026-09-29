// The session state port (charter §4.2 "Queue ownership", §4.4; C3 execution document, Interfaces "Queue, steer,
// interrupt"): what the engine host persists per app session so a queued message and a session grant survive the
// process and the app. The queue entry's states are what C7 renders: `queued` (waiting in the app queue),
// `submitting` (persisted with its minted uuid before the `user` frame is written), `released` (the engine's
// `command_lifecycle` named the uuid), and `uncertain` for a submission a crash interrupted, which waits for the human.
// The port is async so a cross-process adapter (C12) can replace the P0 file adapter without touching the engine host.
import * as z from 'zod';
import { ContentBlockSchema } from '../graph/events';
import { AppSessionIdSchema, MessageUuidSchema, type AppSessionId } from '../graph/ids';
import type { LaunchSpec } from './launch-spec';

export const QueueEntrySchema = z.strictObject({
  queueId: z.string(), appSessionId: AppSessionIdSchema, content: z.union([z.string(), z.array(ContentBlockSchema)]),
  createdAt: z.string(), state: z.enum(['queued', 'submitting', 'released']), messageUuid: MessageUuidSchema.nullable(), // messageUuid is minted at `submitting`
  submittedAt: z.string().nullable(), uncertain: z.boolean(), // uncertain: a submission a crash interrupted, awaiting the human
  steer: z.boolean(), // a promoted entry on its way as a steer (M4 review): persisted `submitting` before the write, removed after the flush; false otherwise
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;

// C7 start: why the queue is paused (C7 execution document, Decision Log "execution start 2026-09-29" item 2, as the
// architect ruled): the closed set of reasons MessageQueue pauses for, one per `meta queue { action: 'pause' }` row it
// journals. Persisted beside `paused` and published on `session.queue`; absent only in a state file written before it.
export const QUEUE_PAUSE_REASONS = ['user', 'interrupt', 'write_failed', 'uncertain', 'exit', 'engine_turn', 'refused', 'store_failed', 'state_corrupt'] as const;
export const QueuePauseReasonSchema = z.enum(QUEUE_PAUSE_REASONS);
export type QueuePauseReason = z.infer<typeof QueuePauseReasonSchema>;
// C7 end

export const QueueStateSchema = z.strictObject({ entries: z.array(QueueEntrySchema), paused: z.boolean(), pauseReason: QueuePauseReasonSchema.nullable().optional() }); // C7: pauseReason
export type QueueState = z.infer<typeof QueueStateSchema>;
// What a load answers: the queue, and the path an unreadable state file was moved to (kept, never deleted) when the
// load found one, so the queue can say so instead of starting silently empty (M4 review).
export type StoredQueue = QueueState & { corrupt: string | null };

// What `session.send`, `session.steer` and `session.queue.edit` accept (M4: content over 1 MiB is refused at the
// schema; the renderer attaches files instead, C7). Measured as the UTF-8 length of the JSON the frame would carry.
export const MAX_SEND_CONTENT_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
// C7 start: the send cap relaxed to four bounds (C7 execution document, Decision Log "architect's ruling, 2026-09-29, on
// the send cap"). Pasting screenshots is the Claude Desktop bar, and one 1568 px PNG is 1 to 3 MB of base64, so the
// 1 MiB bound applies to text only (a string content, or the text blocks together); each image block is bounded at
// 5 MiB decoded (the API's per-image limit), each document block at 32 MiB decoded, and the whole content at 48 MiB of
// JSON, under the transport's 64 MiB line bound. A queued screenshot lives in the state file until it sends. The
// composer pre-checks the same function and names the bound that was hit.
export const MAX_SEND_TEXT_BYTES = MAX_SEND_CONTENT_BYTES;
export const MAX_SEND_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_SEND_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const MAX_SEND_CONTENT_JSON_BYTES = 48 * 1024 * 1024;
export type SendBound = 'text' | 'image' | 'document' | 'content';
export interface SendRefusal {
  bound: SendBound;
  bytes: number; // what was measured: the text's UTF-8 bytes, one block's decoded bytes, or the content's JSON bytes
  limit: number;
  message: string;
}
const MESSAGES: Record<SendBound, string> = {
  text: 'text is larger than 1 MiB; attach it as a file instead',
  image: 'an image is larger than 5 MiB',
  document: 'a document is larger than 32 MiB',
  content: 'the message is larger than 48 MiB',
};
const decodedBytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
const base64Of = (block: Readonly<Record<string, unknown>>) => {
  const source = block.source as { type?: unknown; data?: unknown } | undefined;
  return source?.type === 'base64' && typeof source.data === 'string' ? source.data : null;
};
export function sendContentRefusal(content: string | ReadonlyArray<{ type: string; [key: string]: unknown }>): SendRefusal | null {
  const refuse = (bound: SendBound, bytes: number, limit: number): SendRefusal => ({ bound, bytes, limit, message: MESSAGES[bound] });
  const text = typeof content === 'string' ? content : content.map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('');
  const textBytes = encoder.encode(text).length;
  if (textBytes > MAX_SEND_TEXT_BYTES) return refuse('text', textBytes, MAX_SEND_TEXT_BYTES);
  if (typeof content !== 'string') {
    for (const block of content) {
      const data = block.type === 'image' || block.type === 'document' ? base64Of(block) : null;
      if (data === null) continue;
      const limit = block.type === 'image' ? MAX_SEND_IMAGE_BYTES : MAX_SEND_DOCUMENT_BYTES;
      const bytes = decodedBytes(data);
      if (bytes > limit) return refuse(block.type === 'image' ? 'image' : 'document', bytes, limit);
    }
  }
  const json = typeof content === 'string' ? textBytes : encoder.encode(JSON.stringify(content)).length;
  return json > MAX_SEND_CONTENT_JSON_BYTES ? refuse('content', json, MAX_SEND_CONTENT_JSON_BYTES) : null;
}
export const SendContentSchema = z.union([z.string(), z.array(ContentBlockSchema)]).superRefine((content, ctx) => {
  const refusal = sendContentRefusal(content);
  if (refusal) ctx.addIssue({ code: 'custom', message: refusal.message });
});
// C7 end
export type SendContent = z.infer<typeof SendContentSchema>;

export interface GrantSnapshot {
  allow: string[]; // rule strings as list_permission_rules renders them: 'Bash(touch granted.txt)'
}
export const GrantSnapshotSchema = z.strictObject({ allow: z.array(z.string()) });

export interface SessionStateStore {
  exists(appSessionId: AppSessionId): Promise<boolean>; // a state file exists for the id (C10's ask: `session.queue.list` for an unreserved id)
  loadQueue(appSessionId: AppSessionId): Promise<StoredQueue>; // reads only: the recovery transitions happen in MessageQueue
  saveQueue(appSessionId: AppSessionId, queue: QueueState): Promise<void>;
  loadGrants(appSessionId: AppSessionId): Promise<GrantSnapshot>;
  saveGrants(appSessionId: AppSessionId, grants: GrantSnapshot): Promise<void>;
  loadLaunchSpec(appSessionId: AppSessionId): Promise<LaunchSpec | null>; // the last spec, so a resume can reuse cwd, model, gateway
  saveLaunchSpec(appSessionId: AppSessionId, spec: LaunchSpec): Promise<void>;
  forgetJournal(appSessionId: AppSessionId): Promise<void>; // archive (charter §12 C10): the journal only; the state file with the queue and grants survives
  forget(appSessionId: AppSessionId): Promise<void>; // the whole erase, state file and journal (C10's delete conversation)
}
