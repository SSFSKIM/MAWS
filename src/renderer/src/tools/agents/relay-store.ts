// The relay store (C8b execution document, Interfaces *The relay*): the pending relays per `appSessionId:agentId`, one
// per agent, in memory only (a reload loses the line and keeps the transcript rows, which are the record). `send` steers
// the parent once with `priority: 'next'` through the agent-work client; the relay then moves through the observables
// by watching that session's batches, the same wire input as the task graph, subscribed only while a relay of the
// session is in flight or pending: `asked` → `forwarded` on the parent's SendMessage → `delivered` on a receipt, with
// the O1 edges (the engine dropping the steer before starting it; the parent's exit) and the ended-child rules.
import { create } from 'zustand';
import { sendContentRefusal } from '@shared/engine/session-state-store';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { agentWorkClient } from './client';
import { RELAY_COPY } from './copy';
import { isPending, matchesReceipt, matchesSendMessage, parentRoundsBetween, relayText, type Relay } from './model/relay';

export interface RelayStore {
  relays: Map<string, Relay>; // key `appSessionId:agentId`; one pending relay per agent (the composer is disabled while one is pending)
  send(appSessionId: AppSessionId, agent: { agentId: AgentId; name: string | null }, text: string, parentTurnOpen: boolean): Promise<void>;
  dismiss(key: string): void;
}

export const relayKey = (appSessionId: AppSessionId, agentId: AgentId) => `${appSessionId}:${agentId}`;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const DROPPED = new Set(['cancelled', 'discarded', 'refused']);

// When a frame says the agent's task ended (the relay's agent is its task).
function endedAt(e: SessionEvent, agentId: AgentId): string | null {
  if ((e.kind === 'subagent.finished' || e.kind === 'task.notification') && (e.taskId as string) === agentId) return e.at;
  if (e.kind === 'task.updated' && (e.taskId as string) === agentId && ['completed', 'failed', 'killed', 'stopped'].includes(e.patch.status ?? '')) return e.at;
  return null;
}

// Per session, while a relay of it is in flight or pending: the one batch subscription, the last parent seq seen (a new
// relay's `sentSeq`), the parent's tool_use rounds (kept only while a relay is asked, to count its rounds), and what
// arrived while a steer was unanswered (replayed onto the relay once the uuid is known).
interface SessionWatch {
  off: () => void;
  lastSeq: number | null;
  rounds: SessionEvent[];
  inFlight: number;
  buffered: SessionEvent[];
}

export function createRelayStore() {
  const watches = new Map<AppSessionId, SessionWatch>();
  const started = new Set<string>(); // steer uuids the engine reported started: a later cancellation is not a drop
  const inFlight = new Set<string>(); // relay keys whose steer is unanswered

  return create<RelayStore>()((set, get) => {
    const put = (key: string, relay: Relay | null) => {
      const relays = new Map(get().relays);
      if (relay) relays.set(key, relay);
      else relays.delete(key);
      set({ relays });
    };
    const ofSession = (id: AppSessionId) => [...get().relays].filter(([, r]) => r.appSessionId === id);

    // Drops what no relay of the session needs any more, and the subscription once none is in flight or pending.
    const tidy = (id: AppSessionId) => {
      const w = watches.get(id);
      if (!w) return;
      const relays = ofSession(id).map(([, r]) => r);
      if (w.inFlight === 0) w.buffered = [];
      if (w.inFlight === 0 && !relays.some((r) => r.state.kind === 'asked')) w.rounds = [];
      if (w.inFlight > 0 || relays.some((r) => isPending(r.state))) return;
      w.off();
      watches.delete(id);
    };

    // One event against one relay: the transitions of *The relay*.
    const step = (key: string, e: SessionEvent) => {
      const relay = get().relays.get(key);
      if (!relay) return;
      const w = watches.get(relay.appSessionId);
      const { state } = relay;
      if (!isPending(state)) return;
      if (e.kind === 'process.exited' && e.agentId === null && e.seq !== null) return put(key, null); // the steer went with the process
      const ended = endedAt(e, relay.agentId);
      if (state.kind === 'asked') {
        if (e.kind === 'command.lifecycle' && e.commandUuid === state.messageUuid) {
          if (e.state === 'started') started.add(e.commandUuid);
          else if (DROPPED.has(e.state) && !started.has(e.commandUuid)) put(key, { ...relay, state: { kind: 'failed', message: RELAY_COPY.dropped(e.state as 'cancelled' | 'discarded' | 'refused') } });
          return;
        }
        if (ended !== null && state.childEndedAt === null) return put(key, { ...relay, state: { ...state, childEndedAt: ended } });
        if (e.kind === 'tool.use' && e.seq !== null && matchesSendMessage(e, relay)) { // (b) is the live parent's row; the receipt below takes either form (O3)
          const parentRounds = parentRoundsBetween(w?.rounds ?? [], state.sentSeq ?? -Infinity, e.seq + 1);
          put(key, { ...relay, state: { kind: 'forwarded', messageUuid: state.messageUuid, sentAt: state.sentAt, toolUseId: e.toolUseId, forwardedAt: e.at, parentRounds, childEndedAt: state.childEndedAt } });
        }
        return;
      }
      if (matchesReceipt(e, relay)) return put(key, { ...relay, state: { kind: 'delivered', deliveredAt: e.at } });
      // A forwarded relay's agent ended: the rows in both transcripts are the record. Not for one forwarded to an agent
      // that had already ended, which the forward resumes and whose resume start is the receipt.
      if (ended !== null && state.childEndedAt === null) put(key, null);
    };

    const onBatch = (id: AppSessionId, events: SessionEvent[]) => {
      const w = watches.get(id);
      if (!w) return;
      for (const e of events) {
        if (e.agentId === null && e.seq !== null) w.lastSeq = w.lastSeq === null ? e.seq : Math.max(w.lastSeq, e.seq);
        if (w.inFlight > 0) w.buffered.push(e);
        if (e.kind === 'assistant.block.complete' && e.agentId === null && e.seq !== null && e.block.type === 'tool_use') w.rounds.push(e);
        for (const [key] of ofSession(id)) step(key, e);
      }
      tidy(id);
    };

    const subscribe = (id: AppSessionId): SessionWatch => {
      let w = watches.get(id);
      if (!w) {
        const watch: SessionWatch = { off: () => {}, lastSeq: null, rounds: [], inFlight: 0, buffered: [] };
        watch.off = agentWorkClient().onEventBatch(({ appSessionId, events }) => appSessionId === id && onBatch(id, events));
        watches.set(id, (w = watch));
      }
      return w;
    };

    return {
      relays: new Map(),

      async send(appSessionId, agent, text, parentTurnOpen) {
        const key = relayKey(appSessionId, agent.agentId);
        const existing = get().relays.get(key);
        if (inFlight.has(key) || (existing && isPending(existing.state))) return;
        const base = { appSessionId, agentId: agent.agentId, name: agent.name, text };
        const content = relayText(agent, text);
        const refusal = sendContentRefusal(content);
        if (refusal) return put(key, { ...base, state: { kind: 'failed', message: refusal.message } });
        const w = subscribe(appSessionId); // before the steer goes out, so nothing it causes is missed
        const sentSeq = w.lastSeq;
        w.inFlight += 1;
        inFlight.add(key);
        try {
          const { messageUuid } = await agentWorkClient().steer(appSessionId, content, 'next');
          put(key, { ...base, state: { kind: 'asked', messageUuid, sentAt: new Date().toISOString(), sentSeq, parentTurnOpenAtSend: parentTurnOpen, childEndedAt: null } });
          for (const e of w.buffered) step(key, e);
        } catch (error) {
          put(key, { ...base, state: { kind: 'failed', message: messageOf(error) } });
        } finally {
          w.inFlight -= 1;
          inFlight.delete(key);
          tidy(appSessionId);
        }
      },

      dismiss(key) {
        const relay = get().relays.get(key);
        if (!relay) return;
        put(key, null);
        tidy(relay.appSessionId);
      },
    };
  });
}

export const useRelays = createRelayStore();
