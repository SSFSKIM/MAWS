// The agent tools' public surface (C8b execution document, Repository map): what App.tsx's C8b block and the `#panel`
// harness import. Subagents registers here with M2; Background work and Log join it with M3.
import { registerPanelTool } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../transcript';
import { useRelays } from './relay-store';
import { useTaskGraph } from './store';
import { subagentsTool } from './subagents/SubagentsTool';

export { agentTranscriptActions, openSubagent } from './actions';
export { subagentsTool, type SubagentsParams } from './subagents/SubagentsTool';
export { SubagentsSummary } from './subagents/SubagentsSummary';
export { useTaskGraph } from './store';
export { useRelays } from './relay-store';

// The registrations' disposers are dropped: a registration's disposer closes the tool's tabs, which StrictMode's effect
// replay would do on every mount (ruling O2). A second call re-registers the same declarations, which the host takes as
// a replacement.
export function registerAgentTools(): void {
  registerPanelTool(subagentsTool);
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
