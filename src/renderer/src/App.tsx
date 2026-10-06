import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Shell } from './app/Shell';
import { connectScenarioSessionCreator } from './app/scenario-session-creator';
import { connectPluginToasts } from './app/plugin-toasts'; // R1
import { connectEngineSurface, connectSurfaceAsks } from './engine-surface'; // R2
import { connectPluginPanes } from './engine-surface/panes'; // R2
import { connectAttention } from './attention/navigation';
import { registerShellActions } from './app/shell-actions';
import { ipc } from './ipc/client';
import { connectShell } from './ipc/events';
import { queryClient } from './ipc/query';
import { connectActions, connectKeys } from './keymap/dispatcher';
import { connectVisibility } from './session/visibility';
import { persistLayout } from './stores/layout';
import { useSettings } from './stores/settings';
import { connectTranscript } from './transcript/shell'; // C6
// C8a start
import { registerSlot } from './app/slots';
import { connectPanelEvents } from './ipc/events';
import { connectPanelHost, registerPanelTool } from './panel/host';
import { PanelHost } from './panel/PanelHost';
import { adoptTerminals, terminalTool } from './tools/terminal';
// C8a end
// C7 start
import { ComposerAppKeys, connectComposer, connectInlineEdit, WidgetDialogHost } from './composer';
import { connectRequestCard } from './request-card';
import { connectStatusLine } from './statusline';
import { registerTranscriptActions } from './transcript';
// C7 end
// C8c start
import { connectCodeEvents } from './ipc/events';
import { codeTranscriptActions, registerCodeTools } from './tools/code';
import { registerTranscriptActions as registerCodeTranscriptActions } from './transcript';
// C8c end
// C10 start
import { registerSetupIntentHook } from './composer/setup-intent';
import { connectSessions } from './sessions/connect';
import { SessionDialogs } from './sessions/SessionDialogs';
import { useSetupIntent } from './sessions/useSetupIntent';
// C10 end
// C8b start
import { connectAgentWorkEvents } from './ipc/events';
import { agentsDevSurface, agentTranscriptActions, registerAgentTools } from './tools/agents';
// C8b end
// C11 start
import { registerGatewayActions } from './gateway/actions';
import { connectDirectLogin } from './gateway/direct-login';
import { startRelayMonitor } from './gateway/relay-monitor';
import { GatewayDialogs } from './gateway/SwitchSheet';
import { sessionInfoTool } from './tools/session-info';
import { registerAllWidgets } from './widgets';
import { connectMonoFont, connectTranscriptWidth, registerSettingsTab } from './settings-tab';
// C11 end
// C12 start
import { BudgetSheets } from './budget/BudgetSheets';
import { connectBudget } from './budget/store';
import { connectQuitWait } from './lifecycle/quit-wait';
// C12 end
// W6 start
import { registerUsage } from './usage';
// W6 end
// E9 start
import { DictationKeys } from './composer';
// E9 end
// E5 start
import { EditorDialogs } from './tools/code';
// E5 end

// C10 start: C7's composer binds an unstarted session's chips and Send through C10's hook; registered at module load,
// before any composer renders, so the function the composer calls as a hook is fixed for the page's life (C7's rule)
registerSetupIntentHook(useSetupIntent);
// C10 end

export function App() {
  const resolvedTheme = useSettings((s) => s.state?.resolvedTheme);

  useEffect(() => useSettings.getState().connect(), []);
  useEffect(() => connectShell(), []); // C5: sessions, attention and layout, app-wide
  useEffect(() => persistLayout(ipc), []); // C5: changed layout keys back to main
  useEffect(() => registerShellActions(), []); // C5: the frame's action handlers
  useEffect(() => connectAttention(), []); // C5: ⌘⇧J, notification clicks and the fallback toast
  useEffect(() => connectPluginToasts(), []); // R1: a plugin's toast, for a session this window shows
  useEffect(() => connectEngineSurface(), []); // R2: the engine's drawings re-asked when it invalidates them
  useEffect(() => connectSurfaceAsks(), []); // R2: a plugin's copy and prompt requests, answered by this window
  useEffect(() => connectPluginPanes(), []); // R2: a plugin's panes as panel tabs, from the engine's roster
  useEffect(() => connectKeys(), []); // C5: renderer-sink chords, bound to the element that holds focus
  useEffect(() => connectActions(), []); // C5: menu actions in, the enabled set out
  useEffect(() => connectScenarioSessionCreator(), []); // C5: the stub's session creator in launch mode scenario
  useEffect(() => connectVisibility(), []); // C5: which sessions are on screen, for the unread rule
  useEffect(() => connectTranscript(), []); // C6: the transcript slot and its path chips' file tabs
  // C8a start: the panel host into C5's slot, and its store-driven transitions (the hydration barrier, reconciliation,
  // the collapse focus). Below `persistLayout` on purpose: the barrier writes inside the hydration notification, and
  // persistence must already be subscribed to hear it.
  useEffect(() => {
    registerSlot('panelHost', PanelHost);
    return connectPanelHost();
  }, []);
  useEffect(() => connectPanelEvents(), []); // the summary's git.changed and fs.workflowChanged
  // Tool registration is the panel host's line (ruling O2). Never unregistered: a registration's disposer closes the
  // tool's tabs, which StrictMode's effect replay would do on every mount.
  useEffect(() => {
    registerPanelTool(terminalTool); // C9's Terminal
    // After a renderer reload the PTY host still runs the shells of the restored Terminal tabs: re-adopt them. A tab
    // restored before this answers waits for it (`ensureTerminal`), so it reattaches rather than starting a second shell.
    void adoptTerminals();
  }, []);
  // C8a end
  // C7 start: the X4 card in C5's requestCard slot (docked, card, hover) and C6's transcript request slot (inline)
  useEffect(() => connectRequestCard(), []);
  useEffect(() => connectStatusLine(), []); // the shared ClaudeUsage read, app-wide
  useEffect(() => connectComposer(), []); // the composer in C5's composer slot
  useEffect(() => connectInlineEdit(), []); // W3 (B6): a bubble's Edit, and a blocked prompt's Edit prompt (W1), edit the bubble in place
  // C7 end
  // C8c start: Review, Files, the file viewer and the diff tab, registered once and never unregistered, as C8a's block
  // does (a registration's disposer closes the tool's tabs); main's files.changed; and the transcript's two callbacks
  // (K3), registered after C6's `connectTranscript` so they win over its file-tab default.
  useEffect(() => {
    registerCodeTools();
  }, []);
  useEffect(() => connectCodeEvents(), []);
  useEffect(() => registerCodeTranscriptActions(codeTranscriptActions), []);
  // C8c end
  // C10 start: the setup store and C5's tab retention at once (before hydration's snapshots answer); in launch mode
  // `index`, the newSession slot, the session creator, the close guard, the unstarted title and the session actions
  useEffect(() => connectSessions(), []);
  // C10 end
  // C8b start: the agent tools (Subagents, Background work and the Log). Registration is never undone (a registration's
  // disposer closes the tool's tabs, which StrictMode's effect replay would do); the transcript's subagent rows open
  // Subagents (a workflow's, Background work) and its "Open full log" opens the Log (openFullLog); a task list changed
  // on disk refreshes its checklist; development builds expose the stores the live acceptance reads.
  useEffect(() => registerAgentTools(), []);
  useEffect(() => registerTranscriptActions(agentTranscriptActions), []);
  useEffect(() => connectAgentWorkEvents(), []);
  useEffect(() => {
    if (import.meta.env.DEV) window.__maws_agents = agentsDevSurface();
  }, []);
  // C8b end
  // C11 start: Settings… and Open ClaudeUsage in the action table (W6: Usage is the usage popover's); the relay
  // monitor's app-wide banner while a routed session is live; a widget for every name of the slash palette
  useEffect(() => registerGatewayActions(), []);
  useEffect(() => startRelayMonitor(), []);
  useEffect(() => registerAllWidgets(), []);
  // M4: a Direct session's login from every get_status answer (W2: the routing footer left with the status line; the
  // route and its switch are Session info's)
  useEffect(() => connectDirectLogin(queryClient), []);
  // Session info in the panel's "+" menu, registered once and never unregistered, as C8a's block does
  useEffect(() => {
    registerPanelTool(sessionInfoTool);
  }, []);
  // M5: the Settings tab in C5's slot (W6: the Accounts tab retired into the top bar's usage popover), and
  // appearance.monoFont as the root --font-mono override
  useEffect(() => {
    registerSettingsTab();
  }, []);
  useEffect(() => connectMonoFont(), []);
  useEffect(() => connectTranscriptWidth(), []); // W2: appearance.transcriptWidth as the root --measure
  // C11 end
  // C12 start: the engine host's memory budget (Session info's line, Settings' default) and its app-wide banner
  useEffect(() => connectBudget(), []);
  useEffect(() => connectQuitWait(), []); // M4: Quit when idle's banner while main holds the quit
  // C12 end
  // W6 start: the top bar's usage pill and its popover, the copy of ClaudeUsage's panel (E1), and the Usage action
  useEffect(() => registerUsage(), []);
  // W6 end

  // index.html ships data-theme="light" for the first paint; from then on main's resolved theme decides.
  useEffect(() => {
    if (resolvedTheme) document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
      {/* C7 start: the one app-level ⌘. and ⌘L, resolving the focused pane's session */}
      <ComposerAppKeys />
      {/* W3 (C6): the slash widgets' floating dialog */}
      <WidgetDialogHost />
      {/* C7 end */}
      {/* C10 start: the small sheets (rename, fork, archive, delete, cleanup, archived sessions) */}
      <SessionDialogs />
      {/* C10 end */}
      {/* C11 start: the route switch's confirm and pickDirectModel's dialog */}
      <GatewayDialogs />
      {/* C11 end */}
      {/* C12 start: the memory budget's blocked sessions and stop sheets */}
      <BudgetSheets />
      {/* C12 end */}
      {/* E9 start: dictation's one controller, for the composer microphone's clicks and the composer.dictate hold once bound */}
      <DictationKeys />
      {/* E9 end */}
      {/* E5 start: the editor's close sheet (registerEditor's guard, registered by C8c's registerCodeTools) */}
      <EditorDialogs />
      {/* E5 end */}
    </QueryClientProvider>
  );
}
