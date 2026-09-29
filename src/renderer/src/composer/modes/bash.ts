// `!` (C7 execution document, "`!` and `#`"): a leading `!` at offset 0 of the editor is the bash mode, detected by
// the serialiser (one paragraph of plain text); the command runs through the engine's own shell frame (C3's
// `session.bash`), whose output comes back as replayed rows in the transcript (C6 renders them) and reaches the model.
// The SPEC restricts nothing mid-turn, so the command is not held for an idle session.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';

export const BASH_HINT = 'Shell command · runs through the engine · output goes to the transcript';

export async function runBash(client: MawsBridge, appSessionId: AppSessionId, command: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await client.invoke('session.bash', { appSessionId, command });
  return result.ok ? { ok: true } : { ok: false, error: result.error.message };
}
