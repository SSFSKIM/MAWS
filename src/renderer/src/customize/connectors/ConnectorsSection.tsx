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
// list while it works or after it failed; a succeeded add draws nothing there, its row being the result. UX wave U11h
// (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, M3, §E): the plugins' connectors follow the
// configured rows, each with §E's facts: this Mac's ready sessions with what each reported (its servers and when, its plugin
// list and when), the attached session's own status read, the plugin list (null until it has answered), the plugins the
// inventory keeps for the folder, and main's posture and revision for the row.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { ipc } from '../../ipc/client';
import { useSessions } from '../../stores/sessions';
import { SECONDARY } from '../../sessions/ui';
import { LIBRARY as L } from '../../widgets/copy';
import { Gone, useManage, type Manage } from '../../widgets/plugins/manage';
import { displayNameOf } from '../../widgets/plugins/library';
import { factsOf } from '../../widgets/plugins/operation';
import type { PluginsLibraryReads } from '../../widgets/PluginsWidget';
import { engineReadKey, useEngineRead } from '../../widgets/read';
import { DiscoverPane } from '../discover/DiscoverPane';
import type { Inventory } from '../inventory';
import { useCatalogPostures, useCatalogRefresh, useCatalogSources } from '../discover/read';
import { ConnectorRow, type ConnectorRowProps } from './ConnectorRow';
import { CONNECTORS as C } from './copy';
import { CUSTOM_ADD_KEY, type AskIn } from './manage';
import { pluginNameShown, pluginRowStateOf, type PluginList, type ReportingSession } from './plugin-row';
import { addLineShown, ownSignInSessionOf, shadowedBy, signInSessionOf, type HoldingSession } from './present';
import { connectorRows, connectorRowsMatching, type ConnectorRowModel } from './rows';
import { useSignIns } from './sign-in';

const DIRECTORY_SERVERS = 'directory:servers';

/** What the plugin list says of each plugin, by its key (the name its row shows, whether it is enabled here); null until
 * it has answered, and while its latest read has failed (U11h: Sign in waits for it, §E "While the plugin list is
 * unknown"). */
export function usePluginList({ installed, identities }: Pick<PluginsLibraryReads, 'installed' | 'identities'>): PluginList {
  const known = installed.data !== undefined && installed.error === null;
  return useMemo(() => (known ? new Map(identities.map((identity) => [identity.id, { name: displayNameOf(identity.name, identity.manifest), enabled: identity.enabledHere }])) : null), [known, identities]);
}

/** What of the inventory's answer the connectors' rows are drawn from: the configured servers, the plugins' connectors
 * and every plugin it keeps for the folder (the last two absent from an engine host of an earlier build). */
export type ConnectorsAnswer = Pick<Inventory, 'servers' | 'pluginServers' | 'plugins'>;

/** My items' connectors: the inventory's state, an add's line, the configured rows and the plugins' connectors, and what
 * the attached session has live. */
export function ConnectorsMine({ cwd, place, inventory, pluginList, readAt, inventoryState, attached, askIn, search, onResetSearch, live }: {
  cwd: string | null; // the page's directory; null for the user configuration
  place: string | null; // the page's name for "Open a session in <place>"
  inventory: ConnectorsAnswer | undefined; // the inventory's answer, once read
  pluginList: PluginList; // what the plugin list says of each plugin; null until it has answered
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
      {inventory && <Configured inventory={inventory} pluginList={pluginList} readAt={readAt} cwd={cwd} place={place} attached={attached} askIn={askIn} search={search} onResetSearch={onResetSearch} />}
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

// The configured servers, then the plugins' connectors, with a removal's result kept at the head once its row has left.
function Configured({ inventory, pluginList, readAt, cwd, place, attached, askIn, search, onResetSearch }: { inventory: ConnectorsAnswer; pluginList: PluginList; readAt: number; cwd: string | null; place: string | null; attached: AppSessionId | null; askIn: AskIn; search: string; onResetSearch(): void }) {
  const { ops } = useManage();
  const rowFacts = useConnectorRowFacts({ inventory, pluginList, readAt, cwd, attached });
  const rows = connectorRows(inventory);
  const shown = connectorRowsMatching(rows, search, (key) => pluginNameShown(key, pluginList));
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

/** What a row draws beside its model, for the page's place: whether another entry shadows it, the session a Sign in runs
 * in, what the attached session has live, and main's posture for it (its sign-in posture, fingerprint, revision and
 * icon); for a plugin's row, §E's table over what the sessions reported and what the plugin list says. One read of each
 * for the list, by the Connectors list and by All alike. */
export function useConnectorRowFacts({ inventory, pluginList, readAt, cwd, attached }: { inventory: ConnectorsAnswer; pluginList: PluginList; readAt: number; cwd: string | null; attached: AppSessionId | null }): (row: ConnectorRowModel) => Omit<ConnectorRowProps, 'row' | 'askIn' | 'cwd' | 'place' | 'kindWord'> {
  const { servers } = inventory;
  const engine = useSessions((s) => s.engine);
  // P5 O7 M5c: this Mac's ready sessions alone (the architect's ruling): a sign-in keeps its credential on the machine it
  // runs on, and this Mac's Customize signs in on this Mac; another machine's are configured from its Connectors sheet
  const readInput = useMemo(() => ({ appSessionId: attached ?? ('' as AppSessionId) }), [attached]);
  const read = useEngineRead('session.mcpStatus', readInput, { enabled: attached !== null });
  // U11a M8 (§A): the servers each ready session holds, for a row of MAWS's own list. The store's list is the engine's
  // init frame's, which a session started with no message has not sent (P7 run 43386195217); for the attached session
  // the page's own mcp_status read says it too. A ready session that is not the attached one and has had no first turn
  // is still not found (ticket 619). U11h (the branch panel's ruling of 2026-11-16): a session's servers are its latest
  // report, whole: the attached session's answer, once it exists, replaces its seed, so a server the answer omits is not
  // read from the seed. An answer asked before the session's latest report does not stand (`useAnsweredAfterReport`).
  const current = useAnsweredAfterReport(readInput, attached === null ? null : (engine.get(attached)?.pluginsObservedAt ?? null));
  const attachedServers = current ? read.data?.mcpServers : undefined;
  const attachedReadAt = read.readAt;
  const local = useMemo(() => [...engine.values()].filter((status) => status.process === 'ready' && machineOf(status.appSessionId) === ipc.localMachine), [engine]);
  // each session's servers as it last reported them, and when they were observed (ms; null: never)
  const reported = useMemo(
    () =>
      local.map((status) => {
        if (status.appSessionId === attached && attachedServers) return { status, servers: attachedServers.map((server) => ({ name: server.name, status: server.status, error: typeof server.error === 'string' ? server.error : null })), at: attachedReadAt };
        return { status, servers: status.mcpServers.map((server) => ({ name: server.name, status: server.status, error: null })), at: status.pluginsObservedAt === null ? null : Date.parse(status.pluginsObservedAt) };
      }),
    [local, attached, attachedServers, attachedReadAt],
  );
  const ready = useMemo<HoldingSession[]>(() => reported.map(({ status, servers }) => ({ appSessionId: status.appSessionId, cwd: status.cwd, servers: servers.map((server) => server.name) })), [reported]);
  const liveOf = (name: string) => {
    if (attached === null || !read.data) return undefined;
    const entry = read.data.mcpServers.find((server) => server.name === name);
    return entry ? { status: entry.status, error: typeof entry.error === 'string' ? entry.error : null } : null;
  };
  const liveRead = attached !== null && read.readAt !== null ? { appSessionId: attached, at: read.readAt } : null; // when its answer arrived
  // U11h: this Mac's ready sessions with what each reported (its servers and when, its plugin list and when)
  const reporting = useMemo<ReportingSession[]>(
    () =>
      reported.map(({ status, servers, at }) => ({
        appSessionId: status.appSessionId,
        cwd: status.cwd,
        servers: new Map(servers.map(({ name, ...live }) => [name, live] as const)),
        serversAt: at,
        plugins: status.plugins.map(({ name, source, version }) => ({ name, source, version })),
        pluginsObservedAt: status.pluginsObservedAt,
      })),
    [reported],
  );
  const attachedNames = useMemo(() => (attached !== null && attachedServers ? new Set(attachedServers.map((server) => server.name)) : null), [attached, attachedServers]);
  const postureRead = useCatalogPostures(cwd, inventory, readAt).data;
  // whether main has answered for the inventory's latest read (keyed by it): only an answer counts, a null revision in it
  // included; a failed read answers nothing, so the row keeps the revision it last knew
  const revisionRead = postureRead !== undefined;
  const postures = postureRead?.servers;
  // by the file the entry is in too: two project files may configure one name with different endpoints
  const postureOf = (row: { name: string; scope: string; path: string }) => postures?.find((p) => p.name === row.name && p.scope === row.scope && p.path === row.path) ?? null;
  // a sign-in that ended: the attached session's servers read again
  const ended = useSignIns((s) => [...s.byServer.values()].filter(({ event }) => event.state === 'done' || event.state === 'failed').map(({ event }) => event.opId).join(','));
  const { refetch } = read;
  useEffect(() => {
    if (ended !== '') refetch();
  }, [ended, refetch]);
  return (row) => {
    if (row.kind === 'plugin') {
      // by the plugin, the server and the file that declares it: main's list is row for row with the inventory's
      const posture = postureRead?.plugins.find((p) => p.plugin === row.plugin && p.server === row.server && p.path === row.path) ?? null;
      const facts = { sessions: reporting, attached, attachedServers: attachedNames, cwd, list: pluginList, kept: inventory.plugins ?? [], posture: posture?.authPosture ?? null, revision: posture?.revision ?? null };
      const state = pluginRowStateOf(row, facts);
      return { shadow: null, session: state.signIn, live: state.live, liveRead: state.liveRead, posture: facts.posture, fingerprint: null, revision: facts.revision, iconUrl: posture?.iconUrl ?? null, plugin: { state, name: pluginNameShown(row.plugin, pluginList), revisionRead } };
    }
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

// U11h (the architect's ruling on the fix wave's review, 2026-11-16): whether the attached session's status answer in
// hand was asked after the session last reported its servers (`reportedAt`, its `pluginsObservedAt`: an init's or a
// reload's). When the report moves, the read in flight is cancelled and asked again, and until an answer to a read asked
// after the move arrives, the answer in hand does not stand and the report's own list is the session's. The shared read
// hook's way of joining a read in flight is left as it is for its other readers.
function useAnsweredAfterReport(input: { appSessionId: AppSessionId }, reportedAt: string | null): boolean {
  const client = useQueryClient();
  const key = useMemo(() => engineReadKey('session.mcpStatus', input), [input]);
  // the report the answers are judged against, and how many answers the read had when it moved (null: those in hand stand)
  const [asked, setAsked] = useState({ key, reportedAt, after: null as number | null });
  if (asked.key !== key) setAsked({ key, reportedAt, after: null }); // another session's read
  const moved = asked.key === key && asked.reportedAt !== reportedAt;
  useEffect(() => {
    if (!moved) return;
    setAsked({ key, reportedAt, after: client.getQueryState(key)?.dataUpdateCount ?? 0 });
    void client.refetchQueries({ queryKey: key, exact: true }, { cancelRefetch: true });
  }, [moved, key, reportedAt, client]);
  return !moved && asked.key === key && (asked.after === null || (client.getQueryState(key)?.dataUpdateCount ?? 0) > asked.after);
}
