// My items, All (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §E; the child's O-14): one
// scrolling list of what this Mac has for the page's place, with no heading, in three parts:
// 1. the plugins with an installation here or at user scope, by the name their row shows (the library's Filter and Sort
//    do not apply), then MAWS's built-in mods by name;
// 2. every skill of the inventory, by the label its row shows;
// 3. the connectors, by the name each row shows, ties in the inventory's order: the configured ones and (UX wave U11h,
//    docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §E) a plugin's, by its server's name, with
//    the plugin list this list already reads.
// Each row is its kind's own row component with its kind word ("Plugin", "Mod", "Skill", "Connector"), so a plugin's menu,
// a skill's detail and a connector's Sign in and Remove work from here; not drawn: the plugins' loaded line and group
// headings, the skills' groups, the connectors' live list and its sentence, each kind's menus in the head. The page's one
// search narrows each part by its kind's own rule.
// A part is drawn when its read has answered: while the plugin list is out its place is empty; when it fails, its place
// holds the plugins' failure with Retry and the mods under it. The skills and the connectors share the inventory: its
// reading line and its failure stand once, in the skills' place, and its folded notes under the list. The empty state is
// decided by plugins, skills and connectors once every read has answered; the built-in mods are drawn only beside at least
// one such row (ruled point 7). A result whose row has gone (an uninstall's, a removal's, a custom add's that works or
// failed) stands at the head of its kind's part. A plugin's or a skill's detail stands in the list's place, the list kept
// beneath it; Back returns to the list with its scroll and the keyboard on the row it was opened from.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNow } from '../app/use-now';
import { useLayout } from '../stores/layout';
import { LIBRARY as L } from '../widgets/copy';
import { useBuiltInMods } from '../widgets/plugins/builtin-mods';
import { BuiltInModRow, modsMatching, ModsUnavailable } from '../widgets/plugins/BuiltInMods';
import { pluginsOfAll } from '../widgets/plugins/library';
import { Gone, useManage } from '../widgets/plugins/manage';
import { PluginDetail } from '../widgets/plugins/PluginDetail';
import { INSTALLED_PREFIX, installationOf, installedKey, PluginRow } from '../widgets/plugins/PluginRow';
import { usePluginsEnv } from '../widgets/plugins/read';
import { usePluginsLibrary } from '../widgets/PluginsWidget';
import { SkillDetail, SkillItem, skillRowKey } from '../widgets/skills/SkillsLibrary';
import { diskSkillGroups, skillsOfAll, type SkillRow } from '../widgets/skills/skills';
import { ConnectorRow } from './connectors/ConnectorRow';
import { Adding, Removed, useConnectorRowFacts, usePluginList, type ConnectorsAnswer } from './connectors/ConnectorsSection';
import { pluginNameShown, type PluginList } from './connectors/plugin-row';
import { connectorRows, connectorRowsMatching, shownNameOf, type ConnectorRowModel } from './connectors/rows';
import { PAGE } from './copy';
import { usePluginIcons } from './discover/read';
import { DISCOVER } from './discover/copy';
import { InventoryState } from './InventoryState';
import { useCustomizePage } from './page';
import { usePlace, WithoutReload } from './place';

const SECONDARY = 'rounded-md border border-border px-3 py-1 text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';
const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
const clearSearch = () => useCustomizePage.setState({ search: '' });

function Centered({ children, role }: { children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div role={role} className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {children}
    </div>
  );
}

// The plugins' place: out (nothing drawn), failed (its words and Retry), or answered.
type PluginsPart = { state: 'out' } | { state: 'failed'; words: string | null; retry(): void } | { state: 'answered' };

// The row a detail was opened from, for Back.
type Opened = { kind: 'plugin'; id: string } | { kind: 'skill'; key: string };

export function MineAll({ onDetail, toList }: { onDetail(open: boolean): void; toList: number }) {
  const { directory, session, inventory } = usePlace();
  const { ops } = useManage();
  const env = usePluginsEnv();
  const library = usePluginsLibrary(directory, session);
  const { installed, identities, manifests, loadedIds, retryList } = library;
  const marketplaces = library.marketplaces.data?.marketplaces;
  const mods = useBuiltInMods(session?.appSessionId ?? null);
  const search = useCustomizePage((s) => s.search);
  const now = useNow();
  const icons = usePluginIcons(identities, marketplaces);

  const plugins: PluginsPart =
    directory === null
      ? env.state === 'error'
        ? { state: 'failed', words: env.error, retry: () => void env.reread() }
        : { state: 'out' }
      : installed.data
        ? { state: 'answered' }
        : installed.state === 'error'
          ? { state: 'failed', words: installed.error, retry: retryList }
          : { state: 'out' };
  const pluginRows = installed.data ? pluginsOfAll(identities, search) : [];
  const pluginsInError = plugins.state === 'failed' || (installed.data !== undefined && installed.error !== null);
  const listed = installed.data ? new Set(installed.data.plugins.map(installedKey)) : null;
  const uninstalled = listed === null ? [] : [...ops.entries.keys()].filter((key) => key.startsWith(INSTALLED_PREFIX) && !listed.has(key));

  const skillGroups = useMemo(() => (inventory.data ? diskSkillGroups(inventory.data.skills, { invocable: false }) : []), [inventory.data]);
  const skillRows = skillsOfAll(skillGroups, search);
  const pluginList = usePluginList(library);
  const connectors = useMemo(() => (inventory.data ? connectorRows(inventory.data) : []), [inventory.data]);
  const connectorShown = [...connectorRowsMatching(connectors, search, (key) => pluginNameShown(key, pluginList))].sort((a, b) => byName(shownNameOf(a), shownNameOf(b)));

  // What the place holds, whatever the search: the empty state and the mods turn on it, never on what a search keeps.
  const holdsItems = identities.some((identity) => identity.group !== null) || skillGroups.length > 0 || connectors.length > 0;
  // Empty only once every read has answered with nothing and the search is empty: a read in error (a failed refresh over
  // an empty answer among them) has not, and its part's state stands instead; a search over an empty place matches
  // nothing (its mods stay hidden) and says so.
  const searched = search.trim() !== '';
  const nothing = plugins.state === 'answered' && !pluginsInError && inventory.data !== undefined && inventory.error === null && !holdsItems && !searched;
  // The mods stand beside at least one plugin, skill or connector (ruled point 7), and under the plugins' failure (§E).
  const modRows = plugins.state !== 'out' && (holdsItems || pluginsInError) && mods.read.state === 'ready' ? modsMatching(mods.read.rows, search).sort((a, b) => byName(a.name, b.name)) : [];
  const answered = plugins.state !== 'out' && inventory.data !== undefined;
  const nothingMatches = answered && searched && pluginRows.length + modRows.length + skillRows.length + connectorShown.length === 0;

  // a plugin's or a skill's detail in the list's place
  const [opened, setOpened] = useState<Opened | null>(null);
  const pane = useRef<HTMLDivElement>(null);
  const left = useRef<{ row: string; scrollTop: number } | null>(null);
  const open = (next: Opened, row: string) => {
    left.current = { row, scrollTop: pane.current?.scrollTop ?? 0 };
    setOpened(next);
  };
  const back = () => setOpened(null);
  const [listedAt, setListedAt] = useState(toList);
  if (listedAt !== toList) {
    setListedAt(toList); // the view shown or a Show value pressed: the list again
    if (opened !== null) setOpened(null);
  }
  const pluginDetail = opened?.kind === 'plugin' ? (identities.find((identity) => identity.id === opened.id) ?? null) : null;
  const skillDetail = opened?.kind === 'skill' ? (skillGroups.flatMap((group) => group.rows).find((row) => skillRowKey(row) === opened.key) ?? null) : null;
  const showing = pluginDetail !== null || skillDetail !== null;
  useLayoutEffect(() => onDetail(showing), [showing, onDetail]);
  useLayoutEffect(() => () => onDetail(false), [onDetail]);
  useLayoutEffect(() => {
    const from = left.current;
    if (showing || from === null || pane.current === null) return;
    left.current = null;
    setOpened(null); // an item that left the list is not opened again by its return
    pane.current.scrollTop = from.scrollTop;
    (pane.current.querySelector<HTMLElement>(`${from.row} [data-row-open]`) ?? pane.current.closest<HTMLElement>('[data-customize-page]'))?.focus();
  }, [showing]);
  const openPlugin = (id: string) => open({ kind: 'plugin', id }, `[data-plugin-row="${CSS.escape(id)}"]`);
  const openSkill = (row: SkillRow) => open({ kind: 'skill', key: skillRowKey(row) }, `[data-skill-key="${CSS.escape(skillRowKey(row))}"]`); // a name two scopes can share

  const pluginResults = uninstalled.map((key) => {
    const { id, scope } = installationOf(key);
    return <Gone key={key} opKey={key} name={id} data={{ 'data-plugin-result': id, 'data-plugin-scope': scope }} />;
  });
  const connectorResults = (
    <WithoutReload>
      <Adding />
      <Removed rows={connectors} />
    </WithoutReload>
  );

  return (
    <div data-customize-body="all" className="flex min-h-0 flex-1 flex-col px-1 pt-2">
      {pluginDetail && (
        <PluginDetail
          key={pluginDetail.id}
          appSessionId={session?.appSessionId ?? null}
          availability={session?.availability ?? null}
          identity={pluginDetail}
          loaded={session?.loaded ?? null}
          loadedIds={loadedIds}
          reloads={session?.reloads ?? null}
          allowAcquire={session?.allowAcquire ?? false}
          listManifests={manifests}
          marketplaces={marketplaces}
          listError={installed.error}
          backTo={L.myItems}
          onBack={back}
        />
      )}
      {skillDetail && <SkillDetail row={skillDetail} onBack={back} backTo={L.myItems} />}
      <div className={showing ? 'hidden' : 'contents'}>
        <div ref={pane} data-customize-all className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {nothing ? (
            <>
              {pluginResults}
              {connectorResults}
              <Centered>
                <p className="m-0 text-ui font-medium text-fg">{PAGE.emptyTitle}</p>
                <p className="m-0 max-w-sm text-ui-sm text-fg-muted">{PAGE.emptyBody}</p>
                <button type="button" className={SECONDARY} onClick={() => useLayout.getState().openDestination({ kind: 'customize', view: 'discover', show: 'all' })}>
                  {DISCOVER.openDiscover}
                </button>
              </Centered>
            </>
          ) : (
            <>
              <div data-all-part="plugins">
                {plugins.state === 'failed' && (
                  <Centered role="alert">
                    <p className="m-0 text-ui font-medium text-fg">{L.failed}</p>
                    {plugins.words && <p className="m-0 max-w-md text-ui-sm text-fg-muted [overflow-wrap:anywhere]">{plugins.words}</p>}
                    <button type="button" className={SECONDARY} onClick={plugins.retry}>
                      {L.retry}
                    </button>
                  </Centered>
                )}
                {installed.data && installed.error !== null && (
                  <p role="status" className="m-0 px-2 pb-1 text-ui-sm text-warning">
                    {installed.error}
                  </p>
                )}
                {installed.data && manifests.error !== null && (
                  <p role="status" className="m-0 flex flex-wrap items-baseline gap-x-2 px-2 pb-1 text-ui-sm text-warning">
                    <span>{L.manifestsFailed}</span>
                    <span className="min-w-0 text-fg-muted [overflow-wrap:anywhere]">{manifests.error}</span>
                    <button type="button" className="rounded-sm text-fg outline-accent hover:underline focus-visible:outline-2" onClick={manifests.retry}>
                      {L.retry}
                    </button>
                  </p>
                )}
                {pluginResults}
                {pluginRows.length + modRows.length > 0 && (
                  <ul aria-label={PAGE.choice.plugins} className="m-0 list-none p-0">
                    {pluginRows.map((identity) => (
                      <PluginRow key={identity.id} identity={identity} now={now} iconUrl={icons.get(identity.id) ?? null} onOpen={openPlugin} kindWord />
                    ))}
                    {modRows.map((row) => (
                      <BuiltInModRow key={row.id} row={row} mods={mods} appSessionId={session?.appSessionId ?? null} kindWord />
                    ))}
                  </ul>
                )}
                {plugins.state !== 'out' && (holdsItems || pluginsInError) && mods.read.state === 'unavailable' && <ModsUnavailable read={mods.read} />}
              </div>
              <div data-all-part="skills">
                <InventoryState error={inventory.error} pending={inventory.isPending} refresh={() => void inventory.refetch()} />
                {skillRows.length > 0 && (
                  <ul aria-label={PAGE.choice.skills} className="m-0 list-none p-0">
                    {skillRows.map((row) => (
                      <SkillItem key={skillRowKey(row)} row={row} onOpen={openSkill} kindWord />
                    ))}
                  </ul>
                )}
              </div>
              <div data-all-part="connectors">
                {connectorResults}
                {inventory.data && connectorShown.length > 0 && <AllConnectors inventory={inventory.data} pluginList={pluginList} readAt={inventory.dataUpdatedAt} rows={connectorShown} />}
              </div>
              {nothingMatches && (
                <Centered role="status">
                  <p className="m-0 text-ui text-fg-muted">{L.noMatch}</p>
                  <button type="button" className={SECONDARY} onClick={clearSearch}>
                    {L.resetFilters}
                  </button>
                </Centered>
              )}
            </>
          )}
          <InventoryState error={null} pending={false} warnings={inventory.data?.warnings} pluginServers={inventory.data?.pluginServers} refresh={() => void inventory.refetch()} />
        </div>
      </div>
    </div>
  );
}

// The connectors' rows under All: each the Connectors list's own row, with the same facts beside it, ending in its word.
function AllConnectors({ inventory, pluginList, readAt, rows }: { inventory: ConnectorsAnswer; pluginList: PluginList; readAt: number; rows: readonly ConnectorRowModel[] }) {
  const { cwd, name, attached, askIn } = usePlace();
  const rowFacts = useConnectorRowFacts({ inventory, pluginList, readAt, cwd, attached });
  return (
    <WithoutReload>
      <ul aria-label={PAGE.choice.connectors} className="m-0 list-none p-0">
        {rows.map((row) => (
          <ConnectorRow key={row.key} row={row} askIn={askIn} cwd={cwd} place={name} {...rowFacts(row)} kindWord />
        ))}
      </ul>
    </WithoutReload>
  );
}
