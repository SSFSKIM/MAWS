// My items (P2-B execution document §5.4, §5.6): the installed plugins, one row per plugin, in Desktop's source groups,
// through the library's search, Show and Sort; MAWS's built-in mods last. Desktop's states
// (readable/app-2.16120.0/web/app/v1/c6a2a31c4-DlHruLy-.js:4975-5002, c27f32a39-QZ0BG6_X.js:765-814): nothing but the
// head while the first read runs; "Add your first plugins" when nothing is installed; "Nothing matches these filters."
// with Reset filters; "Couldn't load your plugins." with the read's words and Retry; a later failed read keeps the last
// list with one line saying so (E8's rule). Show › "Loaded in this session" adds the init's problems and the loaded
// plugins that are no row of the list. A change's result whose installation left the list stays beneath it.
import type { ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { useNow } from '../../app/use-now';
import { LIBRARY as L } from '../copy';
import { BuiltInMods } from './BuiltInMods';
import { loadedOnly, myItems, type PluginIdentity } from './library';
import { useLibraryStore } from './library-store';
import type { LoadedPlugins } from './loaded';
import { LoadedBody, present } from './LoadedView';
import { Gone, useManage } from './manage';
import { GroupHeading, INSTALLED_PREFIX, installationOf, installedKey, PluginRow } from './PluginRow';
import type { PluginsReadResult } from './read';

export interface MyItemsProps {
  appSessionId: AppSessionId;
  installed: PluginsReadResult<{ plugins: InstalledPlugin[] }>;
  identities: readonly PluginIdentity[];
  loaded: LoadedPlugins;
  loadedIds: ReadonlySet<string> | null;
  onRetry(): void;
}

function Centered({ children, role }: { children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div role={role} className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {children}
    </div>
  );
}

const SECONDARY = 'rounded-md border border-border px-3 py-1 text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';

export function MyItems({ appSessionId, installed, identities, loaded, loadedIds, onRetry }: MyItemsProps) {
  const { ops } = useManage();
  const view = useLibraryStore((s) => s.plugins);
  const now = useNow();
  const plugins = installed.data?.plugins;

  if (!plugins) {
    return (
      <div data-plugins-section="my-items">
        {installed.state === 'error' && (
          <Centered role="alert">
            <p className="m-0 text-ui font-medium text-fg">{L.failed}</p>
            {installed.error && <p className="m-0 max-w-md text-ui-sm text-fg-muted [overflow-wrap:anywhere]">{installed.error}</p>}
            <button type="button" className={SECONDARY} onClick={onRetry}>
              {L.retry}
            </button>
          </Centered>
        )}
      </div>
    );
  }

  const listed = new Set(plugins.map(installedKey));
  const gone = [...ops.entries.keys()].filter((key) => key.startsWith(INSTALLED_PREFIX) && !listed.has(key));
  const loadedView = view.filter === 'loaded';
  const extras = loadedView ? loadedOnly(loaded.plugins, identities) : [];
  const problems = loadedView ? present(loaded).problems : [];
  const groups = myItems(identities, { ...view, loadedIds });
  const resetFilters = () => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, search: '', filter: 'all' } }));

  let body: ReactNode;
  if (plugins.length === 0 && view.filter === 'all' && view.search.trim() === '') {
    body = (
      <Centered>
        <p className="m-0 text-ui font-medium text-fg">{L.firstTitle}</p>
        <p className="m-0 max-w-sm text-ui-sm text-fg-muted">{L.firstBody}</p>
      </Centered>
    );
  } else if (groups.every((g) => g.rows.length === 0) && extras.length === 0 && problems.length === 0) {
    body = (
      <Centered role="status">
        <p className="m-0 text-ui text-fg-muted">{L.noMatch}</p>
        <button type="button" className={SECONDARY} onClick={resetFilters}>
          {L.resetFilters}
        </button>
      </Centered>
    );
  } else {
    body = (
      <>
        {loadedView && <LoadedBody problems={problems} extras={[]} />}
        {groups.map(({ group, rows }) => (
          <section key={group ?? 'all'} aria-label={group === null ? L.list : L.group[group]} data-plugins-group={group ?? 'all'}>
            {group !== null && <GroupHeading label={L.group[group]} count={rows.length} />}
            {rows.length === 0 ? (
              <p className="m-0 px-2 py-2 text-ui-sm text-fg-muted">{L.noneHere}</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {rows.map((identity) => (
                  <PluginRow key={identity.id} identity={identity} now={now} />
                ))}
              </ul>
            )}
          </section>
        ))}
        {loadedView && <LoadedBody problems={[]} extras={extras} />}
      </>
    );
  }

  return (
    <div data-plugins-section="my-items">
      {installed.error !== null && (
        <p role="status" className="m-0 px-2 pb-1 text-ui-sm text-warning">
          {installed.error}
        </p>
      )}
      {body}
      {view.filter === 'all' && <BuiltInMods appSessionId={appSessionId} search={view.search} />}
      {gone.map((key) => {
        const { id, scope } = installationOf(key);
        return <Gone key={key} opKey={key} name={id} data={{ 'data-plugin-result': id, 'data-plugin-scope': scope }} />;
      })}
    </div>
  );
}
