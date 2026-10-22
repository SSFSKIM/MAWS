// A command's status line (the desk control surface spec, 2026-10-22, §3 and §6): its RPC on the way (`RpcStatus`),
// then *queued* — until the session is idle, mid-turn, since a command waits for the turn (H-queue) — then what ran,
// read back from its `op` end: the transcript's own line with how it was confirmed, *ran, unconfirmed* when nothing
// could be linked, and what outlives the session where the command saves something. A refusal (the bridge's, the
// machine's) says why and that nothing ran. A resolved promise is never drawn as success. Once the outcome is committed
// the readback is marked drawn for `latency.ts` (`op.readback`, §12): here, where it is drawn, and only for its nonce.
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { turnRunning } from '../../conversation/capabilities';
import { failureOf } from '../../conversation/outcome';
import { commandFailureText, commandOutcomeText } from '../../conversation/words';
import { latency } from '../../latency/latency';
import { sessionName } from '../../log/projection';
import type { DeskSession } from '../../shell/sessions';
import { RpcStatus } from '../conversation/RpcStatus';
import { useDesk } from '../conversation/desk-context';

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function CommandStatus({ nonce, session, outlives: advertised, className = '' }: { nonce: string | null; session: DeskSession; outlives?: string; className?: string }) {
  const { connection } = useDesk();
  const entry = useStore(connection.conversation.store, (s) => (nonce ? s.rpcs[nonce] : undefined));
  const op = useStore(connection.conversation.store, (s) => (nonce ? s.ops[nonce] : undefined));
  const outcomeDrawn = entry?.rpc.rpc === 'command' && entry.state === 'done' && op?.phase === 'end';
  useEffect(() => {
    if (outcomeDrawn && nonce) latency.commandDrawn(nonce);
  }, [outcomeDrawn, nonce]);
  if (!entry || entry.rpc.rpc !== 'command') return null;
  const { name } = entry.rpc.args as { name: string };
  const machine = entry.rpc.machine;
  const base = `text-ui-sm ${className}`;
  if (entry.state === 'failed') {
    return (
      <span className={`${base} text-danger`} role="alert" data-testid="command-status" data-command-state="refused">
        /{name}: {commandFailureText(failureOf(entry.outcome)!, machine)}
      </span>
    );
  }
  if (entry.state !== 'done') return <RpcStatus nonce={nonce} className={className} />;
  if (op?.phase !== 'end') {
    return (
      <span className={`${base} text-fg-muted`} role="status" data-testid="command-status" data-command-state="queued">
        {[turnRunning(session) ? `Queued until ${sessionName(session)} is idle` : 'Queued', advertised].filter(Boolean).join(' · ')}
      </span>
    );
  }
  const result = entry.outcome?.state === 'done' ? entry.outcome.result as { route?: string } : null;
  const outcome = commandOutcomeText({ ...op.body, route: op.body.route ?? result?.route ?? 'run' });
  const outlives = outcome.state === 'failed' ? null : advertised;
  return (
    <span className={`${base} ${outcome.state === 'failed' ? 'text-danger' : outcome.state === 'unconfirmed' ? 'text-warning' : 'text-fg-muted'}`} role="status" data-testid="command-status" data-command-state={outcome.state}>
      {[outcome.state === 'ran' && outcome.mark && !outcome.text.startsWith('ran') ? 'Ran' : null, cap(outcome.text), outcome.mark, outlives].filter(Boolean).join(' · ')}
    </span>
  );
}
