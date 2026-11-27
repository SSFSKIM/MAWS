// The drill-in's relay composer (C8b execution document, Interfaces *The relay*; owner ruling 1 as the review read it;
// O1, O3). No host path reaches a child, so the box asks the parent, by one `'next'` steer, to `SendMessage` it. The
// regime is the agent's background flag, never the parent's turn: enabled for a running background child of a live
// parent (an idle parent starts the forwarding turn, a busy one folds the steer in at its next tool boundary), disabled
// with the reason as its placeholder otherwise. The line above the box walks the observables: asked, forwarded (where
// it rests on 2.1.283), and gone on a receipt. A plain textarea mirroring C7's composer: its own focus, keys and send.
// The word cut (T190, T191, T193, T199 to T201, T203): the box's label is for screen readers only (the engine relay's
// placeholder names the session it goes through), Send is the main message box's round arrow with its word hidden and
// as its tooltip, and the line says what happened and how long it has waited, not how the engine forwards it.
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { useKeyChord } from '../../../keymap/useKeyChord';
import { useSessionControls } from '../../../session/controls/controls-for'; // P5 O9 M5
import type { SessionControls } from '../../../session/controls/types'; // P5 O9 M5
import { GLYPHS } from '../../../composer/submit/glyphs';
import { useChordHint } from '../../../app/IconButton';
import { Tip } from '../../../ui/tip';
import { RELAY_COPY } from '../copy';
import { formatElapsed } from '../model/elapsed';
import { isPending, restoreDraft, type Relay } from '../model/relay';
import { isEnded, rowTitle, type TaskNode } from '../model/task-graph';
import { relayKey, useRelays } from '../relay-store';
import { endedUnrecorded, useTicker } from './shared';

export interface DisabledReason {
  text: string;
  tooltip: string | null;
}

// Why the box is disabled, or null when a relay can go: what the graph knows of the agent first (known only from disk,
// ended), then the parent (not live here), a relay still pending, and the background flag (a foreground child's parent
// reads messages only after it returns; unknown when no start event was seen this launch). Only an `asked` relay blocks
// (controller, M2 review): a `forwarded` one rests there for the child's whole run on 2.1.283, and a send replaces it.
// Why an ended agent takes no relay, in the words its row reads (card C1: `endedUnrecorded`, the row's own rule).
function endedReason(node: TaskNode): string {
  const { disabled } = RELAY_COPY;
  if (node.status === 'stopped') return disabled.stopped;
  if (node.status === 'exited') return endedUnrecorded(node) ? disabled.ended : disabled.exited;
  return disabled.finished;
}

export function relayDisabledReason({ node, status, relay, session }: { node: TaskNode | undefined; status: EngineSessionStatus | null; relay: Relay | undefined; session: string }): DisabledReason | null {
  const reason = (text: string, tooltip: string | null = null) => ({ text, tooltip });
  const { disabled } = RELAY_COPY;
  if (node?.status === 'unknown') return reason(disabled.diskOnly);
  if (node && isEnded(node.status)) return reason(endedReason(node));
  if (status === null) return reason(disabled.notRunningHere);
  if (relay?.state.kind === 'asked') return reason(disabled.pending);
  if (node?.isBackground === false) return reason(disabled.foreground(session), disabled.foregroundTooltip);
  if (node?.isBackground !== true) return reason(disabled.backgroundUnknown(session));
  return null;
}

// The pending line: asked (the elapsed wait, or the agent ending first), then forwarded, or why it failed. Delivered is
// cleared, never shown.
export function relayLine(relay: Relay | undefined, now: number, session: string, title: string): string | null {
  const state = relay?.state;
  if (!state) return null;
  switch (state.kind) {
    case 'asked':
      return state.childEndedAt !== null ? RELAY_COPY.childEnded(title) : RELAY_COPY.asked(session, formatElapsed(now - Date.parse(state.sentAt)));
    case 'forwarded':
      return RELAY_COPY.forwarded(title);
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
  visible: boolean; // ctx.visible: the pending line's elapsed does not tick while the panel is collapsed
  draft: string; // the tool state's, so it survives the host's unmount
  onDraft(draft: string): void;
  onSent(): void; // clears the draft if it is still this agent's (the owner may have moved on while the steer was out)
}

export function RelayComposer(props: Props) {
  const controls = useSessionControls(props.appSessionId); // P5 O9 M5: a session driven through its bridge tells the agent itself
  // The direct tell: a session on this Mac whose engine took the built-in mod tells it too (lane B, which has no turn of
  // its own); without the mod, in plan mode and on another machine its `tell` is closed and the parent relays
  const direct = controls !== null && controls.turn() === null && controls.capability('tell').available;
  return controls && (controls.turn() !== null || direct) ? <TellComposer {...props} controls={controls} resumesFinished={direct} /> : <EngineRelayComposer {...props} />;
}

// P5 O9 M5 start: the bridge's `tell` reaches the agent itself, so no parent relays it: the box is open while the agent
// has not ended and the session's `tell` control is, and the line says what the bridge answered. The direct tell
// (`resumesFinished`): the engine's own send resumes a finished agent with the message (uxwave-tell-builtin-ended), so
// only a stopped one, or one that ended with its session, stays closed.
function TellComposer({ agentId, node, draft, onDraft, onSent, controls, resumesFinished }: Props & { controls: SessionControls; resumesFinished: boolean }) {
  const [sending, setSending] = useState(false);
  const [line, setLine] = useState<{ text: string; failed: boolean } | null>(null);
  const title = node ? rowTitle(node) : agentId;
  const tell = controls.capability('tell');
  const finished = resumesFinished && (node?.status === 'completed' || node?.status === 'failed');
  const reason = node && isEnded(node.status) && !finished ? endedReason(node) : tell.available ? null : tell.reason;
  const canSend = reason === null && !sending && draft.trim() !== '';
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    const result = await controls.tell(agentId, draft.trim());
    setSending(false);
    if (result.state === 'refused') return setLine({ text: RELAY_COPY.driven.failed(result.message), failed: true }); // the draft stays
    setLine({ text: result.state === 'done' ? (finished ? RELAY_COPY.driven.resumes(title) : RELAY_COPY.driven.told) : RELAY_COPY.driven.unknown, failed: false });
    onSent();
  };
  const root = useRef<HTMLDivElement>(null);
  useKeyChord('composer.send', () => void send(), { within: root });
  const id = useId();
  return (
    <div ref={root} data-key-sink="composer" className="shrink-0 border-t border-border">
      {line !== null && (
        <p data-part="relay-line" role="status" className={`px-4 pt-2.5 text-ui-sm ${line.failed ? 'text-danger' : 'text-fg-muted'}`}>
          {line.text}
        </p>
      )}
      <div className="m-3 flex flex-col gap-1.5 rounded-md border border-border-strong p-2.5">
        <label htmlFor={id} className="sr-only">
          {RELAY_COPY.driven.label(title)}
        </label>
        <textarea
          id={id}
          rows={2}
          value={draft}
          disabled={reason !== null || sending /* an edit made while a tell is out would be cleared with its answer */}
          placeholder={reason ?? RELAY_COPY.placeholder(title)}
          onChange={(e) => {
            onDraft(e.target.value);
            setLine(null);
          }}
          className="block w-full resize-none bg-transparent text-ui text-fg outline-accent placeholder:text-fg-muted focus-visible:outline-2 disabled:cursor-not-allowed"
        />
        {reason !== null && draft !== '' && (
          <p data-part="relay-reason" className="text-ui-sm text-fg-muted">
            {reason}
          </p>
        )}
        <div className="flex justify-end">
          <SendGlyph disabled={!canSend} onSend={() => void send()} />
        </div>
      </div>
    </div>
  );
}
// P5 O9 M5 end

function EngineRelayComposer({ appSessionId, agentId, node, status, sessionTitle, visible, draft, onDraft, onSent }: Props) {
  const key = relayKey(appSessionId, agentId);
  const relay = useRelays((s) => s.relays.get(key));
  const [sending, setSending] = useState(false); // the steer is out and unanswered
  const title = node ? rowTitle(node) : agentId;
  const reason = relayDisabledReason({ node, status, relay, session: sessionTitle });
  const disabled = reason !== null || sending;
  const canSend = !disabled && draft.trim() !== '';
  const now = useTicker(visible && relay?.state.kind === 'asked' && relay.state.childEndedAt === null);
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
    if (useRelays.getState().relays.get(key)?.state.kind !== 'failed') onSent(); // a refused steer keeps the draft
  };

  const edit = (next: string) => {
    onDraft(next);
    if (relay && !isPending(relay.state)) useRelays.getState().dismiss(key); // a failure shows until the next edit
  };

  // ⌘↵ sends; plain Enter breaks the line. The sink keeps the pane's Enter and Esc (a docked card's answers) from firing
  // here.
  const root = useRef<HTMLDivElement>(null);
  useKeyChord('composer.send', () => void send(), { within: root });
  const id = useId();

  return (
    <div ref={root} data-key-sink="composer" className="shrink-0 border-t border-border">
      {line !== null && (
        <p data-part="relay-line" role="status" className={`px-4 pt-2.5 text-ui-sm ${relay?.state.kind === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
          {line}
        </p>
      )}
      <div className="m-3 flex flex-col gap-1.5 rounded-md border border-border-strong p-2.5">
        <label htmlFor={id} className="sr-only">
          {RELAY_COPY.label(sessionTitle)}
        </label>
        {/* Board ticket 815: a reason that says more (a foreground child's) is the box's tip and description, so the box
            keeps Tab for it: greyed, it is read-only rather than disabled, its own edits guarded */}
        <Tip content={reason?.tooltip} description={reason?.tooltip}>
          <textarea
            id={id}
            rows={2}
            value={draft}
            disabled={disabled && !reason?.tooltip}
            readOnly={disabled}
            aria-disabled={disabled || undefined}
            placeholder={reason?.text ?? RELAY_COPY.placeholderVia(title, sessionTitle)}
            onChange={(e) => edit(e.target.value)}
            className="block w-full resize-none bg-transparent text-ui text-fg outline-accent placeholder:text-fg-muted focus-visible:outline-2 aria-disabled:cursor-not-allowed"
          />
        </Tip>
        {/* a kept draft hides the placeholder, so the reason the box is closed shows as a line of its own */}
        {reason !== null && draft !== '' && (
          <p data-part="relay-reason" className="text-ui-sm text-fg-muted">
            {reason.text}
          </p>
        )}
        <div className="flex justify-end">
          <SendGlyph disabled={!canSend} onSend={() => void send()} />
        </div>
      </div>
    </div>
  );
}

// The main message box's Send (composer/submit/SubmitControl.tsx): the round accent button with the up arrow, its word
// kept as hidden text (its name) and as its tooltip with the chord, which pointing or focus opens while it can send.
function SendGlyph({ disabled, onSend }: { disabled: boolean; onSend: () => void }) {
  const chord = useChordHint('composer.send');
  const Arrow = GLYPHS.arrow;
  return (
    <Tip content={chord ? `${RELAY_COPY.send} · ${chord}` : RELAY_COPY.send}>
      <button
        type="button"
        disabled={disabled}
        onClick={onSend}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-bg outline-accent hover:opacity-90 focus-visible:outline-2 disabled:bg-bg-hover disabled:text-fg-faint"
      >
        <Arrow />
        <span className="sr-only">{RELAY_COPY.send}</span>
      </button>
    </Tip>
  );
}
