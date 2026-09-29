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
// C8c start
import { connectCodeEvents } from './ipc/events';
import { codeTranscriptActions, registerCodeTools } from './tools/code';
import { registerTranscriptActions } from './transcript';
// C8c end

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
  // C8c start: Review, Files, the file viewer and the diff tab, registered once and never unregistered, as C8a's block
  // does (a registration's disposer closes the tool's tabs); main's files.changed; and the transcript's two callbacks
  // (K3), registered after C6's `connectTranscript` so they win over its file-tab default.
  useEffect(() => {
    registerCodeTools();
  }, []);
  useEffect(() => connectCodeEvents(), []);
  useEffect(() => registerTranscriptActions(codeTranscriptActions), []);
  // C8c end

  // index.html ships data-theme="light" for the first paint; from then on main's resolved theme decides.
  useEffect(() => {
    if (resolvedTheme) document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
