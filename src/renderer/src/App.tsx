import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Shell } from './app/Shell';
import { connectScenarioSessionCreator } from './app/scenario-session-creator';
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
import { ComposerAppKeys, connectComposer, editAndResubmitRow } from './composer';
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
  useEffect(() => connectStatusLine(), []); // the shared ClaudeUsage read and the near-limit banner, app-wide
  useEffect(() => connectComposer(), []); // the composer in C5's composer slot
  useEffect(() => registerTranscriptActions({ editAndResubmit: editAndResubmitRow }), []); // a bubble's Edit prefills the composer in edit mode
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

  // index.html ships data-theme="light" for the first paint; from then on main's resolved theme decides.
  useEffect(() => {
    if (resolvedTheme) document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
      {/* C7 start: the one app-level ⌘. and ⌘L, resolving the focused pane's session */}
      <ComposerAppKeys />
      {/* C7 end */}
      {/* C10 start: the small sheets (rename, fork, archive, delete, cleanup, archived sessions) */}
      <SessionDialogs />
      {/* C10 end */}
    </QueryClientProvider>
  );
}
