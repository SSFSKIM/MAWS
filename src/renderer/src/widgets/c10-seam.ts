// C10 seam: replaced by C10's exports at integration (C11 execution document, Decision Log "executor pre-flight"). C10
// (sessions, worktrees, trust) is not on this branch, so the pieces of C11's widgets that need C10 code against the
// stand-ins below, each named for the C10 export it stands for. The C10 integration task swaps each for C10's export
// and deletes this file; nothing here copies C10's code.
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../ipc/client';
import { NOT_RUNNING } from '../statusline/mode-menu';
import { useSessions } from '../stores/sessions';

// C10: `isGatewayModel` (src/shared/sessions/models.ts): the relay's aliases for non-Anthropic providers, `claude/astra`
// and `claude/<vendor>/…` (ClaudeUsage's hard-coded catalogue; §19).
export function isGatewayModel(value: string): boolean {
  return value.startsWith('claude/');
}

// The gateway model's auto-mode note as the model widget words it (§19; mockup 06 vignette 03). C10's `autoModeNote`
// decides when its chip shows its one-line `GATEWAY_AUTO_NOTE`; the widget's form names the routing account, so it
// stays C11's at integration, and only the rule below (auto, or an unstarted intent's unset mode) becomes C10's call.
export const GATEWAY_NOTE = {
  lead: 'Auto-mode reviews for this model run locally.',
  body: (account: string) => `A GPT route carries no Anthropic verdict, so the engine reviews each tool call itself on Sonnet 5 through ${account}. Those requests count against usage.`,
};
// C10: `autoModeNote(entry, mode)`'s gateway arm: a gateway model when the mode is auto, or (an unstarted intent) left
// to settings, whose default is auto for the owner (D-18).
export const showsGatewayNote = (value: string, mode: string | null): boolean => isGatewayModel(value) && (mode === 'auto' || mode === null);

// C10: `session.rename { appSessionId, title }` (rename_session with source 'host' when live, the record's override
// otherwise). Until C10: C3's `session.renameSession`, the same rename_session over a ready process; a session without
// one is refused in words.
export async function renameSession(appSessionId: AppSessionId, title: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (useSessions.getState().engine.get(appSessionId)?.process !== 'ready') return { ok: false, error: `${NOT_RUNNING} · renaming it arrives with C10` };
  const result = await ipc.invoke('session.renameSession', { appSessionId, title });
  return result.ok ? { ok: true } : { ok: false, error: result.error.message };
}

// C10: the session action `resume` in C5's registry (`runSessionAction('resume', appSessionId)`, C10's `session.start
// { message: null }`). C5's action list on this branch has no `resume` id, so Resume is unavailable until C10.
export const resumeAction: ((appSessionId: AppSessionId) => void) | null = null;
