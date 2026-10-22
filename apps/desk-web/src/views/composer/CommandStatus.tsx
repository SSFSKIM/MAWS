// Draw only a nonce the composer owns, but do not require its original in-memory RPC: a fresh home-screen page
// recovers the real outcome from the hub's op replay. A visible terminal result acknowledges this browser's pending
// receipt; the mounted composer keeps its displayed line until closed, without making future views a history dump.
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { turnRunning } from '../../conversation/capabilities';
import { failureOf } from '../../conversation/outcome';
import { commandFailureText, commandOutcomeText } from '../../conversation/words';
import { latency } from '../../latency/latency';
import { sessionName } from '../../log/projection';
import { pendingCommands } from '../../state/pending-commands';
import type { DeskSession } from '../../shell/sessions';
import { RpcStatus } from '../conversation/RpcStatus';
import { useDesk } from '../conversation/desk-context';

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function CommandStatus({ nonce, session, outlives: advertised, className = '' }: { nonce: string | null; session: DeskSession; outlives?: string; className?: string }) {
  const { connection } = useDesk();
  const entry = useStore(connection.conversation.store, (s) => (nonce ? s.rpcs[nonce] : undefined));
  const op = useStore(connection.conversation.store, (s) => (nonce ? s.ops[nonce] : undefined));
  const ended = op?.op === 'command' && op.session === session.session && op.phase === 'end';
  const element = useRef<HTMLSpanElement>(null);
  const terminal = ended || entry?.state === 'failed' || entry?.state === 'not-connected';
  useEffect(() => {
    if (ended && nonce) latency.commandDrawn(nonce);
  }, [ended, nonce]);
  useEffect(() => {
    if (!terminal || !nonce || !element.current) return;
    let frame = 0;
    let inView = false;
    const shown = () => {
      if (!inView || document.visibilityState !== 'visible') return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (inView && document.visibilityState === 'visible') pendingCommands.seen(connection.project, nonce);
      });
    };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; shown(); });
    observer.observe(element.current);
    document.addEventListener('visibilitychange', shown);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', shown); };
  }, [terminal, nonce, connection.project]);
  if (!nonce || (entry && entry.rpc.rpc !== 'command')) return null;
  const base = `text-ui-sm ${className}`;
  if (ended) {
    const result = entry?.outcome?.state === 'done' ? entry.outcome.result as { route?: string } : null;
    const outcome = commandOutcomeText({ ...op.body, route: op.body.route ?? result?.route ?? 'run' });
    const outlives = outcome.state === 'failed' ? null : advertised;
    return (
      <span ref={element} className={`${base} ${outcome.state === 'failed' ? 'text-danger' : outcome.state === 'unconfirmed' ? 'text-warning' : 'text-fg-muted'}`} role="status" data-testid="command-status" data-command-state={outcome.state}>
        {[outcome.state === 'ran' && outcome.mark && !outcome.text.startsWith('ran') ? 'Ran' : null, cap(outcome.text), outcome.mark, outlives].filter(Boolean).join(' · ')}
      </span>
    );
  }
  if (entry?.state === 'failed') {
    const { name } = entry.rpc.args as { name: string };
    return (
      <span ref={element} className={`${base} text-danger`} role="alert" data-testid="command-status" data-command-state="refused">
        /{name}: {commandFailureText(failureOf(entry.outcome)!, entry.rpc.machine)}
      </span>
    );
  }
  if (entry && entry.state !== 'done') return <RpcStatus nonce={nonce} className={className} />;
  const queued = !!entry || op?.phase === 'start';
  return (
    <span ref={element} className={`${base} text-fg-muted`} role="status" data-testid="command-status" data-command-state={queued ? 'queued' : 'checking'}>
      {[queued ? turnRunning(session) ? `Queued until ${sessionName(session)} is idle` : 'Queued' : 'Checking command outcome…', advertised].filter(Boolean).join(' · ')}
    </span>
  );
}
