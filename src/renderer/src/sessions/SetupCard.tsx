// The setup cards in the composer's place (C10 execution document, "The unstarted session"; M3's carried rule: a
// continuation that is refused hands the docked message back; D-20: the cards sit where a permission card sits). The
// trust and relay cards wait on a start's answer, the failure card on a failed setup. Each is docked through C7's
// `dockCard` and renders inside C7's `DockedCardFrame`, which owns the frame, the focus, Enter (`onAccept`) and Esc
// (`onDecline`); `connectSetupDock` keeps one docked card per session in step with the setup store, for an unstarted
// tab and a record's resume alike (C7's composer shows a session's docked card whether or not it has started).
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { isGatewayModel } from '@shared/sessions/models';
import { DockedCardFrame } from '../composer/docked/DockedCardFrame';
import { dockCard } from '../composer/docked/registry';
// C11 start: the card's policy, its hand-off and Run direct on a gateway model (C11's Asks of C10 (2) and (7))
import { runDirect, useOpenClaudeUsage, usePickingDirectModel, useRelayPolicy } from '../gateway/relay-card';
// C11 end
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { FAILURE_CARD_TITLE, FailureCard } from './FailureCard';
import { RELAY_CARD_TITLE, RelayCard } from './RelayCard';
import { continueSetup, reclaimMessage, releaseMessage, resolveWorktree, type WorktreeResource } from './setup-actions';
import { failureOf, isStarting, UNSENT, useSetup, type SetupFailure, type SetupState, type WaitingCard } from './store';
import { TRUST_CARD_TITLE, TrustCard } from './TrustCard';

export const RELAY_POLL_MS = 5_000;

export type SetupCardKind = WaitingCard['kind'] | 'failure';

// The card a session's composer shows, if any: the card a start waits on, else a failure its intent retains.
export function setupCardOf(s: SetupState, appSessionId: AppSessionId): SetupCardKind | null {
  const card = s.cards.get(appSessionId);
  if (card) return card.kind;
  return failureOf(s, appSessionId) === null ? null : 'failure';
}

// Docks, swaps and undocks each session's setup card as the store changes (one card per session, `c10:<kind>`).
export function connectSetupDock(store: typeof useSetup = useSetup): () => void {
  const docked = new Map<AppSessionId, { kind: SetupCardKind; undock(): void }>();
  const sync = (s: SetupState) => {
    for (const [id, held] of docked) {
      if (setupCardOf(s, id) === held.kind) continue;
      held.undock();
      docked.delete(id);
    }
    for (const id of new Set([...s.cards.keys(), ...s.intents.keys()])) {
      const kind = setupCardOf(s, id);
      if (kind === null || docked.has(id)) continue;
      docked.set(id, { kind, undock: dockCard(id, { id: `c10:${kind}`, render: () => <SetupCard appSessionId={id} /> }) });
    }
  };
  sync(store.getState());
  const off = store.subscribe(sync);
  return () => {
    off();
    docked.forEach((held) => held.undock());
    docked.clear();
  };
}

export function SetupCard({ appSessionId }: { appSessionId: AppSessionId }) {
  const card = useSetup((s) => s.cards.get(appSessionId) ?? null);
  const failure = useSetup((s) => failureOf(s, appSessionId));
  const busy = useSetup((s) => isStarting(s, appSessionId));

  if (card?.kind === 'trust') {
    const accept = () => void continueSetup(appSessionId, { trust: 'accepted' }, card.message);
    const decline = () => void releaseMessage(appSessionId, card.message);
    return (
      <DockedCardFrame appSessionId={appSessionId} title={TRUST_CARD_TITLE} onAccept={busy ? null : accept} onDecline={busy ? null : decline}>
        <TrustCard trust={card.trust} busy={busy} onAccept={accept} onStartWithoutTrusting={() => void continueSetup(appSessionId, { trust: 'declined' }, card.message)} onDecline={decline} />
      </DockedCardFrame>
    );
  }
  if (card?.kind === 'relay') return <RelayHost appSessionId={appSessionId} card={card} busy={busy} />;
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
  const retry = () => void continueSetup(appSessionId, {}, message);
  // After a reload the card cannot tell whether main still runs the start (and is sending the message): it asks main to
  // hand the message back first and returns it only then. Any other failure's message is main's to release.
  const back = () => void (failure === UNSENT ? reclaimMessage(appSessionId, message) : releaseMessage(appSessionId, message));
  return (
    <DockedCardFrame appSessionId={appSessionId} title={FAILURE_CARD_TITLE} onAccept={busy ? null : retry} onDecline={busy ? null : back}>
      <FailureCard failure={shown} busy={busy} retainedWorktree={retainedWorktree} onAccept={retry} onDecline={back} onDiscard={() => void resolve('discard')} onKeep={() => void resolve('keep')} />
    </DockedCardFrame>
  );
}

// The relay card polls the relay while it is docked and starts routed by itself once the relay answers.
function RelayHost({ appSessionId, card, busy }: { appSessionId: AppSessionId; card: Extract<WaitingCard, { kind: 'relay' }>; busy: boolean }) {
  const [health, setHealth] = useState(card.health);
  const [now, setNow] = useState(() => Date.now());
  const model = useSetup((s) => s.intents.get(appSessionId)?.model ?? null);
  const recordModel = useSessions((s) => s.records.get(appSessionId)?.model.requested ?? null);
  const gatewayModel = isGatewayModel(model ?? recordModel ?? '');
  // C11 start: settings v3's relayUnreachable (wait → 'wait'; ask and direct → 'ask'), and C11's hand-off action
  const policy = useRelayPolicy();
  const openClaudeUsage = useOpenClaudeUsage();
  const picking = usePickingDirectModel(appSessionId); // Run direct's Claude-model pick is open: the poll pauses
  // C11 end

  useEffect(() => {
    if (picking) return; // C11: no routed start under an open Claude-model pick
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
  }, [appSessionId, card, picking /* C11 */]);

  const recheck = async () => {
    const result = await ipc.invoke('engine.relayHealth', { force: true });
    setNow(Date.now());
    if (!result.ok) return;
    setHealth(result.value);
    if (result.value.ok) void continueSetup(appSessionId, { gateway: 'gateway' }, card.message);
  };
  const direct = () => void runDirect(appSessionId, card.message, gatewayModel); // C11: a gateway model takes a Claude model first (pickDirectModel)
  const decline = () => void releaseMessage(appSessionId, card.message);
  // C11 start: Enter runs Run direct on a gateway model too (C10 refused it there, `busy || gatewayModel`): it asks for a
  // Claude model first
  const accept = busy ? null : direct;
  // C11 end

  return (
    <DockedCardFrame appSessionId={appSessionId} title={RELAY_CARD_TITLE} onAccept={accept} onDecline={busy ? null : decline}>
      {/* C11: gatewayModel={false}: with pickDirectModel in place a gateway model no longer blocks Run direct, it asks for a Claude model first */}
      <RelayCard health={health} policy={policy} now={now} gatewayModel={false} openClaudeUsage={openClaudeUsage} onAccept={direct} onDecline={decline} onRecheck={() => void recheck()} />
    </DockedCardFrame>
  );
}
