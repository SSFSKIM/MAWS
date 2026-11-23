// What each view of Customize draws under the head for a kind (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md,
// M2, "The move, not a rewrite"): the kind's body as its section drew it, moved whole; who mounts it and who holds the
// state above it (the page's one place, ./place.tsx) is what changed. My items: the plugins (the loaded line, the source
// groups, MAWS's built-in mods, a plugin's detail in the list's place), the skills on disk (their groups and detail), the
// configured connectors with what the attached session has live; All, the one list of the three kinds (./MineAll.tsx, M3).
// Discover: that kind's catalog; All, the kinds' shelves and one grid across them (M4). A body is keyed by the place, so
// a change of project resets its details.
// A detail, My items' or Discover's, is told to the head (`onDetail`) and returns to its list on `toList`.
// Keep means keep (§D): the kinds share the place's one book, and each kind's lines offer what they offered: Reload again
// on a plugin's line alone, as Skills' Discover and the connectors had no session's reload to offer (`WithoutReload`;
// under Discover's All, per card, `KindLines`).
import { Fragment, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { McpBody, MOVES_MCP, present } from '../widgets/McpWidget';
import { useLibraryStore } from '../widgets/plugins/library-store';
import { usePluginsEnv } from '../widgets/plugins/read';
import { PluginsList, useLibrarySelection, usePluginsLibrary } from '../widgets/PluginsWidget';
import { useEngineRead } from '../widgets/read';
import { useSessions } from '../stores/sessions';
import { SkillsLibrary } from '../widgets/skills/SkillsLibrary';
import { skillExtrasOf } from './SkillFile'; // UX wave U11's skill actions
import { diskSkillGroups, hasPluginSkills, skillsView } from '../widgets/skills/skills';
import { ConnectorsDiscover, ConnectorsMine, usePluginList } from './connectors/ConnectorsSection';
import { CONNECTORS } from './connectors/copy';
import { pluginIdOf } from './discover/add';
import { DiscoverPane } from './discover/DiscoverPane';
import { SkillsDiscover } from './discover/SkillsDiscover';
import type { Inventory } from './inventory';
import { InventoryState } from './InventoryState';
import { openMine } from './open';
import { dropOpenRequest, useCustomizePage, useOpenRequest, type CustomizeShow } from './page';
import { usePlace, WithoutReload } from './place';
import type { PageView } from './CustomizeHead';
import { MineAll } from './MineAll';

const clearSearch = () => useCustomizePage.setState({ search: '' });

export function CustomizeBody({ view, show, onDetail, toList }: { view: PageView; show: CustomizeShow; onDetail(open: boolean): void; toList: number }) {
  const { cwd } = usePlace();
  return (
    <Fragment key={cwd ?? 'user'}>
      {view === 'discover' ? (
        <DiscoverBody kind={show} onDetail={onDetail} toList={toList} />
      ) : show === 'all' ? (
        <MineAll onDetail={onDetail} toList={toList} />
      ) : show === 'plugins' ? (
        <PluginsMine show={show} onDetail={onDetail} toList={toList} />
      ) : show === 'skills' ? (
        <SkillsMine onDetail={onDetail} toList={toList} />
      ) : (
        <ConnectorsBody />
      )}
    </Fragment>
  );
}

function DiscoverBody({ kind, onDetail, toList }: { kind: CustomizeShow; onDetail(open: boolean): void; toList: number }) {
  const { cwd } = usePlace();
  switch (kind) {
    case 'all':
      // a card installed here opens My items on its own kind: a plugin on its detail, a connector's list
      return (
        <div data-customize-body="all" className="flex min-h-0 flex-1 flex-col px-1 pt-2">
          <DiscoverPane tab="all" cwd={cwd} onOpenInstalled={(item) => (item.kind === 'connector' ? openMine('connectors') : openMine('plugins', { pluginId: pluginIdOf(item) ?? undefined }))} onDetail={onDetail} toList={toList} />
        </div>
      );
    case 'plugins':
      return (
        <div data-customize-body="plugins" className="flex min-h-0 flex-1 flex-col px-1 pt-2">
          <DiscoverPane tab="plugins" cwd={cwd} onOpenInstalled={(item) => openMine('plugins', { pluginId: pluginIdOf(item) ?? undefined })} onDetail={onDetail} toList={toList} />
        </div>
      );
    case 'skills':
      // a card installed here opens My items searched to its plugin
      return (
        <WithoutReload>
          <div data-customize-body="skills" className="flex min-h-0 flex-1 flex-col p-3">
            <SkillsDiscover cwd={cwd} onOpenInstalled={(item) => openMine('skills', { search: item.install.kind === 'plugin' ? item.install.pluginName : item.name })} onDetail={onDetail} toList={toList} />
          </div>
        </WithoutReload>
      );
    case 'connectors':
      return (
        <WithoutReload>
          <div data-customize-body="connectors" className="flex min-h-0 flex-1 flex-col pt-3">
            <ConnectorsDiscover cwd={cwd} onOpenInstalled={() => openMine('connectors')} onDetail={onDetail} toList={toList} />
          </div>
        </WithoutReload>
      );
  }
}

// My items' plugins, over the folder the CLI runs in (the engine's configuration directory for the user configuration).
function PluginsMine({ show, onDetail, toList }: { show: CustomizeShow; onDetail(open: boolean): void; toList: number }) {
  const { directory } = usePlace();
  const env = usePluginsEnv();
  if (directory === null) return <InventoryState error={env.error ? new Error(env.error) : null} pending={env.state === 'loading'} refresh={() => void env.reread()} />;
  return <PluginsAt directory={directory} show={show} onDetail={onDetail} toList={toList} />;
}

function PluginsAt({ directory, show, onDetail, toList }: { directory: string; show: CustomizeShow; onDetail(open: boolean): void; toList: number }) {
  const { cwd, session } = usePlace();
  const library = usePluginsLibrary(directory, session);
  const selection = useLibrarySelection(library.identities, '[data-customize-page]');
  const { detail, open, close } = selection;
  const text = useCustomizePage((s) => s.search);
  // the view shown or a Show value pressed: the list again
  const [listed, setListed] = useState(toList);
  if (listed !== toList) {
    setListed(toList);
    if (detail !== null) close();
  }
  useLayoutEffect(() => onDetail(detail !== null), [detail, onDetail]);
  useLayoutEffect(() => () => onDetail(false), [onDetail]);
  // `openMine`'s plugin, once this list holds it; another row opened first ends the request
  const request = useOpenRequest((s) => s.request);
  const { identities } = library;
  useEffect(() => {
    if (request === null || request.place !== cwd || request.show !== show || !identities.some((identity) => identity.id === request.pluginId)) return;
    dropOpenRequest();
    open(request.pluginId);
  }, [request, cwd, show, identities, open]);
  const rowSelection = useMemo(
    () => ({
      ...selection,
      open: (id: string) => {
        dropOpenRequest();
        open(id);
      },
    }),
    [selection, open],
  );
  return (
    <div data-customize-body="plugins" className="flex min-h-0 flex-1 flex-col px-1 pt-2">
      <PluginsList library={library} session={session} selection={rowSelection} search={{ text, clear: clearSearch }} />
    </div>
  );
}

// My items' skills: what the configured skill folders hold (the inventory), through the page's search.
function SkillsMine({ onDetail, toList }: { onDetail(open: boolean): void; toList: number }) {
  const { inventory } = usePlace();
  useLayoutEffect(() => () => onDetail(false), [onDetail]);
  return (
    <div data-customize-body="skills" className="flex min-h-0 flex-1 flex-col p-3">
      <InventoryState error={inventory.error} pending={inventory.isPending} warnings={inventory.data?.warnings} refresh={() => void inventory.refetch()} />
      {inventory.data && <DiskSkills inventory={inventory.data} onDetail={onDetail} toList={toList} />}
    </div>
  );
}

function DiskSkills({ inventory, onDetail, toList }: { inventory: Inventory; onDetail(open: boolean): void; toList: number }) {
  const { cwd } = usePlace();
  const extrasOf = useMemo(() => skillExtrasOf(cwd), [cwd]);
  const groups = useMemo(() => diskSkillGroups(inventory.skills, { invocable: false }), [inventory]);
  const view = useLibraryStore((s) => s.skills);
  const search = useCustomizePage((s) => s.search);
  const plugins = hasPluginSkills(groups);
  const shown = skillsView(groups, { ...view, search, sort: plugins ? view.sort : 'name' });
  const reset = () => {
    clearSearch();
    useLibraryStore.setState((state) => ({ skills: { ...state.skills, sort: 'name' } }));
  };
  return <SkillsLibrary groups={groups} shown={shown} onDetail={onDetail} onReset={reset} toList={toList} extrasOf={extrasOf} />;
}

// My items' connectors, and under them what the attached session has live. UX wave U11h (the architect's ruling of
// 2026-11-15): the plugin list is read only where the inventory holds a plugin's connector, so a folder with none pays no
// read; a plugin's row offers Sign in once it has answered.
function ConnectorsBody() {
  const { cwd, directory, session, name, inventory, attached, askIn } = usePlace();
  const search = useCustomizePage((s) => s.search);
  const pluginConnectors = (inventory.data?.pluginServers?.length ?? 0) > 0;
  const pluginList = usePluginList(usePluginsLibrary(pluginConnectors ? directory : null, session));
  return (
    <WithoutReload>
      <div data-customize-body="connectors" className="flex min-h-0 flex-1 flex-col pt-3">
        <ConnectorsMine
          cwd={cwd}
          place={name}
          inventory={inventory.data}
          pluginList={pluginList}
          readAt={inventory.dataUpdatedAt}
          inventoryState={<InventoryState error={inventory.error} pending={inventory.isPending} warnings={inventory.data?.warnings} refresh={() => void inventory.refetch()} />}
          attached={attached}
          askIn={askIn}
          search={search}
          onResetSearch={clearSearch}
          live={attached ? <LiveConnectors appSessionId={attached} /> : <p className="mt-4 px-2 text-ui-sm text-fg-muted">{CONNECTORS.noLive}</p>}
        />
      </div>
    </WithoutReload>
  );
}

function LiveConnectors({ appSessionId }: { appSessionId: AppSessionId }) {
  return (
    <section aria-label="Live connectors" className="mt-5 border-t border-border pt-3">
      <h2 className="m-0 mb-2 text-ui font-medium">{CONNECTORS.live}</h2>
      <LiveConnectorStatus key={appSessionId} appSessionId={appSessionId} />
    </section>
  );
}

// The word cut (P565): read again as the session's MCP table moves, as the dialog reads, so a connecting connector's
// quiet spinner ends with the connection; over a process no longer ready it is the last answer's words.
function LiveConnectorStatus({ appSessionId }: { appSessionId: AppSessionId }) {
  const read = useEngineRead('session.mcpStatus', { appSessionId }, { refreshOn: MOVES_MCP });
  const live = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  return (
    <>
      <InventoryState error={read.error ? new Error(read.error) : null} pending={read.state === 'loading'} refresh={read.refetch} />
      {read.data && <McpBody view={{ servers: present(read.data).servers.map((server) => ({ ...server, transport: null, command: null })) }} live={live} />}
    </>
  );
}
