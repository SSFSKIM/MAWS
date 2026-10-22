// A command's status line (the desk control surface spec, 2026-10-22, §3 and §6): its RPC on the way (`RpcStatus`),
// then *queued* — until the session is idle, mid-turn, since a command waits for the turn (H-queue) — then what ran,
// read back from its `op` end: the transcript's own line with how it was confirmed, *ran, unconfirmed* when nothing
// could be linked, and what outlives the session where the command saves something. A refusal (the bridge's, the
// machine's) says why and that nothing ran. A resolved promise is never drawn as success.
import { useStore } from 'zustand';
import { turnRunning } from '../../conversation/capabilities';
import { failureOf } from '../../conversation/outcome';
import { commandFailureText, commandOutcomeText, commandOutlives } from '../../conversation/words';
import { sessionName } from '../../log/projection';
import type { DeskSession } from '../../shell/sessions';
import { RpcStatus } from '../conversation/RpcStatus';
import { useDesk } from '../conversation/desk-context';

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function CommandStatus({ nonce, session, className = '' }: { nonce: string | null; session: DeskSession; className?: string }) {
  const { connection } = useDesk();
  const entry = useStore(connection.conversation.store, (s) => (nonce ? s.rpcs[nonce] : undefined));
  const op = useStore(connection.conversation.store, (s) => (nonce ? s.ops[nonce] : undefined));
  if (!entry || entry.rpc.rpc !== 'command') return null;
  const { name, args = '' } = entry.rpc.args as { name: string; args?: string };
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
        {turnRunning(session) ? `Queued until ${sessionName(session)} is idle` : 'Queued'}
      </span>
    );
  }
  const outcome = commandOutcomeText(op.body);
  const outlives = outcome.state === 'failed' ? null : commandOutlives(name, args, machine);
  return (
    <span className={`${base} ${outcome.state === 'failed' ? 'text-danger' : outcome.state === 'unconfirmed' ? 'text-warning' : 'text-fg-muted'}`} role="status" data-testid="command-status" data-command-state={outcome.state}>
      {[cap(outcome.text), outcome.mark, outlives].filter(Boolean).join(' · ')}
    </span>
  );
}
