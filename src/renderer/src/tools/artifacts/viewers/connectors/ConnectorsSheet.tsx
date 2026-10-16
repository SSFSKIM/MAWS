// P3-H H4: the owner's connector permissions for one HTML artifact (docs/doperpowers/plans/2026-10-12-p3-co-work.md,
// P3-H, Decision Log 24 and 80), opened from the header's Connectors action, never by the page. C10's Sheet and its
// button weights, X7's tokens. One row per tool, the ones the current page load declared first, then the ones the
// artifact holds a grant for: its name, its permission in words (never by colour alone), what the page's latest call of
// it, or the owner's last gesture, came to, and the row's actions: Allow (to read; a read-only tool, watched while
// shown) and Allow once (one call of a tool that may change data) while it has no standing grant, Revoke while it has
// one, Allow again once its server or tool changed since. When some tool found no live session, the sheet offers the
// owner's Start for the artifact's own session or its durable directory (../../../../artifacts/session-context.ts), or
// says how to give it one; a trust or relay card that start meets waits in that session's composer, which Open session
// shows. Nothing here sends a message.
import { useStore } from 'zustand';
import { connectorToolKey, type ConnectorToolRef } from '@shared/artifacts/connectors';
import { NO_SESSION_CONTEXT, useArtifactSessionContext, type ArtifactContextOf, type ArtifactSessionContext } from '../../../../artifacts/session-context';
import { Sheet } from '../../../../sessions/Sheet';
import { PRIMARY, SECONDARY } from '../../../../sessions/ui';
import { useLayout } from '../../../../stores/layout';
import { CONNECTORS_COPY as C } from './copy';
import type { ConnectorsTab } from './tab';

// The sheet for an artifact as the library knows it (null while its row is read: no context, so no Start yet).
export function ArtifactConnectorsSheet({ tab, artifact }: { tab: ConnectorsTab; artifact: ArtifactContextOf | null }) {
  return <ConnectorsSheet tab={tab} context={useArtifactSessionContext(artifact)} />;
}

export function ConnectorsSheet({ tab, context }: { tab: ConnectorsTab; context: ArtifactSessionContext }) {
  const view = useStore(tab.view);
  const tools = new Map<string, ConnectorToolRef>();
  for (const tool of view.declared) tools.set(connectorToolKey(tool), tool);
  for (const grant of view.grants ?? []) if (!tools.has(connectorToolKey(grant))) tools.set(connectorToolKey(grant), { server: grant.server, tool: grant.tool });
  return (
    <Sheet title={C.title} width="w-[min(520px,90vw)]" onClose={() => tab.closeSheet()} data-connectors-sheet="">
      <p className="m-0 mb-3 text-ui-sm text-fg-muted">{C.intro}</p>
      {tools.size === 0 ? (
        <p className="m-0 text-ui text-fg-muted">{C.none}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border border-y border-border p-0">
          {[...tools].map(([key, tool]) => (
            <ToolRow key={key} tab={tab} tool={tool} />
          ))}
        </ul>
      )}
      {view.needsSession && <StartRow tab={tab} context={context} />}
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
  const detail = C.detail(view.refusals[key] ?? last);
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
  const card = start.phase === 'card' ? start.appSessionId : null;
  return (
    <div data-connectors-start="" className="mt-3 flex flex-col gap-2 rounded-md border border-border p-2.5">
      <p className="m-0 text-ui-sm text-fg">{context.kind === 'none' ? NO_SESSION_CONTEXT : C.noSession}</p>
      {context.kind !== 'none' && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={start.phase === 'asking' || start.phase === 'starting'} onClick={() => void tab.start(context)} className={PRIMARY}>
            {C.start}
          </button>
          {card !== null && (
            <button type="button" onClick={() => useLayout.getState().openSession(card, { how: 'tab' })} className={SECONDARY}>
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
