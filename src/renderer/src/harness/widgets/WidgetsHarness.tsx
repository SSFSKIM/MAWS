// The widgets harness page (`#widgets`; C11 execution document, M2 decisions and Acceptance item 2). Interactive: C7's
// composer over one session with a widget picker beside it, over the app's real stores and X2, so typing `/` in the
// composer and choosing a name opens C11's widget as the app does; under MAWS_WIDGET_BACKEND=fixtures main answers the
// widgets' reads from the fixture-backed widget backend over C5's scenario records, and C10's session actions and
// sheets are registered as the app registers them (`/rename`'s dialog, Resume, the route switch's resume). Passive (C3's strict replay): the
// engine-read widgets and the model and compact widgets mounted at once reading only the query cache and the status,
// which the spec's scripted driver moves through `read` and `control` with exactly the fixture's recorded frames, so
// nothing on the page writes to the replay on its own.
// Main blocks navigation, so an end-to-end test drives the page through `window.__maws_widgets`; for manual use
// `?session=<id>` shows a session (`&driver=replay` passively), `&widget=<name>` opens a widget and `?theme=dark`.
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ToastHost } from '../../app/ToastHost';
import { connectDirectLogin } from '../../gateway/direct-login';
import { GatewayDialogs } from '../../gateway/SwitchSheet';
import { UsageFooter } from '../../gateway/UsageFooter';
import { registerSessionActions } from '../../sessions/actions';
import { SessionDialogs } from '../../sessions/SessionDialogs';
import { registerUsagePopoverFooter } from '../../statusline';
import { UsagePopoverBody } from '../../statusline/UsagePopover';
import { useSessions } from '../../stores/sessions';
import { sessionInfoTool } from '../../tools/session-info';
import { panelHost } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import { Composer, ComposerAppKeys, WIDGET_COMMANDS, type WidgetCommandName } from '../../composer';
import { slashWidget, useRegisteredWidgets } from '../../composer/mentions/widgets';
import { connectShell } from '../../ipc/events';
import { queryClient } from '../../ipc/query';
import { connectKeys } from '../../keymap/dispatcher';
import { useLayout } from '../../stores/layout';
import { connectUsage } from '../../stores/usage';
import { registerAllWidgets, WIDGETS } from '../../widgets';
import { WIDGET_TITLE } from '../../widgets/copy';
import { applyFlagSettings, setEffort, setModel } from '../../widgets/model';
import { setPermissionMode } from '../../widgets/PermissionsWidget';
import { readIntoCache, WidgetReadPolicyContext, type SessionRead } from '../../widgets/read';
import type { WidgetsHarnessApi, WidgetsPane } from './api';

declare global {
  interface Window {
    __maws_widgets?: WidgetsHarnessApi;
  }
}

// The widgets mounted together in passive mode: M2's fourteen engine-read widgets, and the model and compact widgets
// (M3), whose reads (`list_models`, the summary `get_context_usage`) the replay-conformance driver issues.
const PASSIVE: readonly WidgetCommandName[] = ['model', 'permissions', 'usage', 'context', 'compact', 'config', 'plugins', 'mcp', 'sandbox', 'hooks', 'memory', 'skills', 'agents', 'status', 'diff', 'export'];

// M4: the session's routing facts as C7's usage popover shows them (its body with C11's footer), and C11's Session info
// tool as C8a's host renders it for the shown session, beside the composer.
function RoutePane({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const [state] = useState(() => sessionInfoTool.createState({ appSessionId, session: record, instanceId: 'session-info:harness', params: undefined }));
  if (!record) return null;
  const ctx: PanelToolContext = { appSessionId, session: record, status, pinned: false, visible: true, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: panelHost.addTool };
  const Info = sessionInfoTool.render;
  return (
    <aside className="flex min-w-0 flex-col gap-3">
      <section aria-label="Account usage" className="rounded-md border border-border bg-bg-raised">
        <UsagePopoverBody record={record} status={status} />
      </section>
      <section aria-label="Session info" className="max-h-[32rem] rounded-md border border-border bg-bg-raised">
        <Info state={state} ctx={ctx} />
      </section>
    </aside>
  );
}

// The widgets' own control functions, for the scripted driver (`window.__maws_widgets.control`), called with the
// recorded arguments verbatim; nothing else calls them through this table.
const CONTROLS: Record<string, (input: never) => Promise<unknown>> = { setModel, setEffort, applyFlagSettings, setPermissionMode };

function initial(): { pane: WidgetsPane; widget: { name: string; args: string } | null } {
  const params = new URLSearchParams(location.search);
  const session = params.get('session');
  const widget = params.get('widget');
  return {
    pane: session ? { appSessionId: session, mode: params.get('driver') === 'replay' ? 'passive' : 'interactive' } : null,
    widget: widget ? { name: widget, args: params.get('args') ?? '' } : null,
  };
}

// The layout store's first pane shows the session's tab, so the app-level keys and the usage store find it.
function mirrorLayout(pane: WidgetsPane) {
  const overview = { tabs: [{ id: 'overview' as const, kind: 'overview' as const, pinned: true as const }], activeTabId: 'overview' };
  const tabs = pane
    ? { tabs: [{ id: `session:${pane.appSessionId}`, kind: 'session' as const, appSessionId: pane.appSessionId as AppSessionId, pinned: false }], activeTabId: `session:${pane.appSessionId}` }
    : overview;
  useLayout.setState((s) => ({ main: { ...s.main, panes: [tabs, overview], focusedPane: 0 } }));
}

// A widget opened from the picker, placed as C7's editor places one opened from the palette.
function OpenedWidget({ appSessionId, name, args, close }: { appSessionId: AppSessionId; name: string; args: string; close(): void }) {
  useRegisteredWidgets(); // re-render once the registrations land
  const widget = slashWidget(name);
  if (!widget) return <p className="m-0 text-fg-muted">No widget is registered for /{name}</p>;
  const Widget = widget.component;
  return (
    <section aria-label={widget.title} className="mb-2 rounded-md border border-border bg-bg-raised p-2 text-ui">
      <Widget appSessionId={appSessionId} args={args} close={close} />
    </section>
  );
}

function Interactive({ appSessionId, opened, open, close }: { appSessionId: AppSessionId; opened: { name: string; args: string } | null; open(name: string): void; close(): void }) {
  return (
    <main className="grid h-full grid-cols-[minmax(0,1fr)_22rem_12rem] gap-6 overflow-auto bg-bg p-6 text-ui text-fg">
      <section data-pane={0} aria-label="pane 0" onFocusCapture={() => useLayout.getState().focusPane(0)} className="mt-auto flex min-w-0 flex-col gap-3">
        {opened && <OpenedWidget appSessionId={appSessionId} name={opened.name} args={opened.args} close={close} />}
        <Composer key={appSessionId} appSessionId={appSessionId} paneIndex={0} />
      </section>
      <RoutePane appSessionId={appSessionId} />
      <nav aria-label="Widget picker" className="flex flex-col gap-1 self-start">
        {WIDGET_COMMANDS.map(({ name }) => (
          <button key={name} type="button" onClick={() => open(name)} className="rounded-sm border border-border px-2 py-0.5 text-left text-ui-sm text-fg-muted hover:bg-bg-hover">
            /{name}
          </button>
        ))}
      </nav>
    </main>
  );
}

function Passive({ appSessionId }: { appSessionId: AppSessionId }) {
  return (
    <WidgetReadPolicyContext.Provider value={{ mode: 'passive' }}>
      <main className="grid h-full grid-cols-3 content-start gap-4 overflow-auto bg-bg p-6 text-ui text-fg">
        {PASSIVE.map((name) => {
          const Widget = WIDGETS[name];
          return (
            <section key={name} aria-label={WIDGET_TITLE[name]} className="min-w-0 rounded-md border border-border bg-bg-raised p-2">
              <Widget appSessionId={appSessionId} args="" close={() => {}} />
            </section>
          );
        })}
      </main>
    </WidgetReadPolicyContext.Provider>
  );
}

export function WidgetsHarness() {
  const [start] = useState(initial);
  const [pane, setPane] = useState<WidgetsPane>(start.pane);
  const [opened, setOpened] = useState(start.widget);

  useEffect(() => {
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    mirrorLayout(start.pane);
    const offs = [connectShell(), connectKeys(), connectUsage(), registerAllWidgets(), registerUsagePopoverFooter(UsageFooter), connectDirectLogin(queryClient), registerSessionActions()]; // C10's actions: /rename's dialog, Resume
    window.__maws_widgets = {
      show: (next) => {
        mirrorLayout(next);
        setOpened(null);
        setPane(next);
      },
      open: (name, args = '') => setOpened({ name, args }),
      read: (command, input) => readIntoCache(queryClient, command as SessionRead, input as never),
      control: (name, input) => (CONTROLS[name] ? CONTROLS[name](input as never) : Promise.reject(new Error(`no widget control named ${name}`))),
    };
    return () => {
      offs.forEach((off) => off());
      delete window.__maws_widgets;
    };
  }, [start]);

  const appSessionId = pane?.appSessionId as AppSessionId | undefined;
  return (
    <QueryClientProvider client={queryClient}>
      {!pane || !appSessionId ? (
        <main className="p-6 text-fg-muted">No session shown · window.__maws_widgets.show({'{'} appSessionId, mode {'}'})</main>
      ) : pane.mode === 'passive' ? (
        <Passive key={appSessionId} appSessionId={appSessionId} />
      ) : (
        <Interactive key={appSessionId} appSessionId={appSessionId} opened={opened} open={(name) => setOpened({ name, args: '' })} close={() => setOpened(null)} />
      )}
      <ComposerAppKeys />
      <SessionDialogs />
      <GatewayDialogs />
      <ToastHost />
    </QueryClientProvider>
  );
}
