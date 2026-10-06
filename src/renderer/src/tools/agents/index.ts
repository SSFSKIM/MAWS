// The agent tools' public surface (C8b execution document, Repository map): what App.tsx's C8b block and the `#panel`
// harness import: the three tools (E7: and the Tasks panel), registered here, and the transcript hand-offs.
import { registerPanelTool } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../transcript';
import { useRelays } from './relay-store';
import { useTaskGraph } from './store';
import { backgroundTool } from './background/BackgroundTool';
import { logTool } from './log/LogTool';
import { subagentsTool } from './subagents/SubagentsTool';
import { tasksTool } from './tasks/TasksTool'; // E7

export { agentTranscriptActions, openFullLog, openSubagent } from './actions';
export { backgroundTool, type BackgroundParams } from './background/BackgroundTool';
export { BackgroundSummary } from './background/BackgroundSummary';
export { logTool, openLog, type LogParams } from './log/LogTool';
export { subagentsTool, type SubagentsParams } from './subagents/SubagentsTool';
export { SubagentsSummary } from './subagents/SubagentsSummary';
export { tasksTool, type TasksParams } from './tasks/TasksTool'; // E7
export { useTaskGraph } from './store';
export { useRelays } from './relay-store';

// The registrations' disposers are dropped: a registration's disposer closes the tool's tabs, which StrictMode's effect
// replay would do on every mount (ruling O2). A second call re-registers the same declarations, which the host takes as
// a replacement.
export function registerAgentTools(): void {
  registerPanelTool(subagentsTool);
  registerPanelTool(backgroundTool);
  registerPanelTool(logTool);
  registerPanelTool(tasksTool); // E7: the Tasks panel, `show_pane 'tasks'`'s tool
}

// What the live acceptance reads in a development build (`window.__maws_agents`, set by App.tsx's C8b block): the
// stores the agent tools write and the ones they read.
export function agentsDevSurface() {
  return { taskGraph: useTaskGraph, relays: useRelays, layout: useLayout, transcript: useTranscriptStore, sessions: useSessions };
}

declare global {
  interface Window {
    __maws_agents?: ReturnType<typeof agentsDevSurface>;
  }
}
