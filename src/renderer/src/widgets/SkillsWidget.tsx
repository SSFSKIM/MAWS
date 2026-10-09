// `/skills` (C11; E8 execution document, M2; P2-B execution document §5.10): the skills library, Claude Desktop's Skills
// section in the library box (X19) with `/plugins`' header vocabulary: the title, then Search skills, Sort by ("Name",
// the default, since the skills dialog carries no dates; "Plugin name") and Reload skills; no My items | Browse switch
// (the engine offers no catalogue of uninstalled skills, and Browse in `/plugins` is where skills arrive, §10 Q5). The
// skills are `get_skills_dialog`'s (2.1.295 answers it before any turn with each skill's source, U3 F4), in My items'
// groups, joined with `plugins.list` and `marketplaces.list` (read as `/plugins` reads them) and the session's loaded
// plugins to find a plugin's skill's plugin; an engine that answers the dialog empty leaves the catalogue's skills, in one
// list. The list waits for the plugin list to answer (or fail) so no row moves under the pointer. Reload skills runs
// `reload_skills` as an operation (`Reloaded · N skills`); the dialog read refetches on its completion, as `useEngineRead`
// does on any `session.operation` naming the session. A session with no ready process gets P2-A's states through
// `WidgetFrame`: "Not read yet." with Load now (or the skills last read, dated, with Refresh), "Starting…", or why it
// cannot start; opening `/skills` reads and starts nothing until Load now is clicked (A §5.6).
import { useContext, useMemo, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { PluginManifestView } from '@shared/ipc/schema/plugins';
import { insertComposerText } from '../composer';
import { useSessionCatalog } from '../stores/catalog';
import { useSessions } from '../stores/sessions';
import { LIBRARY as L, SKILLS_LIBRARY as S, WIDGET_TITLE } from './copy';
import { operationLine, useOperation } from './operation';
import { identitiesOf, installationRef } from './plugins/library';
import { useLibraryStore } from './plugins/library-store';
import { useLoadedPlugins } from '../sessions/observed';
import { usePluginManifests } from './plugins/manifests';
import { usePluginsRead } from './plugins/read';
import { lineFailed, skillsSummary } from './plugins/reload';
import { useEngineRead, WidgetReadPolicyContext } from './read';
import { hasPluginSkills, skillGroups, skillsView } from './skills/skills';
import { SkillsLibrary, SkillsToolbar } from './skills/SkillsLibrary';
import { WidgetFrame } from './WidgetFrame';

const NO_VIEWS: ReadonlyMap<string, PluginManifestView> = new Map();
const SECONDARY = 'rounded-md border border-border px-3 py-1 text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';

export function SkillsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const active = useContext(WidgetReadPolicyContext).mode === 'active';
  const read = useEngineRead('session.getSkillsDialog', { appSessionId });
  const catalog = useSessionCatalog(appSessionId);
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const reload = useOperation(appSessionId, 'session.reloadSkills');
  const line = operationLine(reload.state, skillsSummary);

  // the plugins a plugin's skill comes from: the CLI's listing in the session's directory, as `/plugins` reads it
  const cwd = useSessions((s) => s.engine.get(appSessionId)?.cwd ?? s.records.get(appSessionId)?.directory ?? null);
  const installed = usePluginsRead('plugins.list', cwd);
  const marketplaces = usePluginsRead('marketplaces.list', cwd);
  const loaded = useLoadedPlugins(appSessionId);
  const plugins = installed.data?.plugins;
  const markets = marketplaces.data?.marketplaces;
  const requests = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], NO_VIEWS, null).map(({ representative }) => ({ ...installationRef(representative), lastUpdated: representative.lastUpdated })), [plugins, markets]);
  const { views } = usePluginManifests(cwd, requests); // a plugin's display name, as its My items row shows it
  const loadedIds = useMemo(() => new Set(loaded.plugins.flatMap((p) => (p.source === null ? [] : [p.source]))), [loaded]);
  const identities = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], views, loadedIds), [plugins, markets, views, loadedIds]);
  const listed = !active || cwd === null || (installed.state !== 'loading' && marketplaces.state !== 'loading');

  const groups = useMemo(() => (read.data && listed ? skillGroups(read.data, catalog, loaded.plugins, identities) : null), [read.data, listed, catalog, loaded, identities]);
  const view = useLibraryStore((s) => s.skills);
  const plugin = groups !== null && hasPluginSkills(groups);
  const shown = useMemo(() => (groups === null ? null : skillsView(groups, { search: view.search, sort: plugin ? view.sort : 'name' })), [groups, view, plugin]);
  const [inDetail, setInDetail] = useState(false);

  const use = (name: string) => {
    close();
    insertComposerText(appSessionId, `/${name} `);
  };
  const failed = read.state === 'error';
  const toolbar = inDetail ? null : <SkillsToolbar plugins={plugin} canReload={ready} reloading={reload.state.phase === 'working'} onReload={() => void reload.run({})} />;

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.skills} command="skills" state={failed ? 'ready' : read.state} error={failed ? null : read.error} readAt={read.readAt} close={close} size="library" toolbar={toolbar}>
      {line !== null && (
        <p role="status" className={`m-0 px-2 pb-1 text-ui-sm ${lineFailed(reload.state) ? 'text-danger' : 'text-fg-muted'}`}>
          {line}
        </p>
      )}
      {failed && (
        <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <p className="m-0 text-ui font-medium text-fg">{S.failed}</p>
          {read.error && <p className="m-0 max-w-md text-ui-sm text-fg-muted [overflow-wrap:anywhere]">{read.error}</p>}
          <button type="button" className={SECONDARY} onClick={read.refetch}>
            {L.retry}
          </button>
        </div>
      )}
      {groups !== null && shown !== null && <SkillsLibrary groups={groups} shown={shown} onUse={use} onDetail={setInDetail} />}
    </WidgetFrame>
  );
}
