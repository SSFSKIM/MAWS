// The agent tools' hand-offs from the transcript (C8b execution document, Interfaces *Tools*, K3): the callbacks C8b
// registers into C6's `TranscriptActions` from its App.tsx block. `openSubagent` opens Subagents on the agent (or on its
// pending view before `subagent.started` named it) and a workflow's row on Background work's widget for the run (E7);
// `openFullLog` opens the Log on the file the engine reported for a cell, or an Edit cell's file (K4). Kept apart from
// the tools so a tool's own view (the drill-in) can merge them without importing the registration.
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { panelHost, shownSession } from '../../panel/host';
import { registeredActions, useTranscriptStore, type Cell, type SubagentRef, type TranscriptActions } from '../../transcript';
import { openLog } from './log/LogTool';
import { AGENT_TOOL_IDS } from './tool-ids';
import { useSessions } from '../../stores/sessions'; // E7
import type { PeerAddress, PeerReplies } from '../../transcript'; // E7
import { peerRelayKey, useRelays } from './relay-store'; // E7
import type { BackgroundParams } from './background/BackgroundTool'; // E7

export { AGENT_TOOL_IDS } from './tool-ids';

// The session a hand-off acts on: the focused pane's at click time (a pane focuses on pointerdown, so it is the pane
// whose transcript was clicked; the drill-in's own transcript sits in the panel, which shows that same session), else
// the session whose transcript holds what was clicked (a child's key `<app>:<agent>` names its parent's session).
function sessionAtClick(holds: (key: string) => boolean): AppSessionId | null {
  const focused = shownSession();
  if (focused !== null) return focused;
  const keys = Object.keys(useTranscriptStore.getState().entries);
  const key = keys.find((k) => !k.includes(':') && holds(k)) ?? keys.find((k) => k.includes(':') && holds(k));
  if (key === undefined) return null;
  return (key.includes(':') ? key.slice(0, key.lastIndexOf(':')) : key) as AppSessionId;
}

// C6 leaves `agentId` null and puts the agent id in `taskId` once `subagent.started` arrived; before that `taskId` is
// the tool-use id (the placeholder), which the tool shows as its pending view until the start names the agent.
export function openSubagent(ref: SubagentRef): void {
  const store = useTranscriptStore.getState();
  const appSessionId = sessionAtClick((key) => store.activity(key).some((turn) => turn.subagents.some((r) => r.taskId === ref.taskId)));
  if (appSessionId === null) return;
  if (ref.kind === 'workflow') {
    // a pinned tab still on another session follows this one first, as Subagents does. E7 (Design §2): the run's widget,
    // by the ref's task id and, when the Workflow result named it, its run id
    const params: BackgroundParams = { taskId: ref.taskId as string, ...(ref.runId === undefined ? {} : { runId: ref.runId }), view: 'run', appSessionId };
    panelHost.addTool(AGENT_TOOL_IDS.background, { appSessionId, params });
    return;
  }
  const id = (ref.agentId ?? ref.taskId) as string;
  const selection = ref.toolUseId !== null && id === (ref.toolUseId as string) ? { toolUseId: ref.toolUseId } : { agentId: id as AgentId };
  const params = { ...selection, appSessionId }; // a pinned tab still on another session follows this one first
  panelHost.addTool(AGENT_TOOL_IDS.subagents, { appSessionId, params });
}

// "Open full log" by the cell's kind: a shell, MCP or generic cell's spill (the path the engine reported, §4.3); an
// Edit cell's file through the registered `openFile` (K4: the whole diff lives in the file); and, when the engine
// reported no file (truncated output kept in the transcript only), the Log's "no file reported" state, so a click
// always shows something and never reads a derived path.
export function openFullLog(cell: Cell): void {
  const store = useTranscriptStore.getState();
  const appSessionId = sessionAtClick((key) => cell.toolUseId !== null && (store.entries[key]?.state.index.toolUses.has(cell.toolUseId) ?? false));
  if (appSessionId === null) return;
  const detail = cell.detail;
  if (detail.kind === 'edit') {
    registeredActions().openFile(detail.filePath, detail.hunks[0]?.newStart);
    return;
  }
  const spill = detail.kind === 'shell' || detail.kind === 'mcp' || detail.kind === 'generic' ? detail.spill : null;
  openLog(appSessionId, spill?.path ?? null, cell.label);
}

// E7 start: the transcript's Reply under a message from another session, and its Message on a listing row (E7
// execution document, Design §4): the relay store asks the row's session, by one `'next'` steer, to SendMessage the
// text to the address; the row reads that ask back through `peerReplies` (the store's relay for the address, the same
// object until it changes). Whether the session had a turn open when asked is the line's clause, as the drill-in's.
export async function replyToPeer(appSessionId: AppSessionId, target: PeerAddress, text: string): Promise<void> {
  const turnOpen = (useSessions.getState().engine.get(appSessionId)?.turn ?? null) !== null;
  await useRelays.getState().send(appSessionId, { kind: 'peer', ...target }, text, turnOpen);
}

export const peerReplies: PeerReplies = {
  subscribe: (listener) => useRelays.subscribe(listener),
  get: (appSessionId, address) => useRelays.getState().peers.get(peerRelayKey(appSessionId, address)),
  dismiss: (appSessionId, address) => useRelays.getState().dismiss(peerRelayKey(appSessionId, address)),
};
// E7 end

export const agentTranscriptActions: Pick<TranscriptActions, 'openSubagent' | 'openFullLog' | /* E7 */ 'replyToPeer' | 'peerReplies'> = { openSubagent, openFullLog, replyToPeer, peerReplies };
