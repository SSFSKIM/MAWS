// Customize's connectors (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "My items", "Adding",
// "Signing in", "Which session"; M4): the body each view draws while Show is Connectors.
// - My items: the servers configured on disk for the page's directory, each a `ConnectorRow` with its scope and file, its
//   sign-in state (presented by ./present.ts), Sign in (the engine's own flow, run in a ready session whose scope
//   includes the server; with none, "Open a session in <place>, then sign in" and nothing else: Customize never starts a
//   session), Cancel while one runs, and Remove; then what the attached session has live (the caller's `live`). UX wave
//   U11a M8 (docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md, §A): a row of MAWS's own list
//   signs in through a ready session on this Mac whose status lists it, as a dynamic connector, sending the revision of
//   the configuration the row was drawn with (main's `catalog.postures`); with no revision it offers no Sign in.
// - Discover: the catalog's connectors; + opens the connector sheet and runs `claude mcp add`. Without Anthropic's
//   directory (no copy at all) the pane says so, with Retry.
// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D, §E): the operations and the sheet are the
// page's one place's (./manage.tsx, customize/place.tsx), so an add or a removal runs on, and its line stays, whichever
// view and Show value are drawn and across a change of project; the head draws My items' tools, "Add custom connector…"
// among them (U11g), and the page's search narrows the rows by their name. UX wave U11g
// (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §D): a custom add's line stands at the head of the
// list while it works or after it failed; a succeeded add draws nothing there, its row being the result.
import { useEffect, useMemo, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { ipc } from '../../ipc/client';
import { useSessions } from '../../stores/sessions';
import { SECONDARY } from '../../sessions/ui';
import { LIBRARY as L } from '../../widgets/copy';
import { Gone, useManage, type Manage } from '../../widgets/plugins/manage';
import { factsOf } from '../../widgets/plugins/operation';
import { useEngineRead } from '../../widgets/read';
import { DiscoverPane } from '../discover/DiscoverPane';
import type { Inventory } from '../inventory';
import { useCatalogPostures, useCatalogRefresh, useCatalogSources } from '../discover/read';
import { ConnectorRow, type ConnectorRowProps } from './ConnectorRow';
import { CONNECTORS as C } from './copy';
import { CUSTOM_ADD_KEY, type AskIn } from './manage';
import { addLineShown, ownSignInSessionOf, shadowedBy, signInSessionOf, type HoldingSession } from './present';
import { connectorRows, connectorRowsMatching, type ConnectorRowModel } from './rows';
import { useSignIns } from './sign-in';

const DIRECTORY_SERVERS = 'directory:servers';

/** My items' connectors: the inventory's state, an add's line, the configured rows, and what the attached session has live. */
export function ConnectorsMine({ cwd, place, servers, readAt, inventoryState, attached, askIn, search, onResetSearch, live }: {
  cwd: string | null; // the page's directory; null for the user configuration
  place: string | null; // the page's name for "Open a session in <place>"
  servers: Inventory['servers'] | undefined; // the inventory's, once read
  readAt: number; // when the inventory last answered
  inventoryState: ReactNode; // reading, failed (with Retry), or the warnings
  attached: AppSessionId | null; // the page's attached session
  askIn: AskIn;
  search: string; // My items' text: the rows whose name holds it
  onResetSearch(): void;
  live: ReactNode; // what the attached session has live
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {inventoryState}
      <Adding />
      {servers && <Configured servers={servers} readAt={readAt} cwd={cwd} place={place} attached={attached} askIn={askIn} search={search} onResetSearch={onResetSearch} />}
      {live}
    </div>
  );
}

// U11g: a custom add's line at the head of the list, under its name, while it works or after it failed (§D); under My
// items, All, at the head of the connectors' part.
export function Adding() {
  const { ops } = useManage();
  const lines = [...ops.entries.entries()].filter(([key, entry]) => key.startsWith(`${CUSTOM_ADD_KEY}:`) && addLineShown(entry.state));
  return lines.map(([key, entry]) => <Gone key={key} opKey={key} name={factsOf(entry).target} data={{ 'data-connector-adding': key }} />);
}

/** Discover's connectors; with no copy of Anthropic's directory at all, its words and Retry in the list's place. */
export function ConnectorsDiscover({ cwd, onOpenInstalled, onDetail, toList }: { cwd: string | null; onOpenInstalled(item: CatalogItem): void; onDetail?(open: boolean): void; toList?: number }) {
  const sources = useCatalogSources();
  const { refresh, running } = useCatalogRefresh();
  const directory = sources.data?.find((source) => source.key === DIRECTORY_SERVERS);
  if (directory?.state === 'unavailable')
    return (
      <div role="alert" data-connectors-unavailable className="flex flex-wrap items-baseline gap-2 px-2 text-ui-sm text-fg">
        {C.unavailable}
        <button type="button" className={SECONDARY} disabled={running} onClick={refresh}>
          {C.retry}
        </button>
      </div>
    );
  return <DiscoverPane tab="connectors" cwd={cwd} onOpenInstalled={onOpenInstalled} onDetail={onDetail} toList={toList} />;
}

// The configured servers, with a removal's result kept at the head once its row has left.
function Configured({ servers, readAt, cwd, place, attached, askIn, search, onResetSearch }: { servers: Inventory['servers']; readAt: number; cwd: string | null; place: string | null; attached: AppSessionId | null; askIn: AskIn; search: string; onResetSearch(): void }) {
  const { ops } = useManage();
  const rowFacts = useConnectorRowFacts({ servers, readAt, cwd, attached });
  const rows = connectorRows({ servers });
  const shown = connectorRowsMatching(rows, search);
  if (rows.length === 0 && removedOf(ops, rows).length === 0) return <p className="m-0 px-2 text-ui-sm text-fg-muted">{C.none}</p>;
  return (
    <>
      <Removed rows={rows} />
      {rows.length > 0 && shown.length === 0 ? (
        <div role="status" className="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <p className="m-0 text-ui text-fg-muted">{L.noMatch}</p>
          <button type="button" className={SECONDARY} onClick={onResetSearch}>
            {L.resetFilters}
          </button>
        </div>
      ) : (
        <ul aria-label={C.configured} className="m-0 list-none p-0">
          {shown.map((row) => (
            <ConnectorRow key={row.key} row={row} askIn={askIn} cwd={cwd} place={place} {...rowFacts(row)} />
          ))}
        </ul>
      )}
    </>
  );
}

const removedOf = (ops: Manage['ops'], rows: readonly ConnectorRowModel[]) => {
  const present = new Set(rows.map((row) => row.key));
  return [...ops.entries.entries()].filter(([key, entry]) => key.startsWith('connector:') && factsOf(entry).action === 'mcp-remove' && !present.has(key));
};

/** A removal's result whose row has left `rows`: at the head of the connector rows, of the Connectors list and of All. */
export function Removed({ rows }: { rows: readonly ConnectorRowModel[] }) {
  const { ops } = useManage();
  return removedOf(ops, rows).map(([key, entry]) => <Gone key={key} opKey={key} name={factsOf(entry).target} data={{ 'data-connector-gone': key }} />);
}

/** What a configured row draws beside its model, for the page's place: whether another entry shadows it, the session a
 * Sign in runs in, what the attached session has live, and main's posture for it (its sign-in posture, fingerprint,
 * revision and icon). One read of each for the list, by the Connectors list and by All alike. */
export function useConnectorRowFacts({ servers, readAt, cwd, attached }: { servers: Inventory['servers']; readAt: number; cwd: string | null; attached: AppSessionId | null }): (row: ConnectorRowModel) => Omit<ConnectorRowProps, 'row' | 'askIn' | 'cwd' | 'place' | 'kindWord'> {
  const engine = useSessions((s) => s.engine);
  // P5 O7 M5c: this Mac's ready sessions alone (the architect's ruling): a sign-in keeps its credential on the machine it
  // runs on, and this Mac's Customize signs in on this Mac; another machine's are configured from its Connectors sheet
  const read = useEngineRead('session.mcpStatus', { appSessionId: attached ?? ('' as AppSessionId) }, { enabled: attached !== null });
  // U11a M8 (§A): the servers each ready session holds, for a row of MAWS's own list. The store's list is the engine's
  // init frame's, which a session started with no message has not sent (P7 run 43386195217); for the attached session
  // the page's own mcp_status read says it too. A ready session that is not the attached one and has had no first turn
  // is still not found (ticket 619).
  const attachedServers = read.data?.mcpServers;
  const ready = useMemo<HoldingSession[]>(
    () =>
      [...engine.values()]
        .filter((status) => status.process === 'ready' && machineOf(status.appSessionId) === ipc.localMachine)
        .map((status) => {
          const listed = status.mcpServers.map((server) => server.name);
          const answered = status.appSessionId === attached && attachedServers ? attachedServers.map((server) => server.name) : [];
          return { appSessionId: status.appSessionId, cwd: status.cwd, servers: [...new Set([...listed, ...answered])] };
        }),
    [engine, attached, attachedServers],
  );
  const liveOf = (name: string) => {
    if (attached === null || !read.data) return undefined;
    const entry = read.data.mcpServers.find((server) => server.name === name);
    return entry ? { status: entry.status, error: typeof entry.error === 'string' ? entry.error : null } : null;
  };
  const liveRead = attached !== null && read.readAt !== null ? { appSessionId: attached, at: read.readAt } : null; // when its answer arrived
  const postures = useCatalogPostures(cwd, servers, readAt).data?.servers;
  // by the file the entry is in too: two project files may configure one name with different endpoints
  const postureOf = (row: { name: string; scope: string; path: string }) => postures?.find((p) => p.name === row.name && p.scope === row.scope && p.path === row.path) ?? null;
  // a sign-in that ended: the attached session's servers read again
  const ended = useSignIns((s) => [...s.byServer.values()].filter(({ event }) => event.state === 'done' || event.state === 'failed').map(({ event }) => event.opId).join(','));
  const { refetch } = read;
  useEffect(() => {
    if (ended !== '') refetch();
  }, [ended, refetch]);
  return (row) => {
    const posture = postureOf(row);
    return {
      shadow: shadowedBy(row, servers),
      session: row.scope === 'app' ? ownSignInSessionOf(row.name, ready, attached, cwd) : signInSessionOf(row.scope, ready, attached, cwd),
      live: liveOf(row.name),
      liveRead,
      posture: posture?.authPosture ?? null,
      fingerprint: posture?.fingerprint ?? null,
      revision: posture?.revision ?? null,
      iconUrl: posture?.iconUrl ?? null,
    };
  };
}
