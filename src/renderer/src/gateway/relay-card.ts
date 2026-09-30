// C11's part of C10's relay card (C11 execution document, Interfaces "Gateway", *The launch policy*; M4 refresh task
// "the relay policy in C10's card"; Ask of C10 (7)), used from C11-marked lines in C10's `SetupCard.tsx`: the card's
// policy from settings v3, the hand-off it runs, and Run direct on a gateway model, which the direct route cannot serve,
// first taking a Claude model through `pickDirectModel`: an unstarted session's intent through C10's hook's patch (so
// C7's chips agree), a record's resume as the start's `model` / `effort` overrides.
import type { AppSessionId } from '@shared/graph/ids';
import type { Settings } from '@shared/ipc/schema';
import type { StartOptions } from '@shared/ipc/schema/session';
import type { FirstMessage } from '@shared/sessions/intent';
import { runAction, useActionEnabled } from '../keymap/actions-runtime';
import type { RelayPolicy } from '../sessions/RelayCard';
import { continueSetup, patchIntent } from '../sessions/setup-actions';
import { useSetup } from '../sessions/store';
import { toast } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { pickDirectModel, useDirectModelPick } from './direct-model';

// `wait` makes "Open ClaudeUsage, then start" the primary; `ask` and `direct` offer both (under `direct` the card only
// appears for a gateway model, which the fallback cannot serve).
export const relayPolicyOf = (settings: Settings | null | undefined): RelayPolicy => (settings?.gateway.relayUnreachable === 'wait' ? 'wait' : 'ask');

export const useRelayPolicy = (): RelayPolicy => useSettings((s) => relayPolicyOf(s.state?.settings));

// "Open ClaudeUsage, then start": C11's hand-off action, once registered (the card keeps polling and starts by itself).
export function useOpenClaudeUsage(): (() => void) | null {
  const registered = useActionEnabled('gateway.openClaudeUsage');
  return registered ? () => runAction('gateway.openClaudeUsage') : null;
}

// Whether Run direct's Claude-model pick is open for the session: the card's poll pauses meanwhile, so a relay that
// recovers under the open pick does not start the session routed while the human is choosing to run it direct.
export const usePickingDirectModel = (appSessionId: AppSessionId): boolean => useDirectModelPick((s) => s.picking?.appSessionId === appSessionId);

// Run direct from the card, with the message the card docked with.
export async function runDirect(appSessionId: AppSessionId, docked: FirstMessage | null, gatewayModel: boolean, pick: typeof pickDirectModel = pickDirectModel): Promise<void> {
  if (!gatewayModel) {
    await continueSetup(appSessionId, { gateway: 'direct' }, docked);
    return;
  }
  const choice = await pick(appSessionId);
  if (choice === null) return;
  const chosen = { model: choice.model, ...(choice.effort !== null && { effort: choice.effort }) };
  if (useSetup.getState().intents.has(appSessionId)) {
    const patched = await patchIntent(appSessionId, chosen);
    if (!patched.ok) {
      toast({ level: 'danger', text: patched.error, actions: [], dismissible: true });
      return;
    }
    await continueSetup(appSessionId, { gateway: 'direct' }, docked);
    return;
  }
  const options: StartOptions = { gateway: 'direct', ...chosen };
  await continueSetup(appSessionId, options, docked);
}
