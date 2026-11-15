// What each view of Customize draws under the head for a kind (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md,
// M2, "The move, not a rewrite"): the kind's body as its section drew it, moved whole; who mounts it and who holds the
// state above it (the page's one place, ./place.tsx) is what changed. My items: the plugins (the loaded line, the source
// groups, MAWS's built-in mods, a plugin's detail in the list's place), the skills on disk (their groups and detail), the
// configured connectors with what the attached session has live. Discover: that kind's catalog. Until M3 and M4 draw
// their own, All draws what Plugins draws. A body is keyed by the place, so a change of project resets its details.
import { Fragment, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { McpBody, present } from '../widgets/McpWidget';
import { useLibraryStore } from '../widgets/plugins/library-store';
import { usePluginsEnv } from '../widgets/plugins/read';
import { PluginsList, useLibrarySelection, usePluginsLibrary } from '../widgets/PluginsWidget';
import { useEngineRead } from '../widgets/read';
import { SkillsLibrary } from '../widgets/skills/SkillsLibrary';
import { diskSkillGroups, hasPluginSkills, skillsView } from '../widgets/skills/skills';
import { ConnectorsDiscover, ConnectorsMine } from './connectors/ConnectorsSection';
import { CONNECTORS } from './connectors/copy';
import { pluginIdOf } from './discover/add';
import { DiscoverPane } from './discover/DiscoverPane';
import { SkillsDiscover } from './discover/SkillsDiscover';
import type { Inventory } from './inventory';
import { InventoryState } from './InventoryState';
import { openMine } from './open';
import { dropOpenRequest, useCustomizePage, useOpenRequest, type CustomizeShow } from './page';
import { usePlace } from './place';
import type { PageView } from './CustomizeHead';

const clearSearch = () => useCustomizePage.setState({ search: '' });

export function CustomizeBody({ view, show, onDetail, toList }: { view: PageView; show: CustomizeShow; onDetail(open: boolean): void; toList: number }) {
  const { cwd } = usePlace();
  const kind = show === 'all' ? 'plugins' : show; // until M3 (My items) and M4 (Discover) draw All
  return (
    <Fragment key={cwd ?? 'user'}>
      {view === 'discover' ? <DiscoverBody kind={kind} /> : kind === 'plugins' ? <PluginsMine show={show} onDetail={onDetail} toList={toList} /> : kind === 'skills' ? <SkillsMine onDetail={onDetail} toList={toList} /> : <ConnectorsBody />}
    </Fragment>
  );
}

function DiscoverBody({ kind }: { kind: Exclude<CustomizeShow, 'all'> }) {
  const { cwd } = usePlace();
  switch (kind) {
    case 'plugins':
      return (
        <div data-customize-body="plugins" className="flex min-h-0 flex-1 flex-col px-1 pt-2">
          <DiscoverPane tab="plugins" cwd={cwd} onOpenInstalled={(item) => openMine('plugins', { pluginId: pluginIdOf(item) ?? undefined })} />
        </div>
      );
    case 'skills':
      // a card installed here opens My items searched to its plugin
      return (
        <div data-customize-body="skills" className="flex min-h-0 flex-1 flex-col p-3">
          <SkillsDiscover cwd={cwd} onOpenInstalled={(item) => openMine('skills', { search: item.install.kind === 'plugin' ? item.install.pluginName : item.name })} />
        </div>
      );
    case 'connectors':
      return (
        <div data-customize-body="connectors" className="flex min-h-0 flex-1 flex-col pt-3">
          <ConnectorsDiscover cwd={cwd} onOpenInstalled={() => openMine('connectors')} />
        </div>
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
  const groups = useMemo(() => diskSkillGroups(inventory.skills, { invocable: false }), [inventory]);
  const view = useLibraryStore((s) => s.skills);
  const search = useCustomizePage((s) => s.search);
  const plugins = hasPluginSkills(groups);
  const shown = skillsView(groups, { ...view, search, sort: plugins ? view.sort : 'name' });
  const reset = () => {
    clearSearch();
    useLibraryStore.setState((state) => ({ skills: { ...state.skills, sort: 'name' } }));
  };
  return <SkillsLibrary groups={groups} shown={shown} onDetail={onDetail} onReset={reset} toList={toList} />;
}

// My items' connectors, and under them what the attached session has live.
function ConnectorsBody() {
  const { cwd, name, inventory, attached, askIn } = usePlace();
  const search = useCustomizePage((s) => s.search);
  return (
    <div data-customize-body="connectors" className="flex min-h-0 flex-1 flex-col pt-3">
      <ConnectorsMine
        cwd={cwd}
        place={name}
        servers={inventory.data?.servers}
        readAt={inventory.dataUpdatedAt}
        inventoryState={<InventoryState error={inventory.error} pending={inventory.isPending} warnings={inventory.data?.warnings} refresh={() => void inventory.refetch()} />}
        attached={attached}
        askIn={askIn}
        search={search}
        onResetSearch={clearSearch}
        live={attached ? <LiveConnectors appSessionId={attached} /> : <p className="mt-4 px-2 text-ui-sm text-fg-muted">{CONNECTORS.noLive}</p>}
      />
    </div>
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

function LiveConnectorStatus({ appSessionId }: { appSessionId: AppSessionId }) {
  const read = useEngineRead('session.mcpStatus', { appSessionId });
  return (
    <>
      <InventoryState error={read.error ? new Error(read.error) : null} pending={read.state === 'loading'} refresh={read.refetch} />
      {read.data && <McpBody view={{ servers: present(read.data).servers.map((server) => ({ ...server, transport: null, command: null })) }} />}
    </>
  );
}
