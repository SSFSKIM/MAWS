// P3-H H4: the owner's connector permissions for one HTML artifact (docs/doperpowers/plans/2026-10-12-p3-co-work.md,
// P3-H, Decision Log 24 and 80), opened from the header's Connectors action, never by the page. C10's Sheet and its
// button weights, X7's tokens. One row per tool, the ones the current page load declared first, then the ones the
// artifact holds a grant for: its name, its permission in words (never by colour alone), what the page's latest call of
// it, or the owner's last gesture, came to, and the row's actions: Allow (to read; a read-only tool, watched while
// shown) and Allow once (one call of a tool that may change data) while it has no standing grant, Revoke while it has
// one, Allow again once its server or tool changed since. When some tool found no live session, the sheet offers the
// owner's Start for the artifact's own session or its durable directory (../../../../artifacts/session-context.ts), or
// says how to give it one; a trust or relay card that start meets waits in that session's composer, and a prompt
// waiting there refuses the start (P3 Decision Log 88), both of which Open session shows. Nothing here sends a message.
// P3-HD M3c2 (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, Decision Log 29 and 33): with the owner's
// connector dependency, a Servers section below the tools, separate from their permissions: one row per source the
// tools select (its server, transport and configuration file, MAWS's connection in words, Connect, Reconnect,
// Disconnect), a server only a session can reach and why, saved MAWS connections no source uses (Disconnect), an
// unreadable one (Forget) and a disconnect still unconfirmed (Retry). Controls wrap below a row's identity when narrow.
// Its sentences then name both routes, never a session alone. P3-F: the section stands whenever it has rows, a page
// with no tool declared or granted included, so those recovery actions stay reachable.
import { useStore } from 'zustand';
import { connectorToolKey, type ConnectorToolRef } from '@shared/artifacts/connectors';
import type { ConnectorServerRow } from '@shared/ipc/schema/connectors';
import { NO_SESSION_CONTEXT, useArtifactSessionContext, type ArtifactContextOf, type ArtifactSessionContext } from '../../../../artifacts/session-context';
import { Sheet } from '../../../../sessions/Sheet';
import { PRIMARY, SECONDARY } from '../../../../sessions/ui';
import { useLayout } from '../../../../stores/layout';
import { CONNECTORS_COPY as C, SERVERS_COPY as S } from './copy';
import { sheetTools, type ConnectorsTab } from './tab';

// The sheet for an artifact as the library knows it (null while its row is read: no context, so no Start yet).
export function ArtifactConnectorsSheet({ tab, artifact }: { tab: ConnectorsTab; artifact: ArtifactContextOf | null }) {
  return <ConnectorsSheet tab={tab} context={useArtifactSessionContext(artifact)} />;
}

export function ConnectorsSheet({ tab, context }: { tab: ConnectorsTab; context: ArtifactSessionContext }) {
  const view = useStore(tab.view);
  const tools = sheetTools(view);
  const servers = tools.length > 0 || (view.servers.rows?.length ?? 0) > 0; // P3-F: its recovery rows need no tool
  const body = (
    <>
      {tools.length === 0 ? (
        <p className="m-0 text-ui text-fg-muted">{C.none}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border border-y border-border p-0">
          {tools.map((tool) => (
            <ToolRow key={connectorToolKey(tool)} tab={tab} tool={tool} />
          ))}
        </ul>
      )}
      {tab.owned && servers && <ServersSection tab={tab} />}
      {view.needsSession && <StartRow tab={tab} context={context} />}
    </>
  );
  return (
    <Sheet title={C.title} width="w-[min(520px,90vw)]" onClose={() => tab.closeSheet()} data-connectors-sheet="">
      <p className="m-0 mb-3 text-ui-sm text-fg-muted">{tab.owned ? S.intro : C.intro}</p>
      {tab.owned ? (
        // P3-HD M3c2 correction: the tools and servers can outgrow the sheet (it sits 18% from the top); its body scrolls
        // within the viewport so every control and Done stay reachable, focus rings inside the padding
        <div data-connectors-body="" className="-mx-1 max-h-[calc(82vh-11rem)] overflow-y-auto px-1 py-0.5">
          {body}
        </div>
      ) : (
        body
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => tab.closeSheet()} className={SECONDARY}>
          {C.done}
        </button>
      </div>
    </Sheet>
  );
}

function ToolRow({ tab, tool }: { tab: ConnectorsTab; tool: ConnectorToolRef }) {
  const key = connectorToolKey(tool);
  const view = useStore(tab.view);
  const grant = view.grants?.find((held) => held.server === tool.server && held.tool === tool.tool) ?? null;
  const last = view.last[key] ?? null;
  const changed = last?.ok === false && last.state === 'revoked' && last.reason === 'fingerprintChanged';
  const state = changed ? C.changed : grant?.mode === 'read' ? C.allowedRead : grant?.mode === 'once' ? C.allowedOnce : C.notAllowed;
  const detail = (tab.owned ? S.detail : C.detail)(view.refusals[key] ?? last); // P3-HD M3c2: both routes' words
  const name = C.toolName(tool.server, tool.tool);
  const busy = view.busy === key;
  return (
    <li data-connector-tool={name} className="flex items-start gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-ui text-fg" title={name}>
          {tool.server}
          <span className="text-fg-faint"> · </span>
          {tool.tool}
        </p>
        <p className="m-0 text-ui-sm text-fg-muted" data-connector-state="">
          {state}
          {detail !== null && <span data-connector-detail=""> · {detail}</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {(grant === null || changed) && (
          <>
            <button type="button" disabled={busy} aria-label={changed ? C.allowAgainLabel(name) : C.allowLabel(name)} onClick={() => void tab.grant(tool, 'read')} className={PRIMARY}>
              {changed ? C.allowAgain : C.allow}
            </button>
            <button type="button" disabled={busy} aria-label={C.allowOnceLabel(name)} onClick={() => void tab.grant(tool, 'once')} className={SECONDARY}>
              {C.allowOnce}
            </button>
          </>
        )}
        {grant !== null && (
          <button type="button" disabled={busy} aria-label={C.revokeLabel(name)} onClick={() => void tab.revoke(tool)} className={SECONDARY}>
            {C.revoke}
          </button>
        )}
      </div>
    </li>
  );
}

function StartRow({ tab, context }: { tab: ConnectorsTab; context: ArtifactSessionContext }) {
  const start = useStore(tab.view, (s) => s.start);
  const words = start.phase === 'asking' ? C.asking : start.phase === 'starting' ? C.starting : start.phase === 'ready' ? C.ready : start.phase === 'card' || start.phase === 'refused' ? start.words : null;
  // the session a card waits in, or one a refusal names (a prompt waiting there, Decision Log 88): the owner opens it
  const open = (start.phase === 'card' || start.phase === 'refused') && start.appSessionId !== null ? start.appSessionId : null;
  return (
    <div data-connectors-start="" className="mt-3 flex flex-col gap-2 rounded-md border border-border p-2.5">
      <p className="m-0 text-ui-sm text-fg">{context.kind === 'none' ? NO_SESSION_CONTEXT : tab.owned ? S.noSession : C.noSession}</p>
      {context.kind !== 'none' && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={start.phase === 'asking' || start.phase === 'starting'} onClick={() => void tab.start(context)} className={PRIMARY}>
            {C.start}
          </button>
          {open !== null && (
            <button type="button" onClick={() => useLayout.getState().openSession(open, { how: 'tab' })} className={SECONDARY}>
              {C.openSession}
            </button>
          )}
          <p role="status" className="m-0 min-w-0 flex-1 text-ui-sm text-fg-muted">
            {words}
          </p>
        </div>
      )}
    </div>
  );
}

// P3-HD M3c2 start: MAWS's own per-server rows
function ServersSection({ tab }: { tab: ConnectorsTab }) {
  const servers = useStore(tab.view, (s) => s.servers);
  const { rows, saved, withdrawnUnattributed, failed } = servers;
  const heading = `connectors-servers-${tab.artifactId}`;
  return (
    <section data-connectors-servers="" aria-labelledby={heading} className="mt-4">
      <h3 id={heading} className="m-0 text-ui font-medium text-fg">
        {S.heading}
      </h3>
      <p className="m-0 mb-2 text-ui-sm text-fg-muted">{S.headingNote}</p>
      {rows === null ? (
        <p role="status" className="m-0 text-ui-sm text-fg-muted">
          {failed ? S.readFailed : S.reading}
        </p>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="m-0 flex list-none flex-col divide-y divide-border border-y border-border p-0">
              {rows.map((row) => (
                <ServerRow key={row.kind === 'source' ? row.handle : row.kind === 'engineOnly' ? `${row.server}/${row.why}` : row.connectionId} tab={tab} row={row} unattributed={withdrawnUnattributed} />
              ))}
            </ul>
          )}
          {failed && <p className="m-0 mt-2 text-ui-sm text-fg-muted">{S.readFailed}</p>}
          {saved === 'unavailable' && <p className="m-0 mt-2 text-ui-sm text-fg-muted">{S.savedUnavailable}</p>}
          {withdrawnUnattributed && (
            <p data-connectors-withdrawn="" className="m-0 mt-2 text-ui-sm text-fg-muted">
              {S.withdrawnUnattributed}
            </p>
          )}
        </>
      )}
    </section>
  );
}

interface RowAction {
  label: string;
  aria: string;
  primary?: boolean;
  run(): void;
}

// What a row says and offers: its name, its configuration's origin, its state in words, its actions.
function describe(tab: ConnectorsTab, row: ConnectorServerRow, unattributed: boolean): { name: string; origin: string | null; status: string; actions: RowAction[] } {
  const actions: RowAction[] = [];
  const disconnect = (connectionId: string, retry: boolean, server?: string) =>
    actions.push({ label: retry ? S.retry : S.disconnect, aria: retry ? S.retryLabel(server) : S.disconnectLabel(server ?? ''), run: () => void tab.disconnectServer(connectionId) });
  switch (row.kind) {
    case 'source': {
      const { connection } = row;
      const connect = () => actions.push({ label: S.connect, aria: S.connectLabel(row.server), primary: true, run: () => void tab.connectServer(row.handle) });
      const reconnect = () => actions.push({ label: S.reconnect, aria: S.reconnectLabel(row.server), run: () => void tab.reconnectServer(row.handle) });
      const id = connection?.connectionId;
      if (row.action !== undefined || connection?.disconnecting === 'pending') {
        // an action runs: a sign-in in the browser can be cancelled by its connection's Disconnect
        if (connection?.state === 'connecting' && id !== undefined) actions.push({ label: S.cancel, aria: S.cancelLabel(row.server), run: () => void tab.disconnectServer(id) });
      } else if (!connection) {
        if (row.needsDiscovery) connect();
      } else if (connection.state === 'connecting') {
        if (id !== undefined) actions.push({ label: S.cancel, aria: S.cancelLabel(row.server), run: () => void tab.disconnectServer(id) });
      } else if (connection.state === 'connected' || connection.state === 'needsReconnect') {
        if (connection.state === 'connected' && row.needsDiscovery) connect();
        reconnect();
        if (id !== undefined) disconnect(id, connection.disconnecting === 'unconfirmed', row.server);
      } else if (connection.state !== 'unavailable') {
        connect();
      }
      return { name: row.server, origin: S.origin(row.scope, row.path), status: S.connection(row, unattributed), actions };
    }
    case 'engineOnly':
      return { name: row.server, origin: null, status: S.engineOnly(row.why), actions };
    case 'saved':
      if (row.disconnecting !== 'pending') disconnect(row.connectionId, row.disconnecting === 'unconfirmed', row.server);
      return { name: row.server, origin: S.origin(row.scope, row.path), status: row.disconnecting === 'pending' ? S.disconnecting : row.disconnecting === 'unconfirmed' ? S.unconfirmed : S.savedRow, actions };
    case 'unreadable':
      if (row.disconnecting !== 'pending') actions.push({ label: S.forget, aria: S.forgetLabel, run: () => void tab.disconnectServer(row.connectionId) });
      return { name: S.unreadableRow, origin: null, status: row.disconnecting === 'pending' ? S.forgetting : S.unreadableNote, actions };
    case 'retiring':
      if (row.disconnecting === 'unconfirmed') disconnect(row.connectionId, true, row.server);
      return {
        name: S.retiringRow(row.server),
        origin: row.scope !== undefined && row.path !== undefined ? S.origin(row.scope, row.path) : null,
        status: row.disconnecting === 'pending' ? S.disconnecting : S.unconfirmed,
        actions,
      };
  }
}

function ServerRow({ tab, row, unattributed }: { tab: ConnectorsTab; row: ConnectorServerRow; unattributed: boolean }) {
  const serverBusy = useStore(tab.view, (s) => s.serverBusy);
  const refused = useStore(tab.view, (s) => s.servers.refused);
  const target = row.kind === 'source' ? row.handle : row.kind === 'engineOnly' ? null : row.connectionId;
  const refusal = refused !== null && refused.target === target ? S.refused(refused.why) : null;
  const last = row.kind !== 'engineOnly' && row.last ? S.last(row.last) : null;
  const { name, origin, status, actions } = describe(tab, row, unattributed);
  return (
    <li data-connector-server={name} data-kind={row.kind} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2">
      <div className="min-w-[min(100%,16rem)] flex-1">
        <p className="m-0 text-ui break-words text-fg">
          {name}
          {row.kind === 'source' && (
            <>
              <span className="text-fg-faint"> · </span>
              <span className="text-fg-muted">{S.transport(row.transport)}</span>
            </>
          )}
        </p>
        {origin !== null && (
          <p className="m-0 truncate text-ui-sm text-fg-muted" title={origin}>
            {origin}
          </p>
        )}
        <p className="m-0 text-ui-sm text-fg-muted" data-connector-server-state="">
          {status}
          {last !== null && <span data-connector-server-last=""> · {last}</span>}
          {refusal !== null && <span data-connector-server-refusal=""> · {refusal}</span>}
        </p>
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.map((action) => (
            <button key={action.label} type="button" disabled={serverBusy !== null} aria-label={action.aria} onClick={action.run} className={action.primary ? PRIMARY : SECONDARY}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
// P3-HD M3c2 end
