// The agent tools' hand-offs from the transcript (C8b execution document, Interfaces *Tools*, K3): the callbacks C8b
// registers into C6's `TranscriptActions` from its App.tsx block. `openSubagent` opens Subagents on the agent (or on its
// pending view before `subagent.started` named it) and a workflow's row on Background work. Kept apart from the tools
// so a tool's own view (the drill-in) can merge them without importing the registration.
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { panelHost, usePanelHost } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { activeTab, sessionOfTab } from '../../stores/layout-model';
import { useTranscriptStore, type SubagentRef, type TranscriptActions } from '../../transcript';

export const AGENT_TOOL_IDS = { subagents: 'subagents', background: 'background', log: 'log' } as const;

// The session a hand-off acts on: the focused pane's at click time (a pane focuses on pointerdown, so it is the pane
// whose transcript was clicked; the drill-in's own transcript sits in the panel, which shows that same session), else
// the session transcript whose activity lists the ref.
function sessionAtClick(ref: SubagentRef): AppSessionId | null {
  const focused = sessionOfTab(activeTab(useLayout.getState().main));
  if (focused !== null) return focused;
  const store = useTranscriptStore.getState();
  const key = Object.keys(store.entries).find((k) => !k.includes(':') && store.activity(k).some((turn) => turn.subagents.some((r) => r.taskId === ref.taskId)));
  return (key as AppSessionId | undefined) ?? null;
}

// C6 leaves `agentId` null and puts the agent id in `taskId` once `subagent.started` arrived; before that `taskId` is
// the tool-use id (the placeholder), which the tool shows as its pending view until the start names the agent.
export function openSubagent(ref: SubagentRef): void {
  const appSessionId = sessionAtClick(ref);
  if (appSessionId === null) return;
  if (ref.kind === 'workflow') {
    // Background work registers with C8b's M3; until then a workflow row opens nothing rather than throwing in the host.
    if (!usePanelHost.getState().tools.has(AGENT_TOOL_IDS.background)) return;
    panelHost.addTool(AGENT_TOOL_IDS.background, { appSessionId, params: { taskId: ref.taskId } });
    return;
  }
  const id = (ref.agentId ?? ref.taskId) as string;
  const selection = ref.toolUseId !== null && id === (ref.toolUseId as string) ? { toolUseId: ref.toolUseId } : { agentId: id as AgentId };
  const params = { ...selection, appSessionId }; // a pinned tab still on another session follows this one first
  panelHost.addTool(AGENT_TOOL_IDS.subagents, { appSessionId, params });
}

export const agentTranscriptActions: Pick<TranscriptActions, 'openSubagent'> = { openSubagent };
