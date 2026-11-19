// Customize's head (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D "The head"; the child's
// O-14, "The head, two rows"). First row: the view switch (My items | Discover), and at the right "Showing" with the
// project select and, in My items only (the approved drawing; ruled point 7), "Live session" while a session MAWS runs on
// this Mac is ready in exactly that folder. Second row: "Show:" and its four choices, All, Plugins, Skills, Connectors,
// drawn in the shape the section tabs had (the chosen one on the active background, apart from Discover's bordered
// chips), and at the right the tools of what is shown; none while a plugin's or a skill's detail is open. Pressing the
// view shown, or any Show value, returns a detail to its list. Narrow: the tools take a line of their own under the
// choices, which stay on one line, and fill it (./ToolsLine.tsx); under the `customize` container's 24rem each row stacks.
// How the tools fill a line of their own and only then (the architect's ruling of 2026-11-15): the choices and the tools
// both grow, the choices by 9999 to the tools' 1, so on a shared line the free space goes to the choices (the tools keep
// their content's width, at the line's right end) and on a line of their own the tools, alone, take all of it.
// The tools, per view and Show (§D's table): My items, All: the search ("Search my items"), "New skill…", "Add custom
// connector…" and Refresh; Plugins: the search, Filter, Sort by and the Add menu; Skills: the search, Sort by while a
// plugin brings a skill, "New skill…", Refresh (UX wave U11's skill actions, ./NewSkill.tsx); Connectors: the search ("Search connectors"), "Add custom connector…" and Refresh (U11g's action, which
// stands in My items under Connectors and under All; ruled point 7). Discover: that kind's own tools, the Add menu under
// Plugins; under All, All's own search, Refresh and the catalog's age.
import { useQueryClient } from '@tanstack/react-query';
import { ToggleGroup } from 'radix-ui';
import { useMemo, type ReactNode } from 'react';
import { SortIcon } from '../app/IconButton';
import { LIBRARY, SKILLS_LIBRARY } from '../widgets/copy';
import { AddMenu } from '../widgets/plugins/AddMenu';
import { Choice, LibrarySwitch, PluginsChoices } from '../widgets/plugins/LibraryHeader';
import { useLibraryStore } from '../widgets/plugins/library-store';
import { pluginsReadKey } from '../widgets/plugins/read';
import { diskSkillGroups, hasPluginSkills } from '../widgets/skills/skills';
import { CONNECTORS } from './connectors/copy';
import { CUSTOM_ADD, CUSTOM_ADD_KEY } from './connectors/manage';
import { PAGE } from './copy';
import { DISCOVER } from './discover/copy';
import { DiscoverToolbar } from './discover/DiscoverToolbar';
import { NewSkill } from './NewSkill';
import { useCustomizePage, type CustomizeShow } from './page';
import { usePlace } from './place';
import { ToolsLine } from './ToolsLine';

export type PageView = 'mine' | 'discover';

const BUTTON = 'rounded-sm px-2 py-1 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';
const CHOICE = 'shrink-0 rounded-sm px-3 py-1.5 text-ui text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2 data-[state=on]:bg-bg-active data-[state=on]:font-medium data-[state=on]:text-fg';
const SHOWS: readonly CustomizeShow[] = ['all', 'plugins', 'skills', 'connectors'];

export function CustomizeHead({ view, show, inDetail, onView, onShow, project, live }: {
  view: PageView;
  show: CustomizeShow;
  inDetail: boolean; // a plugin's or a skill's detail is open: no tools
  onView(view: PageView): void; // the view pressed, the one shown included
  onShow(show: CustomizeShow): void; // a Show value pressed, the one shown included
  project: ReactNode; // "Showing" and its select
  live: ReactNode; // "Live session" and its select, or nothing
}) {
  return (
    <header data-customize-header className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-1.5">
      <div data-customize-row="view" className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-2 @max-sm/customize:flex-col @max-sm/customize:items-stretch">
        <span className="shrink-0">
          <LibrarySwitch tab={view === 'mine' ? 'myItems' : 'discover'} onChange={(tab) => onView(tab === 'myItems' ? 'mine' : 'discover')} second={DISCOVER.discover} />
        </span>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2 @max-sm/customize:ml-0 @max-sm/customize:w-full @max-sm/customize:flex-col @max-sm/customize:items-stretch">
          {project}
          {view === 'mine' && live}
        </div>
      </div>
      <div data-customize-row="show" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 @max-sm/customize:flex-col @max-sm/customize:items-stretch">
        <span className="flex shrink-0 grow-[9999] items-center gap-2">
          <span className="text-ui-sm text-fg-muted">{PAGE.show}</span>
          <ToggleGroup.Root
            type="single"
            aria-label={PAGE.showGroup}
            value={show}
            // a press of the value shown emits '' (Radix's single group unpressing it): that value, its list again
            onValueChange={(next) => onShow(next === '' ? show : (next as CustomizeShow))}
            className="flex flex-nowrap items-center gap-1"
          >
            {SHOWS.map((value) => (
              <ToggleGroup.Item key={value} value={value} className={CHOICE}>
                {PAGE.choice[value]}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        </span>
        {!inDetail && (
          <span data-customize-tools className="flex min-w-0 max-w-full grow items-center @max-sm/customize:w-full">
            <Tools view={view} show={show} />
          </span>
        )}
      </div>
    </header>
  );
}

function Tools({ view, show }: { view: PageView; show: CustomizeShow }) {
  const { askIn, openDialog } = usePlace();
  if (view === 'discover') return show === 'plugins' ? <DiscoverToolbar tab="plugins" add={<AddMenu onOpen={openDialog} />} /> : <DiscoverToolbar tab={show} />;
  const addCustom = (
    <button type="button" data-connector-add-custom className={BUTTON} onClick={() => askIn(CUSTOM_ADD_KEY, CUSTOM_ADD, null)}>
      {CONNECTORS.addCustom}
    </button>
  );
  return <MineTools show={show} addCustom={addCustom} />;
}

// My items' tools: the page's one search text (held for the run: `/` focuses it, Esc clears it first) and the kind's actions.
function MineTools({ show, addCustom }: { show: CustomizeShow; addCustom: ReactNode }) {
  const { openDialog } = usePlace();
  const text = useCustomizePage((s) => s.search);
  const search = (label: string) => ({ label, value: text, onChange: (next: string) => useCustomizePage.setState({ search: next }) });
  switch (show) {
    case 'all':
      return (
        <ToolsLine
          search={search(PAGE.searchMine)}
          actions={
            <>
              <NewSkill />
              {addCustom}
              <Refresh plugins />
            </>
          }
        />
      );
    case 'plugins':
      return (
        <ToolsLine
          search={search(LIBRARY.searchPlugins)}
          actions={
            <>
              <PluginsChoices />
              <AddMenu onOpen={openDialog} />
            </>
          }
        />
      );
    case 'skills':
      return (
        <ToolsLine
          search={search(SKILLS_LIBRARY.search)}
          actions={
            <>
              <SkillsSort />
              <NewSkill />
              <Refresh />
            </>
          }
        />
      );
    case 'connectors':
      return (
        <ToolsLine
          search={search(CONNECTORS.search)}
          actions={
            <>
              {addCustom}
              <Refresh />
            </>
          }
        />
      );
  }
}

// Sort by, while a plugin brings a skill (Desktop's rule, as the skills' own head had it); the library store's choice.
function SkillsSort() {
  const { inventory } = usePlace();
  const sort = useLibraryStore((s) => s.skills.sort);
  const plugins = useMemo(() => (inventory.data ? hasPluginSkills(diskSkillGroups(inventory.data.skills, { invocable: false })) : false), [inventory.data]);
  if (!plugins) return null;
  return <Choice label={LIBRARY.sortBy} icon={<SortIcon />} value={sort} values={['name', 'plugin'] as const} words={SKILLS_LIBRARY.sort} isDefault={sort === 'name'} onChange={(next) => useLibraryStore.setState((state) => ({ skills: { ...state.skills, sort: next } }))} />;
}

// Refresh reads the inventory again, and under All the plugin list too.
function Refresh({ plugins = false }: { plugins?: boolean }) {
  const { inventory, directory } = usePlace();
  const client = useQueryClient();
  return (
    <button
      type="button"
      className={BUTTON}
      onClick={() => {
        void inventory.refetch();
        if (plugins && directory !== null) void client.refetchQueries({ queryKey: pluginsReadKey('plugins.list', directory) });
      }}
    >
      {CONNECTORS.refresh}
    </button>
  );
}
