// Customize › Connectors (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "My items", "Adding",
// "Signing in", "Which session"; M4): My items and Discover, as Plugins and Skills have them.
// - My items: the servers configured on disk for the page's directory, each with its scope and file, its sign-in state
//   (presented by ./present.ts), Sign in (the engine's own flow, run in a ready session whose scope includes the server;
//   with none, "Open a session in <place>, then sign in" and nothing else: Customize never starts a session), Cancel
//   while one runs, and Remove; then what the attached session has live (the caller's `live`). UX wave U11a M8
//   (docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md, §A): a row of MAWS's own list signs in
//   through a ready session on this Mac whose status lists it, as a dynamic connector, sending the revision of the
//   configuration the row was drawn with (main's `catalog.postures`); with no revision it offers no Sign in.
// - Discover: the catalog's connectors; + opens the connector sheet and runs `claude mcp add`. Without Anthropic's
//   directory (no copy at all) the pane says so, with Retry.
// The management state (the operations and the sheet) lives here, above both views, so an add or a removal runs on, and
// its line stays, whichever view shows; Customize keeps the section mounted once visited.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import type { PluginsScope } from '@shared/plugins/cli';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import { ipc } from '../../ipc/client';
import { useSessions } from '../../stores/sessions';
import { SECONDARY } from '../../sessions/ui';
import { LibrarySwitch, type LibraryTab } from '../../widgets/plugins/LibraryHeader';
import { Gone, ManageProvider, OperationLine, useManage, type Manage } from '../../widgets/plugins/manage';
import { usePluginOperations } from '../../widgets/plugins/operation';
import type { PluginsRequest } from '../../widgets/plugins/present';
import { usePluginsEnv } from '../../widgets/plugins/read';
import { resolutionOf } from '../../widgets/PluginsWidget';
import { TextButton } from '../../widgets/parts';
import type { EngineResolution } from '../../widgets/plugins/ConfirmSheet';
import { useEngineRead } from '../../widgets/read';
import { DISCOVER } from '../discover/copy';
import { DiscoverPane } from '../discover/DiscoverPane';
import { DiscoverToolbar } from '../discover/DiscoverToolbar';
import { useCatalogPostures, useCatalogRefresh, useCatalogSources } from '../discover/read';
import { ConnectorSheet } from './ConnectorSheet';
import { CONNECTORS as C } from './copy';
import { ownSignInSessionOf, removalDirectoryOf, removeRequestOf, resultFor, serverKey, shadowedBy, shadowWords, signInSessionOf, signInViewOf, type AuthPosture, type ConfiguredServers, type HoldingSession, type SignInFacts, type SignInView } from './present';
import { cancelSignIn, forgetSignIn, signInKeyOf, signInMachineOf, signsInDynamic, startSignIn, startSignInDynamic, useSignIns, type SignInServer } from './sign-in';

const BUTTON = 'rounded-sm px-2 py-1 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';
const TONE: Record<SignInView['tone'], string> = { muted: 'text-fg-muted', success: 'text-success', danger: 'text-danger' };
const DIRECTORY_SERVERS = 'directory:servers';

type Asking = { key: string; request: PluginsRequest; engine: EngineResolution; opening: number; runIn: string | null }; // runIn: a removal's own directory (sweep#2)

// The operations and the connector sheet: every opening reads `plugins.env` again, as the install sheet does.
function useConnectorManage(cwd: string | null, configured: ConfiguredServers, retryServers: () => void): { manage: Manage; sheet: ReactNode; askIn: AskIn } {
  const env = usePluginsEnv();
  const { reread } = env;
  const runCwd = cwd ?? env.data?.configHome ?? '';
  const ops = usePluginOperations();
  const [asking, setAsking] = useState<Asking | null>(null);
  const openings = useRef(0);
  const askIn = useCallback<AskIn>(
    (key, request, runIn) => {
      const opening = ++openings.current;
      setAsking({ key, request, engine: { state: 'loading' }, opening, runIn });
      void reread().then((read) => setAsking((current) => (current?.opening === opening ? { ...current, engine: resolutionOf(read) } : current)));
    },
    [reread],
  );
  const ask = useCallback((key: string, request: PluginsRequest) => askIn(key, request, null), [askIn]);
  const manage = useMemo<Manage>(() => ({ cwd: runCwd, ops, ask, reloadMods: null }), [runCwd, ops, ask]);
  const runIn = asking?.runIn ?? runCwd;
  const sheet = asking && (
    <ConnectorSheet
      key={`${asking.key}:${asking.opening}`}
      request={asking.request}
      env={{ cwd, runCwd: runIn, engine: asking.engine, configured, retryServers }}
      onConfirm={(request, binary) => {
        setAsking(null);
        // a configuration MAWS removed or replaced: a sign-in's result for that name and scope says nothing about it now
        const { name, scope } = request.input as { name: string; scope: PluginsScope };
        void ops.run(asking.key, request, runIn, binary).then((done) => done?.outcome?.ok && forgetSignIn({ name, scope, cwd }));
      }}
      onClose={() => setAsking(null)}
    />
  );
  return { manage, sheet, askIn };
}

// A confirmation asked for, run in `runIn` when given (a removal from a parent directory's .mcp.json), else the page's.
type AskIn = (key: string, request: PluginsRequest, runIn: string | null) => void;

export function ConnectorsSection({ cwd, place, servers, readAt, configured, inventoryState, refresh, attached, live }: {
  cwd: string | null; // the page's directory; null for the user configuration
  place: string | null; // the page's name for "Open a session in <place>"
  servers: readonly CustomizationServer[] | undefined; // the inventory's, once read
  readAt: number; // when the inventory last answered
  configured: ConfiguredServers; // the same read as Add needs it: whole, or why not
  inventoryState: ReactNode; // reading, failed (with Retry), or the warnings
  refresh(): void;
  attached: AppSessionId | null; // the page's attached session
  live: ReactNode; // what the attached session has live
}) {
  const [view, setView] = useState<LibraryTab>('myItems');
  const { manage, sheet, askIn } = useConnectorManage(cwd, configured, refresh);
  const switcher = <LibrarySwitch tab={view} onChange={setView} second={DISCOVER.discover} />;
  return (
    <ManageProvider value={manage}>
      {view === 'discover' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div data-customize-toolbar="mcp" className="mb-3 flex flex-wrap items-center gap-2 px-2">
            {switcher}
            <DiscoverToolbar tab="connectors" />
          </div>
          <ConnectorsDiscover cwd={cwd} onOpenInstalled={() => setView('myItems')} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <div data-customize-toolbar="mcp" className="mb-2 flex flex-wrap items-center gap-2">
            {switcher}
            <h2 className="m-0 text-ui font-medium">{C.configured}</h2>
            <button type="button" className={`${BUTTON} ml-auto`} onClick={refresh}>
              {C.refresh}
            </button>
          </div>
          {inventoryState}
          {servers && <Configured servers={servers} readAt={readAt} cwd={cwd} place={place} attached={attached} askIn={askIn} />}
          {live}
        </div>
      )}
      {sheet}
    </ManageProvider>
  );
}

// Discover's connectors; with no copy of Anthropic's directory at all, its words and Retry in the list's place.
function ConnectorsDiscover({ cwd, onOpenInstalled }: { cwd: string | null; onOpenInstalled(item: CatalogItem): void }) {
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
  return <DiscoverPane tab="connectors" cwd={cwd} onOpenInstalled={onOpenInstalled} />;
}

// The configured servers, with a removal's result kept at the head once its row has left.
function Configured({ servers, readAt, cwd, place, attached, askIn }: { servers: readonly CustomizationServer[]; readAt: number; cwd: string | null; place: string | null; attached: AppSessionId | null; askIn: AskIn }) {
  const { ops } = useManage();
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
  const postureOf = (server: CustomizationServer) => postures?.find((p) => p.name === server.name && p.scope === server.scope && p.path === server.path) ?? null;
  // a sign-in that ended: the attached session's servers read again
  const ended = useSignIns((s) => [...s.byServer.values()].filter(({ event }) => event.state === 'done' || event.state === 'failed').map(({ event }) => event.opId).join(','));
  const { refetch } = read;
  useEffect(() => {
    if (ended !== '') refetch();
  }, [ended, refetch]);
  const present = new Set(servers.map(serverKey));
  const gone = [...ops.entries.entries()].filter(([key, entry]) => key.startsWith('connector:') && entry.request.action === 'mcp-remove' && !present.has(key));
  if (servers.length === 0 && gone.length === 0) return <p className="m-0 px-2 text-ui-sm text-fg-muted">{C.none}</p>;
  return (
    <>
      {gone.map(([key, entry]) => (
        <Gone key={key} opKey={key} name={(entry.request.input as { name?: string }).name ?? ''} data={{ 'data-connector-gone': key }} />
      ))}
      <ul aria-label={C.configured} className="m-0 list-none p-0">
        {servers.map((server) => (
          <ServerRow key={serverKey(server)} server={server} askIn={askIn} shadow={shadowedBy(server, servers)} cwd={cwd} place={place} session={server.scope === 'app' ? ownSignInSessionOf(server.name, ready, attached, cwd) : signInSessionOf(server.scope, ready, attached, cwd)} live={liveOf(server.name)} liveRead={liveRead} posture={postureOf(server)?.authPosture ?? null} fingerprint={postureOf(server)?.fingerprint ?? null} revision={postureOf(server)?.revision ?? null} />
        ))}
      </ul>
    </>
  );
}

// A row the engine does not use (the same name in a scope it ranks higher, or MAWS's own server of the name; ./present.ts
// `shadowedBy`) says which entry
// shadows it and offers no Sign in: the engine signs a name in, so Sign in belongs to the row it uses.
// U11a M8: a row of MAWS's own list is a dynamic connector to the sign-in, offered only with its configuration's revision.
function ServerRow({ server, askIn, shadow, cwd, place, session, live, liveRead, posture, fingerprint, revision }: { server: CustomizationServer; askIn: AskIn; shadow: CustomizationServer['scope'] | null; cwd: string | null; place: string | null; session: string | null; live: SignInFacts['live']; liveRead: SignInFacts['liveRead']; posture: AuthPosture | null; fingerprint: string | null; revision: string | null }) {
  const { ops } = useManage();
  const own = server.scope === 'app';
  const target = server.scope === 'app' ? null : { name: server.name, scope: server.scope, cwd, path: server.path };
  const kept: Omit<SignInServer, 'machine'> | null = own ? (signsInDynamic(server.name) ? { name: server.name, scope: 'dynamic', cwd: null } : null) : target;
  // P5 O7 M5c: the result of the machine its Sign in runs on (a session's address names it; none, this Mac)
  const machine = signInMachineOf(session);
  const record = resultFor(useSignIns((s) => (kept === null ? null : (s.byServer.get(signInKeyOf({ ...kept, machine })) ?? null))), fingerprint);
  const last = record?.event ?? null;
  const state: SignInView | null = shadow !== null ? { text: shadowWords(shadow, server.name), tone: 'muted', signIn: false, cancel: false } : signInViewOf({ live, liveRead, posture, last: record, transport: server.transport });
  const key = serverKey(server);
  const remove = removeRequestOf(server);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  return (
    <li data-connector={server.name} data-connector-scope={server.scope} className="flex min-w-0 flex-col gap-1 border-b border-border px-2 py-2 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium [overflow-wrap:anywhere]">{server.name}</span>
        <span className="text-ui-sm text-fg-muted">{[C.scopeOf(server.scope), server.transport].filter(Boolean).join(' · ')}</span>
        {state?.text && (
          <span data-sign-in-state className={`text-ui-sm ${TONE[state.tone]}`}>
            {state.text}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-baseline gap-1">
          {state?.cancel && last && <TextButton onClick={() => cancelSignIn(last.opId, record!.appSessionId)}>{C.cancel}</TextButton>}
          {state?.signIn &&
            (own ? (
              // U11a M8: only with the revision the press must carry, so it signs in this configuration or nothing
              kept !== null &&
              revision !== null &&
              (session === null ? (
                <span data-sign-in-needs-session className="text-ui-sm text-fg-muted">
                  {C.openSession(null)}
                </span>
              ) : (
                <button type="button" aria-label={C.signInName(server.name)} className={SECONDARY} onClick={() => void startSignInDynamic({ name: server.name, revision }, fingerprint, session as AppSessionId)}>
                  {C.signIn}
                </button>
              ))
            ) : session === null ? (
              <span data-sign-in-needs-session className="text-ui-sm text-fg-muted">
                {C.openSession(server.scope === 'user' ? null : place)}
              </span>
            ) : (
              // offered once main has said which configuration this is, so the result can be tied to it
              target !== null &&
              fingerprint !== null && (
                <button type="button" aria-label={C.signInName(server.name)} className={SECONDARY} onClick={() => void startSignIn(target, fingerprint, session)}>
                  {C.signIn}
                </button>
              )
            ))}
          {remove && (
            <button type="button" aria-label={C.removeName(server.name)} disabled={busy} className={BUTTON} onClick={() => askIn(key, remove, removalDirectoryOf(server))}>
              {C.remove}
            </button>
          )}
        </span>
      </div>
      <span className="font-mono text-ui-sm break-all text-fg-faint">{server.path}</span>
      <div className="text-ui-sm empty:hidden">
        <OperationLine opKey={key} />
      </div>
    </li>
  );
}
