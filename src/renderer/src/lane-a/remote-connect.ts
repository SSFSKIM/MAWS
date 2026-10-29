// Another machine's terminal sessions in this window (P5 O9 M9, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M9's
// "Rows come from O8" and "Attention across machines"):
// - A click on a listed lane A row opens the session's tab (pre-flight item 1: lane A's opener in O8's registry). The pane
//   draws it from its machine's plane and drives it through the lane A port.
// - A request its bridge raised is a card in its pane while a page watches it: each pending `raised` of a remote state
//   is put in the attention store under the session, with its request view, as main's local list puts a local one
//   (`laneAEntryOf`, shared), its id lifted to the session's machine (OX2) as the IPC boundary lifts main's, so the
//   request view and a question's draft, keyed by it, never meet another machine's same engine session and request. Needs you, the sidebar and the badge read only sessions with a record, so the card shows in
//   the pane alone; attention across machines stays O7's.
// - The agents tool reads its subagent tree and statuses from its plane (`remote-agents.ts`).
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { laneAEntryOf } from '@shared/lane-a/attention-entry';
import { addressOf, machineOf } from '@shared/machine/address';
import { registerRemoteOpener } from '../sessions/remote-openers';
import { connectRemoteAgents } from './remote-agents';
import { useAttention } from '../stores/attention';
import { useLaneA } from '../stores/lane-a';
import { useLayout } from '../stores/layout';

// Main's remote adapter gives every remote state its link; a local state has none.
const isRemote = (state: LaneAState): boolean => state.link !== undefined;

export function connectRemoteLaneA(): () => void {
  const offOpener = registerRemoteOpener('A', (listed) => useLayout.getState().openSession(listed.appId));
  const offAgents = connectRemoteAgents(); // the agents tool reads its subagent tree from its plane
  const told = new Map<AppSessionId, string>(); // the requests last put per session, as JSON
  const firstSeen = new Map<string, string>(); // a request the bridge stamped no time to: when this page first saw it

  const mirror = (appSessionId: AppSessionId, state: LaneAState | null) => {
    const pending = state === null || state.bridge !== 'live' ? [] : state.pending;
    const machine = machineOf(appSessionId);
    const entries = pending.map((raised) => {
      const key = `${appSessionId}\u0000${raised.request}`;
      if (!firstSeen.has(key)) firstSeen.set(key, new Date().toISOString());
      const { item, request } = laneAEntryOf(appSessionId, raised, typeof raised.t === 'number' && Number.isFinite(raised.t) ? new Date(raised.t).toISOString() : firstSeen.get(key)!);
      return { item: { ...item, id: addressOf(machine, item.id) }, request }; // OX2: the id lifted to its machine, as main's are at the IPC boundary
    });
    const json = JSON.stringify(entries);
    if ((told.get(appSessionId) ?? '[]') === json) return;
    if (entries.length === 0) told.delete(appSessionId);
    else told.set(appSessionId, json);
    for (const key of firstSeen.keys()) if (key.startsWith(`${appSessionId}\u0000`) && !pending.some((r) => key.endsWith(`\u0000${r.request}`))) firstSeen.delete(key);
    // the request views first, so the card reads one as soon as its item is there
    useAttention.setState((s) => {
      const requests = new Map(s.requests);
      for (const { item, request } of entries) requests.set(item.id as AttentionId, request as SessionEvent);
      return { requests };
    });
    useAttention.getState().applyChanged({ appSessionId, items: entries.map((e) => e.item) }, machine);
  };

  for (const [id, state] of useLaneA.getState().states) if (isRemote(state)) mirror(id, state);
  const offStates = useLaneA.subscribe((now, before) => {
    if (now.states === before.states) return;
    for (const [id, state] of now.states) if (isRemote(state) && before.states.get(id) !== state) mirror(id, state);
    for (const id of told.keys()) if (!now.states.has(id)) mirror(id, null);
  });
  return () => {
    offOpener();
    offAgents();
    offStates();
    for (const id of [...told.keys()]) mirror(id, null);
  };
}
