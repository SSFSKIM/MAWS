// Which setup card a session's tab shows, and what its buttons do (C10 execution document, "The unstarted session";
// M3's carried rule: a continuation that is refused hands the docked message back). The trust and relay cards wait on
// a start's answer, the failure card on a failed setup. M4a renders the chosen card in a plain frame where its tab
// shows it (the unstarted heading's column, a record's composer column); M4b docks the same bodies through C7's
// `dockCard` inside `DockedCardFrame`, which then owns the frame, focus, Enter and Esc.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { isGatewayModel } from '@shared/sessions/models';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { FAILURE_CARD_TITLE, FailureCard } from './FailureCard';
import { RELAY_CARD_TITLE, RelayCard, type RelayPolicy } from './RelayCard';
import { continueSetup, releaseMessage, resolveWorktree, type WorktreeResource } from './setup-actions';
import { failureOf, isStarting, useSetup, type SetupFailure, type WaitingCard } from './store';
import { TRUST_CARD_TITLE, TrustCard } from './TrustCard';

export const RELAY_POLL_MS = 5_000;

// C11's settings v3 owns `relayUnreachable`; until it lands the default applies (C10's readSettings seam).
const RELAY_POLICY: RelayPolicy = 'ask';

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-border-strong bg-bg-raised p-3">
      <h2 className="m-0 mb-2 text-ui font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

export function SetupCard({ appSessionId }: { appSessionId: AppSessionId }) {
  const card = useSetup((s) => s.cards.get(appSessionId) ?? null);
  const failure = useSetup((s) => failureOf(s, appSessionId));
  const busy = useSetup((s) => isStarting(s, appSessionId));

  if (card?.kind === 'trust')
    return (
      <Frame title={TRUST_CARD_TITLE}>
        <TrustCard
          trust={card.trust}
          busy={busy}
          onAccept={() => void continueSetup(appSessionId, { trust: 'accepted' }, card.message)}
          onStartWithoutTrusting={() => void continueSetup(appSessionId, { trust: 'declined' }, card.message)}
          onDecline={() => void releaseMessage(appSessionId, card.message)}
        />
      </Frame>
    );
  if (card?.kind === 'relay') return <RelayHost appSessionId={appSessionId} card={card} />;
  if (failure !== null) return <FailureHost appSessionId={appSessionId} failure={failure} busy={busy} />;
  return null;
}

function FailureHost({ appSessionId, failure, busy }: { appSessionId: AppSessionId; failure: SetupFailure; busy: boolean }) {
  const message = useSetup((s) => s.intents.get(appSessionId)?.message ?? null);
  const retainedWorktree = useSetup((s) => s.intents.get(appSessionId)?.progress.worktree?.createdHere === true);
  // what a resolution did to the checkout, shown in place of the rollback's account of it (for this failure only)
  // (by content: the intent a resolution answers is a new object carrying the same failure)
  const key = JSON.stringify(failure);
  const [resolved, setResolved] = useState<{ key: string; worktree: WorktreeResource } | null>(null);
  const shown = resolved?.key === key ? { ...failure, resources: { ...failure.resources, worktree: resolved.worktree } } : failure;
  const resolve = async (resolution: 'discard' | 'keep') => {
    const worktree = await resolveWorktree(appSessionId, resolution);
    if (worktree !== null) setResolved({ key, worktree });
  };
  return (
    <Frame title={FAILURE_CARD_TITLE}>
      <FailureCard
        failure={shown}
        busy={busy}
        retainedWorktree={retainedWorktree}
        onAccept={() => void continueSetup(appSessionId, {}, message)}
        onDecline={() => void releaseMessage(appSessionId, message)}
        onDiscard={() => void resolve('discard')}
        onKeep={() => void resolve('keep')}
      />
    </Frame>
  );
}

// The relay card polls the relay while it is docked and starts routed by itself once the relay answers.
function RelayHost({ appSessionId, card }: { appSessionId: AppSessionId; card: Extract<WaitingCard, { kind: 'relay' }> }) {
  const [health, setHealth] = useState(card.health);
  const [now, setNow] = useState(() => Date.now());
  const model = useSetup((s) => s.intents.get(appSessionId)?.model ?? null);
  const recordModel = useSessions((s) => s.records.get(appSessionId)?.model.requested ?? null);
  const gatewayModel = isGatewayModel(model ?? recordModel ?? '');

  useEffect(() => {
    let live = true;
    const check = async () => {
      const result = await ipc.invoke('engine.relayHealth', { force: true });
      if (!live) return;
      setNow(Date.now());
      if (!result.ok) return;
      setHealth(result.value);
      if (result.value.ok) {
        live = false;
        void continueSetup(appSessionId, { gateway: 'gateway' }, card.message);
      }
    };
    const timer = setInterval(() => void check(), RELAY_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [appSessionId, card]);

  const recheck = async () => {
    const result = await ipc.invoke('engine.relayHealth', { force: true });
    setNow(Date.now());
    if (!result.ok) return;
    setHealth(result.value);
    if (result.value.ok) void continueSetup(appSessionId, { gateway: 'gateway' }, card.message);
  };

  return (
    <Frame title={RELAY_CARD_TITLE}>
      <RelayCard
        health={health}
        policy={RELAY_POLICY}
        now={now}
        gatewayModel={gatewayModel}
        openClaudeUsage={null}
        onAccept={() => void continueSetup(appSessionId, { gateway: 'direct' }, card.message)}
        onDecline={() => void releaseMessage(appSessionId, card.message)}
        onRecheck={() => void recheck()}
      />
    </Frame>
  );
}
