// An RPC's state as the hub reports it (DX6): sent, forwarded, done with its result in words, failed with its reason,
// or `uncertain` — the machine's lease lapsed after the hub forwarded it, so it may or may not have happened — with a
// Retry that sends the same sealed RPC again, nonce and all, which the machine answers from its ledger if it ran — or
// refused in the browser because the project socket was down, nothing sent.
import { useStore } from 'zustand';
import { failureOf, resultOf } from '../../conversation/outcome';
import { failureText, resultText } from '../../conversation/words';
import { useDesk } from './desk-context';

export function RpcStatus({ nonce, className = '' }: { nonce: string | null; className?: string }) {
  const { connection } = useDesk();
  const entry = useStore(connection.conversation.store, (s) => (nonce ? s.rpcs[nonce] : undefined));
  if (!entry) return null;
  const machine = entry.rpc.machine;
  const base = `text-ui-sm ${className}`;
  switch (entry.state) {
    case 'sending':
      return (
        <span className={`${base} text-fg-muted`} role="status" data-rpc-state="sending">
          Sending to {machine}…
        </span>
      );
    case 'forwarded':
      return (
        <span className={`${base} text-fg-muted`} role="status" data-rpc-state="forwarded">
          Sent to {machine}; waiting for its answer…
        </span>
      );
    case 'uncertain':
      return (
        <span className={`${base} text-warning`} role="status" data-rpc-state="uncertain">
          {machine} dropped before answering: it may or may not have happened.{' '}
          <button type="button" className="underline hover:text-fg" onClick={() => connection.retryRpc(entry.nonce)}>
            Retry
          </button>
        </span>
      );
    case 'not-connected':
      return (
        <span className={`${base} text-danger`} role="alert" data-rpc-state="not-connected">
          Not connected to the hub: nothing was sent
        </span>
      );
    case 'failed':
      return (
        <span className={`${base} text-danger`} role="alert" data-rpc-state="failed">
          {failureText(failureOf(entry.outcome)!, machine)}
        </span>
      );
    case 'done': {
      const { text, warning } = resultText(entry.rpc.rpc, resultOf(entry.outcome) ?? {});
      return (
        <span className={`${base} ${warning ? 'text-warning' : 'text-fg-muted'}`} role="status" data-rpc-state="done">
          {text.charAt(0).toUpperCase() + text.slice(1)}
        </span>
      );
    }
  }
}
