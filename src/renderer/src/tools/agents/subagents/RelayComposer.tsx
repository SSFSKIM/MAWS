// The drill-in's relay composer (C8b execution document, Interfaces *The relay*; owner ruling 1 as the review read it;
// O1, O3). No host path reaches a child, so the box asks the parent, by one `'next'` steer, to `SendMessage` it. The
// regime is the agent's background flag, never the parent's turn: enabled for a running background child of a live
// parent (an idle parent starts the forwarding turn, a busy one folds the steer in at its next tool boundary), disabled
// with the reason as its placeholder otherwise. The line above the box walks the observables: asked, forwarded (where
// it rests on 2.1.283), and gone on a receipt. A plain textarea mirroring C7's composer: its own focus, keys and send.
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { useKeyChord } from '../../../keymap/useKeyChord';
import { RELAY_COPY } from '../copy';
import { formatElapsed } from '../model/elapsed';
import { isPending, RELAY_LONG_WAIT_MS, restoreDraft, type Relay } from '../model/relay';
import { isEnded, rowTitle, type TaskNode } from '../model/task-graph';
import { relayKey, useRelays } from '../relay-store';
import { useTicker } from './shared';

export interface DisabledReason {
  text: string;
  tooltip: string | null;
}

// Why the box is disabled, or null when a relay can go: what the graph knows of the agent first (known only from disk,
// ended), then the parent (not live here), a relay still pending, and the background flag (a foreground child's parent
// reads messages only after it returns; unknown when no start event was seen this launch).
export function relayDisabledReason({ node, status, relay, session }: { node: TaskNode | undefined; status: EngineSessionStatus | null; relay: Relay | undefined; session: string }): DisabledReason | null {
  const reason = (text: string, tooltip: string | null = null) => ({ text, tooltip });
  const { disabled } = RELAY_COPY;
  if (node?.status === 'unknown') return reason(disabled.diskOnly);
  if (node && isEnded(node.status)) return reason(node.status === 'stopped' ? disabled.stopped : node.status === 'exited' ? disabled.exited : disabled.finished);
  if (status === null) return reason(disabled.notRunningHere);
  if (relay && isPending(relay.state)) return reason(disabled.pending);
  if (node?.isBackground === false) return reason(disabled.foreground(session), disabled.foregroundTooltip);
  if (node?.isBackground !== true) return reason(disabled.backgroundUnknown(session));
  return null;
}

// The pending line: asked (the elapsed wait, the parent's turn clause, the long wait, or the agent ending first), then
// forwarded with the parent rounds, or why it failed. Delivered is cleared, never shown.
export function relayLine(relay: Relay | undefined, now: number, session: string, title: string): string | null {
  const state = relay?.state;
  if (!state) return null;
  switch (state.kind) {
    case 'asked': {
      if (state.childEndedAt !== null) return RELAY_COPY.childEnded(title, session);
      const waited = now - Date.parse(state.sentAt);
      const elapsed = formatElapsed(waited);
      if (!state.parentTurnOpenAtSend) return RELAY_COPY.asked(session, elapsed);
      return waited >= RELAY_LONG_WAIT_MS ? RELAY_COPY.askedLongWait(session, elapsed) : RELAY_COPY.askedTurnOpen(session, elapsed);
    }
    case 'forwarded':
      return RELAY_COPY.forwarded(session, state.parentRounds, title);
    case 'failed':
      return RELAY_COPY.failed(state.message);
    case 'delivered':
      return null;
  }
}

interface Props {
  appSessionId: AppSessionId;
  agentId: AgentId;
  node: TaskNode | undefined;
  status: EngineSessionStatus | null;
  sessionTitle: string;
  draft: string; // the tool state's, so it survives the host's unmount
  onDraft(draft: string): void;
}

export function RelayComposer({ appSessionId, agentId, node, status, sessionTitle, draft, onDraft }: Props) {
  const key = relayKey(appSessionId, agentId);
  const relay = useRelays((s) => s.relays.get(key));
  const [sending, setSending] = useState(false); // the steer is out and unanswered
  const title = node ? rowTitle(node) : agentId;
  const reason = relayDisabledReason({ node, status, relay, session: sessionTitle });
  const disabled = reason !== null || sending;
  const canSend = !disabled && draft.trim() !== '';
  const now = useTicker(relay?.state.kind === 'asked' && relay.state.childEndedAt === null);
  const line = relayLine(relay, now, sessionTitle, title);

  // O1: a relay the engine dropped puts its text back when the box is empty; a delivered one is cleared at once.
  const restore = useEffectEvent((failed: Relay) => {
    const next = restoreDraft(draft, failed);
    if (next !== draft) onDraft(next);
  });
  useEffect(() => {
    if (relay?.state.kind === 'failed') restore(relay);
    if (relay?.state.kind === 'delivered') useRelays.getState().dismiss(key);
  }, [relay, key]);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await useRelays.getState().send(appSessionId, { agentId, name: node?.agent?.name ?? null }, draft.trim(), (status?.turn ?? null) !== null);
    } finally {
      setSending(false);
    }
    if (useRelays.getState().relays.get(key)?.state.kind !== 'failed') onDraft(''); // a refused steer keeps the draft
  };

  const edit = (next: string) => {
    onDraft(next);
    if (relay && !isPending(relay.state)) useRelays.getState().dismiss(key); // a failure shows until the next edit
  };

  // ⌘↵ sends and ⌥↵ (a steer, which every relay is) does too; plain Enter breaks the line. The sink keeps the pane's
  // Enter and Esc (a docked card's answers) from firing here.
  const root = useRef<HTMLDivElement>(null);
  useKeyChord('composer.send', () => void send(), { within: root });
  useKeyChord('composer.steer', () => void send(), { within: root });
  const id = useId();

  return (
    <div ref={root} data-key-sink="composer" className="shrink-0 border-t border-border">
      {line !== null && (
        <p data-part="relay-line" role="status" className={`px-4 pt-2.5 text-ui-sm ${relay?.state.kind === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
          {line}
        </p>
      )}
      <div className="m-3 flex flex-col gap-1.5 rounded-md border border-border-strong p-2.5">
        <label htmlFor={id} className="text-ui-sm text-fg-muted">
          {RELAY_COPY.label(sessionTitle)}
        </label>
        <textarea
          id={id}
          rows={2}
          value={draft}
          disabled={disabled}
          placeholder={reason?.text ?? RELAY_COPY.placeholder(title)}
          title={reason?.tooltip ?? undefined}
          onChange={(e) => edit(e.target.value)}
          className="block w-full resize-none bg-transparent text-ui text-fg outline-accent placeholder:text-fg-muted focus-visible:outline-2 disabled:cursor-not-allowed"
        />
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void send()}
            className="rounded-sm border border-border-strong bg-bg-active px-2.5 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-bg-active"
          >
            {RELAY_COPY.send}
          </button>
        </div>
      </div>
    </div>
  );
}
