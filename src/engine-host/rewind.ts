// Rewind (charter §4.2, §19 "rewind branching"; C3 execution document, Interfaces "Rewind, `!`, `#`", M4).
// `rewind_conversation` first, always with the caller's `last_seen_user_message_uuid` (the transcript knows what the
// human has seen; the host never substitutes its own latest uuid, which would defeat the engine's guard against
// discarding an unseen turn) and `interrupt_if_running: false`; the engine emits no reset frame, so the normaliser
// derives `boundary.rewind` from the correlated response row and nothing here synthesises an event. Only after a
// successful conversation rewind, and only when asked, `rewind_files` restores the target's file checkpoint. Both
// requests share one 8 s budget (a bounded X2 handler), the second taking what the first left.
import type { MessageUuid } from '@shared/graph/ids';
import type { RewindFilesOutcome, RewindOutcome } from '@shared/engine/rewind-outcome';
import { REQUEST_TIMEOUT_MS, rewindConversation, rewindFiles as rewindFilesControl } from './controls';
import type { EngineSession } from './session';

export type { RewindFilesOutcome, RewindOutcome } from '@shared/engine/rewind-outcome';

// The engine's answer when file checkpointing is off (`pass2/rewind` seq 38); the receipt hides Undo/Reapply on it.
export const FILE_REWIND_DISABLED = 'File rewinding is not enabled.';

function clientOf(session: EngineSession) {
  const client = session.control;
  if (!client || session.status().process !== 'ready') throw new Error(`session ${session.status().appSessionId} is not ready`);
  return client;
}

export async function rewind(
  session: EngineSession,
  args: { targetMessageUuid: MessageUuid; lastSeenMessageUuid: MessageUuid; files: boolean },
  opts: { budgetMs?: number } = {},
): Promise<RewindOutcome> {
  const client = clientOf(session);
  const deadline = Date.now() + (opts.budgetMs ?? REQUEST_TIMEOUT_MS.mutate);
  const response = await rewindConversation(
    client,
    { target_message_uuid: args.targetMessageUuid, last_seen_user_message_uuid: args.lastSeenMessageUuid, interrupt_if_running: false },
    { timeoutMs: deadline - Date.now() },
  );
  const outcome: RewindOutcome = {
    rewound: response.rewound, reason: response.reason ?? null, error: response.error ?? null, prefillText: response.prefillText,
    precedingAssistantUuid: response.precedingAssistantUuid as MessageUuid | null, files: null,
  };
  if (!response.rewound || !args.files) return outcome;
  // The conversation is already rewound: a restore that fails is reported on `files`, never thrown over the rewind.
  try {
    const restored = await rewindFilesControl(client, { user_message_id: args.targetMessageUuid }, { timeoutMs: Math.max(1, deadline - Date.now()) });
    outcome.files = { canRewind: restored.canRewind, skippedLinks: restored.skippedLinks ?? null, error: restored.error ?? null };
  } catch (error) {
    outcome.files = { canRewind: false, skippedLinks: null, error: error instanceof Error ? error.message : String(error) };
  }
  return outcome;
}

// `rewind_files` alone: a dry run answers "can Undo" and lists what would change; a restore restores. The two answers
// have different shapes and each converts explicitly; `enabled` turns on the engine's exact refusal string alone, so a
// restore's absent counts never read as checkpointing being off.
export async function rewindFiles(session: EngineSession, args: { userMessageUuid: MessageUuid; dryRun: boolean }): Promise<RewindFilesOutcome> {
  const response = await rewindFilesControl(clientOf(session), { user_message_id: args.userMessageUuid, dry_run: args.dryRun });
  return {
    ok: response.canRewind, enabled: response.error !== FILE_REWIND_DISABLED, message: response.error ?? null, dryRun: args.dryRun,
    changedFiles: args.dryRun ? (response.filesChanged ?? null) : null,
    insertions: args.dryRun ? (response.insertions ?? null) : null,
    deletions: args.dryRun ? (response.deletions ?? null) : null,
    skippedLinks: args.dryRun ? null : (response.skippedLinks ?? null),
  };
}
