// What Show › "Loaded in this session" adds to My items' rows (P2-B execution document §5.6): the plugin problems the
// engine reported at the last init, and the loaded plugins that are no plugin of the list (the engine's own `@builtin`
// ones, a folder's), each read-only with its credit. `present` reads A's loaded facts (`useLoadedPlugins`).
import { LIBRARY as L, PLUGINS } from '../copy';
import type { LoadedOnly } from './library';
import type { LoadedPlugins } from '../../sessions/observed';
import { GroupHeading, PluginTile } from './PluginRow';

export interface PluginsView {
  plugins: { name: string; version: string | null; source: string | null; path: string }[];
  problems: { plugin: string; level: 'error' | 'warning'; text: string }[];
}

export function present(loaded: Pick<LoadedPlugins, 'plugins' | 'errors' | 'warnings'>): PluginsView {
  return {
    plugins: loaded.plugins.map((p) => ({ name: p.name, version: p.version, source: p.source, path: p.path })),
    problems: [
      ...loaded.errors.map((e) => ({ plugin: e.plugin, level: 'error' as const, text: `${e.type} · ${e.message}` })),
      ...loaded.warnings.map((w) => ({ plugin: w.plugin, level: 'warning' as const, text: `${w.type} · ${w.message}` })),
    ],
  };
}

const CREDIT = { builtin: L.builtIntoClaudeCode, folder: L.loadedFromFolder, other: null } as const;

export function LoadedBody({ problems, extras }: { problems: PluginsView['problems']; extras: readonly LoadedOnly[] }) {
  return (
    <>
      {problems.length > 0 && (
        <section aria-label={PLUGINS.problemList} data-plugins-group="problems">
          <GroupHeading label={PLUGINS.problems} count={problems.length} />
          <ul className="m-0 list-none p-0">
            {problems.map((p, i) => (
              <li key={i} className="flex min-w-0 items-baseline gap-2 border-b border-border px-2 py-1.5 text-ui-sm last:border-b-0">
                <span className="shrink-0 font-medium">{p.plugin}</span>
                <span className={p.level === 'error' ? 'shrink-0 text-danger' : 'shrink-0 text-warning'}>{p.level}</span>
                <span className="min-w-0 text-fg-muted [overflow-wrap:anywhere]">{p.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {extras.length > 0 && (
        <ul aria-label={PLUGINS.loadedList} className="m-0 list-none p-0">
          {extras.map((p) => (
            <LoadedRow key={loadedKey(p)} plugin={p} />
          ))}
        </ul>
      )}
    </>
  );
}

export const loadedKey = (p: LoadedOnly) => `${p.source}:${p.name}`;

// A loaded plugin that is no plugin of the list, read-only with its credit (in LoadedBody's list, or among My items'
// rows under Name sort).
export function LoadedRow({ plugin: p }: { plugin: LoadedOnly }) {
  return (
    <li data-loaded-row={p.source || p.name} className="flex items-center gap-3 border-b border-border px-2 py-2 last:border-b-0">
      <PluginTile />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{p.name}</span>
        <span className="truncate text-ui-sm text-fg-muted">{CREDIT[p.kind] ?? p.source}</span>
      </span>
    </li>
  );
}
