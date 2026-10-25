// D6 / UX2-K: one app destination, with disk configuration independent of session lifetime.
import { Tabs } from 'radix-ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { CommandOutput } from '@shared/ipc/schema';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import { CUSTOMIZATION_INVENTORY_COVERAGE } from '@shared/ipc/schema/customization';
import { ipc } from '../ipc/client';
import { IpcCommandError } from '../ipc/query';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { projectLabels } from '../sidebar/project-labels';
import { displayTitle } from '../sessions/title';
import { PluginsLibrary } from '../widgets/PluginsWidget';
import { usePluginsEnv } from '../widgets/plugins/read';
import { SearchField, Choice, LibrarySwitch, type LibraryTab } from '../widgets/plugins/LibraryHeader';
import { DISCOVER } from './discover/copy';
import { DiscoverToolbar } from './discover/DiscoverToolbar';
import { SkillsDiscover, SkillsManage } from './discover/SkillsDiscover';
import { SortIcon } from '../app/IconButton';
import { SkillsLibrary } from '../widgets/skills/SkillsLibrary';
import { hasPluginSkills, skillsView, type SkillGroup } from '../widgets/skills/skills';
import { useLibraryStore } from '../widgets/plugins/library-store';
import { McpBody, present } from '../widgets/McpWidget';
import { useEngineRead } from '../widgets/read';
import { LIBRARY, SKILLS_LIBRARY } from '../widgets/copy';
import { homeAbbreviated } from '../tools/session-info/model';
import { useCustomizeProject, type CustomizeSection } from './open';
import { ConnectorsSection } from './connectors/ConnectorsSection';
import { CONNECTORS } from './connectors/copy';
import { configuredOf } from './connectors/present';

const DIRECTORY_PAGE = '\0directory'; // the selector's value for a directory page: no project id or '' can equal it
const SECTIONS = { plugins: 'Plugins', skills: 'Skills', mcp: 'Connectors' } as const; // P4-AGG M4: the value `mcp` stays, so saved tabs keep working
const BUTTON = 'rounded-sm px-2 py-1 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';
type Inventory = CommandOutput<'customization.inventory'>;

export function CustomizeView({ section }: { section: CustomizeSection }) {
  // Once visited, keep cwd-scoped plugin operations and their confirmation sheets alive across section switches.
  const [visitedPlugins, setVisitedPlugins] = useState(section === 'plugins');
  if (section === 'plugins' && !visitedPlugins) setVisitedPlugins(true);
  // P4-AGG M3: Skills too, since its Discover runs changes (an add, then an install) that must outlive a section switch
  const [visitedSkills, setVisitedSkills] = useState(section === 'skills');
  if (section === 'skills' && !visitedSkills) setVisitedSkills(true);
  // P4-AGG M4: Connectors too (an add or a removal runs on, its line kept, across a section switch)
  const [visitedConnectors, setVisitedConnectors] = useState(section === 'mcp');
  if (section === 'mcp' && !visitedConnectors) setVisitedConnectors(true);
  const projects = useSessions((s) => s.projects);
  const records = useSessions((s) => s.records);
  const engine = useSessions((s) => s.engine);
  const current = useLayout((s) => s.main.current);
  const chosen = useCustomizeProject((s) => s.projectId);
  // a directory no project has as its own (Open Discover from a session there, Decision Log 10): the page is that directory
  const directory = useCustomizeProject((s) => s.directory);
  const projectId = chosen === undefined ? (current === NO_PROJECT ? null : current) : chosen;
  const project = directory === undefined && projectId ? projects.get(projectId) : undefined;
  const cwd = directory ?? project?.directory ?? null;
  const labels = useMemo(() => projectLabels([...projects.values()]), [projects]);
  // Attach only a ready process in exactly the chosen directory. Project membership alone would also match a worktree
  // with different local configuration. A page never acquires a session, including after an attached process exits.
  const live = [...engine.values()].filter((status) => status.process === 'ready' && cwd !== null && status.cwd === cwd)
    .sort((a, b) => a.appSessionId.localeCompare(b.appSessionId));
  const [pickedSession, setPickedSession] = useState<AppSessionId | null>(null);
  const attached = live.find((status) => status.appSessionId === pickedSession) ?? live[0] ?? null;
  const client = useQueryClient();
  // every CLI change the runner makes (an MCP server added or removed among them) reads the configuration again
  useEffect(() => ipc.on('plugins.changed', () => void client.invalidateQueries({ queryKey: ['maws', 'customization.inventory'] })), [client]);
  const inventory = useQuery({
    queryKey: ['maws', 'customization.inventory', { cwd }],
    queryFn: async () => {
      const answer = await ipc.invoke('customization.inventory', { cwd });
      if (!answer.ok) throw new IpcCommandError(answer.error);
      return answer.value;
    },
  });
  const selectSection = (next: string) => useLayout.getState().openTab({ kind: 'customize', section: next as CustomizeSection });
  const setProject = (value: string) => {
    if (value === DIRECTORY_PAGE) return;
    useCustomizeProject.setState({ projectId: value === '' ? null : value as ProjectId }, true);
    setPickedSession(null);
  };
  const liveScope = attached && <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-ui-sm text-fg-muted">
    <span className="shrink-0">Live session</span>
    <select aria-label="Live session" value={attached.appSessionId} onChange={(event) => setPickedSession(event.target.value as AppSessionId)} className="max-w-64 min-w-0 rounded-sm border border-border bg-bg-raised px-2 py-1 text-fg outline-accent focus-visible:outline-2 @max-sm/customize:max-w-full @max-sm/customize:flex-1">
      {live.map((status) => <option key={status.appSessionId} value={status.appSessionId}>{records.has(status.appSessionId) ? displayTitle(records.get(status.appSessionId)!) : status.appSessionId}</option>)}
    </select>
  </label>;
  return <Tabs.Root value={section} onValueChange={selectSection} className="@container/customize flex h-full min-h-0 flex-col bg-bg text-ui text-fg">
    <header data-customize-header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-1.5">
      <h1 className="m-0 shrink-0 text-ui font-semibold">Customize</h1>
      <Tabs.List aria-label="Customize sections" className="flex flex-wrap gap-1">
        {(Object.entries(SECTIONS) as [CustomizeSection, string][]).map(([value, label]) => <Tabs.Trigger key={value} value={value} className="rounded-sm px-3 py-1.5 text-ui text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2 data-[state=active]:bg-bg-active data-[state=active]:font-medium data-[state=active]:text-fg">{label}</Tabs.Trigger>)}
      </Tabs.List>
      <label className="ml-auto flex min-w-0 max-w-full items-center gap-2 text-ui-sm text-fg-muted @max-sm/customize:ml-0 @max-sm/customize:w-full">
        <span className="shrink-0">Showing</span>
        <select aria-label="Project" value={directory !== undefined ? DIRECTORY_PAGE : (project?.id ?? '')} onChange={(event) => setProject(event.target.value)} className="max-w-64 min-w-0 rounded-sm border border-border bg-bg-raised px-2 py-1 text-ui text-fg outline-accent focus-visible:outline-2 @max-sm/customize:max-w-full @max-sm/customize:flex-1">
          <option value="">User configuration</option>
          {directory !== undefined && <option value={DIRECTORY_PAGE}>{homeAbbreviated(directory)}</option>}
          {[...projects.values()].sort((a, b) => a.name.localeCompare(b.name)).map((item) => <option key={item.id} value={item.id}>{labels.get(item.id)}</option>)}
        </select>
      </label>
    </header>
    <Tabs.Content value="plugins" forceMount={visitedPlugins ? true : undefined} className="flex min-h-0 flex-1 flex-col px-1 pt-2 outline-none data-[state=inactive]:hidden">
      <DirectoryPlugins key={cwd ?? 'user'} cwd={cwd} appSessionId={attached?.appSessionId ?? null} scope={section === 'plugins' ? liveScope : null} />
    </Tabs.Content>
    <Tabs.Content value="skills" forceMount={visitedSkills ? true : undefined} className="flex min-h-0 flex-1 flex-col p-3 outline-none data-[state=inactive]:hidden">
      <SkillsSection key={cwd ?? 'user'} cwd={cwd} inventory={inventory} scope={liveScope} />
    </Tabs.Content>
    <Tabs.Content value="mcp" forceMount={visitedConnectors ? true : undefined} className="flex min-h-0 flex-1 flex-col pt-3 outline-none data-[state=inactive]:hidden">
      <ConnectorsSection
        key={cwd ?? 'user'}
        cwd={cwd}
        place={project?.name ?? (cwd === null ? null : homeAbbreviated(cwd))}
        servers={inventory.data?.servers}
        readAt={inventory.dataUpdatedAt}
        configured={configuredOf(inventory)}
        inventoryState={<InventoryState error={inventory.error} pending={inventory.isPending} warnings={inventory.data?.warnings} refresh={() => void inventory.refetch()} />}
        refresh={() => void inventory.refetch()}
        attached={attached?.appSessionId ?? null}
        live={attached ? <LiveConnectors appSessionId={attached.appSessionId} scope={section === 'mcp' ? liveScope : null} /> : <p className="mt-4 px-2 text-ui-sm text-fg-muted">{CONNECTORS.noLive}</p>}
      />
    </Tabs.Content>
  </Tabs.Root>;
}

function DirectoryPlugins({ cwd, appSessionId, scope }: { cwd: string | null; appSessionId: AppSessionId | null; scope: ReactNode }) {
  const env = usePluginsEnv();
  const directory = cwd ?? env.data?.configHome;
  if (!directory) return <InventoryState error={env.error ? new Error(env.error) : null} pending={env.state === 'loading'} refresh={() => void env.reread()} />;
  return <PluginsLibrary cwd={directory} appSessionId={appSessionId} scope={scope} discover={{ cwd }} />;
}

function InventoryState({ error, pending, warnings, refresh }: { error: Error | null; pending: boolean; warnings?: string[]; refresh(): void }) {
  const failures = warnings?.filter((warning) => warning !== CUSTOMIZATION_INVENTORY_COVERAGE) ?? [];
  return <>
    {pending && <p role="status" className="m-0 p-2 text-ui-sm text-fg-muted">Reading configuration…</p>}
    {error && <p role="alert" className="m-0 p-2 text-ui-sm text-danger">{error.message} <button type="button" className={BUTTON} onClick={refresh}>Retry</button></p>}
    {failures.length > 0 && <details className="mb-2 px-2 text-ui-sm text-warning"><summary className="rounded-sm outline-accent focus-visible:outline-2">Some configuration could not be read</summary><ul>{failures.map((warning, index) => <li key={index} className="[overflow-wrap:anywhere]">{warning}</li>)}</ul></details>}
    {warnings?.includes(CUSTOMIZATION_INVENTORY_COVERAGE) && <details className="mb-2 px-2 text-ui-sm text-fg-muted"><summary className="rounded-sm outline-accent focus-visible:outline-2">Inventory coverage</summary><p className="my-1 [overflow-wrap:anywhere]">{CUSTOMIZATION_INVENTORY_COVERAGE}</p></details>}
  </>;
}

// Skills' two views (P4-AGG M3): My items, the skills on disk; Discover, the plugins whose skills are known. An item
// Discover shows installed here opens My items searched to its plugin.
function SkillsSection({ cwd, inventory, scope }: { cwd: string | null; inventory: ReturnType<typeof useQuery<Inventory, Error>>; scope: ReactNode }) {
  const [view, setView] = useState<LibraryTab>('myItems');
  const switcher = <LibrarySwitch tab={view} onChange={setView} second={DISCOVER.discover} />;
  const refresh = () => void inventory.refetch();
  const toolbar = (
    <div data-customize-toolbar="skills" className="mb-3 flex flex-wrap items-center gap-2 px-2">
      {switcher}
      <DiscoverToolbar tab="skills" />
      {scope && <div className="ml-auto max-w-full shrink-0 @max-sm/customize:ml-0 @max-sm/customize:w-full">{scope}</div>}
    </div>
  );
  // the management state outlives both views (SkillsManage): a change asked in Discover runs on while My items shows
  return (
    <SkillsManage cwd={cwd}>
      {view === 'discover' ? (
        <>
          {toolbar}
          <SkillsDiscover
            cwd={cwd}
            onOpenInstalled={(item) => {
              const plugin = item.install.kind === 'plugin' ? item.install.pluginName : item.name;
              useLibraryStore.setState((state) => ({ skills: { ...state.skills, search: plugin } }));
              setView('myItems');
            }}
          />
        </>
      ) : (
        <>
          <InventoryState error={inventory.error} pending={inventory.isPending} warnings={inventory.data?.warnings} refresh={refresh} />
          {inventory.data ? <DiskSkills inventory={inventory.data} refresh={refresh} scope={scope} switcher={switcher} /> : <div className="mb-3 px-2">{switcher}</div>}
        </>
      )}
    </SkillsManage>
  );
}

function DiskSkills({ inventory, refresh, scope, switcher }: { inventory: Inventory; refresh(): void; scope: ReactNode; switcher: ReactNode }) {
  const groups = useMemo(() => {
    const result: SkillGroup[] = [];
    for (const [source, group] of [['project', 'here'], ['user', 'yours'], ['plugin', 'added']] as const) {
      const rows = inventory.skills.filter((skill) => skill.source === source).map((skill) => ({ name: skill.name, invocation: null, description: skill.description, source, plugin: skill.plugin, path: skill.path }));
      if (rows.length) result.push({ group, rows });
    }
    return result;
  }, [inventory]);
  const view = useLibraryStore((s) => s.skills);
  const plugins = hasPluginSkills(groups);
  const shown = skillsView(groups, { ...view, sort: plugins ? view.sort : 'name' });
  const [detail, setDetail] = useState(false);
  return <>
    {(!detail || scope) && <div data-customize-toolbar="skills" className="mb-3 flex flex-wrap items-center gap-2 px-2">
      {!detail && <>
        {switcher}
        <SearchField label={SKILLS_LIBRARY.search} value={view.search} onChange={(search) => useLibraryStore.setState((state) => ({ skills: { ...state.skills, search } }))} />
        {plugins && <Choice label={LIBRARY.sortBy} icon={<SortIcon />} value={view.sort} values={['name', 'plugin'] as const} words={SKILLS_LIBRARY.sort} isDefault={view.sort === 'name'} onChange={(sort) => useLibraryStore.setState((state) => ({ skills: { ...state.skills, sort } }))} />}
        <button type="button" className={BUTTON} onClick={refresh}>Refresh</button>
      </>}
      {scope && <div className="ml-auto max-w-full shrink-0 @max-sm/customize:ml-0 @max-sm/customize:w-full">{scope}</div>}
    </div>}
    <SkillsLibrary groups={groups} shown={shown} onDetail={setDetail} />
  </>;
}

function LiveConnectors({ appSessionId, scope }: { appSessionId: AppSessionId; scope: ReactNode }) {
  return <section aria-label="Live connectors" className="mt-5 border-t border-border pt-3">
    <div data-customize-toolbar="mcp" className="mb-2 flex flex-wrap items-center gap-2">
      <h2 className="m-0 text-ui font-medium">{CONNECTORS.live}</h2>
      <div className="ml-auto max-w-full shrink-0 @max-sm/customize:ml-0 @max-sm/customize:w-full">{scope}</div>
    </div>
    <LiveConnectorStatus key={appSessionId} appSessionId={appSessionId} />
  </section>;
}

function LiveConnectorStatus({ appSessionId }: { appSessionId: AppSessionId }) {
  const read = useEngineRead('session.mcpStatus', { appSessionId });
  return <>
    <InventoryState error={read.error ? new Error(read.error) : null} pending={read.state === 'loading'} refresh={read.refetch} />
    {read.data && <McpBody compact view={{ servers: present(read.data).servers.map((server) => ({ ...server, transport: null, command: null })) }} />}
  </>;
}
