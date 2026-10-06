// `/plugins` (C11 execution document, the widget table; E8 execution document, M2): the plugin-management surface. From
// the top: Reload mods and Reload skills for this session; Installed (`claude plugin list --json`), Marketplaces
// (`claude plugin marketplace list --json`, with Add marketplace), Available (`--available`, read only once its section
// is opened), each change through the engine's own CLI after a confirm sheet (`plugins/`); and "Loaded in this
// session", the plugins the engine loaded, from the latest `system/init` or `reload_plugins` answer as C3's status
// carries them, with the init frame's plugin errors and warnings. The CLI needs no engine process, so a session that is
// not running still manages plugins; only the reloads and the Loaded list need one. The frame's state follows the
// installed-plugins read.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandOutput } from '@shared/ipc/schema';
import { NOT_RUNNING } from '../statusline/mode-menu';
import { useSessions } from '../stores/sessions';
import { PLUGIN_MANAGEMENT, PLUGINS, pluginsFoot, WIDGET_TITLE } from './copy';
import { Group, Mono, Row, Rows } from './parts';
import { AvailableSection } from './plugins/Available';
import { useCallback } from 'react';
import type { EngineResolution } from './plugins/ConfirmSheet';
import { InstalledSection } from './plugins/Installed';
import { ManageProvider, useManageState } from './plugins/manage';
import { MarketplacesSection } from './plugins/Marketplaces';
import { usePluginsEnv, usePluginsRead, type PluginsReadResult } from './plugins/read';
import { ReloadControls, useReloads } from './plugins/reload';
import { WidgetFrame } from './WidgetFrame';

export interface PluginsView {
  plugins: { name: string; version: string | null; source: string | null; path: string }[];
  problems: { plugin: string; level: 'error' | 'warning'; text: string }[];
}

export function present(status: Pick<EngineSessionStatus, 'plugins' | 'pluginErrors' | 'pluginWarnings'>): PluginsView {
  return {
    plugins: status.plugins.map((p) => ({ name: p.name, version: p.version, source: p.source, path: p.path })),
    problems: [
      ...status.pluginErrors.map((e) => ({ plugin: e.plugin, level: 'error' as const, text: `${e.type} · ${e.message}` })),
      ...status.pluginWarnings.map((w) => ({ plugin: w.plugin, level: 'warning' as const, text: `${w.type} · ${w.message}` })),
    ],
  };
}

export function PluginsBody({ view }: { view: PluginsView }) {
  return (
    <div className="flex flex-col">
      {view.problems.length > 0 && (
        <Group label={PLUGINS.problems} count={view.problems.length}>
          <Rows label={PLUGINS.problemList}>
            {view.problems.map((p, i) => (
              <Row key={i} main={p.plugin} note={<span className={p.level === 'error' ? 'text-danger' : 'text-warning'}>{p.level}</span>} detail={p.text} />
            ))}
          </Rows>
        </Group>
      )}
      {view.plugins.length === 0 ? (
        <p className="m-0 text-ui-sm text-fg-muted">{PLUGINS.none}</p>
      ) : (
        <Group label={PLUGINS.loaded} count={view.plugins.length}>
          <Rows label={PLUGINS.loadedList}>
            {view.plugins.map((p) => (
              <Row key={`${p.name}:${p.path}`} main={p.name} note={p.version ?? undefined} detail={<Mono>{p.source ?? p.path}</Mono>} />
            ))}
          </Rows>
        </Group>
      )}
    </div>
  );
}

// The sessions a change reloads: those with a ready process (the host's fan-out targets).
const readyCount = (engine: ReadonlyMap<AppSessionId, EngineSessionStatus>): number => {
  let n = 0;
  for (const status of engine.values()) if (status.process === 'ready') n += 1;
  return n;
};

// `plugins.env`'s read as the sheet and the foot take it: resolved only by an answer that names a binary; an answer
// without one is the probe's refusal in its own words (`binaryError`), and a failed read is the read's refusal.
function resolutionOf(env: PluginsReadResult<CommandOutput<'plugins.env'>>): EngineResolution {
  if (env.data) {
    const { binary, binaryError, configHome, globalConfig } = env.data;
    return binary !== null ? { state: 'ready', env: { binary, configHome, globalConfig } } : { state: 'error', error: binaryError ?? PLUGIN_MANAGEMENT.unresolved };
  }
  return env.state === 'error' ? { state: 'error', error: env.error ?? PLUGIN_MANAGEMENT.unresolved } : { state: 'loading' };
}

export function PluginsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  // the CLI's cwd: the launch's directory (which the host compares for project and local scope), else the record's
  const cwd = useSessions((s) => s.engine.get(appSessionId)?.cwd ?? s.records.get(appSessionId)?.directory ?? null);
  const readySessions = useSessions((s) => readyCount(s.engine));
  const env = usePluginsEnv();
  const { reread } = env;
  const installed = usePluginsRead('plugins.list', cwd);
  const reloads = useReloads(appSessionId);
  const ready = status?.process === 'ready';
  // the binary and the paths are the host's answer, never a guess: the foot shows the last one, and every sheet reads it
  // again and confirms nothing until it names a binary (M2 review; E8 whole-branch review)
  const engine = resolutionOf(env);
  const resolveEngine = useCallback(async () => resolutionOf(await reread()), [reread]);
  const { manage, sheet } = useManageState({ cwd: cwd ?? '', readySessions }, ready ? reloads.reloadMods : null, resolveEngine);
  const plugins = installed.data?.plugins ?? [];
  return (
    <ManageProvider value={manage}>
      <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.plugins} command="plugins" foot={pluginsFoot(engine.state === 'ready' ? engine.env : null)} state={installed.state} error={installed.error} close={close}>
        {ready && (
          <div className="mb-2">
            <ReloadControls reloads={reloads} />
          </div>
        )}
        <InstalledSection plugins={plugins} />
        {cwd !== null && <MarketplacesSection cwd={cwd} installed={plugins} />}
        {cwd !== null && <AvailableSection cwd={cwd} installed={new Set(plugins.map((p) => p.id))} />}
        <section data-plugins-section="loaded" className="mt-3">
          {status && !ready && <p className="m-0 mb-1 text-ui-sm text-fg-muted">{PLUGINS.lastReported}</p>}
          {status ? <PluginsBody view={present(status)} /> : <p className="m-0 text-ui-sm text-fg-muted">{NOT_RUNNING}</p>}
        </section>
      </WidgetFrame>
      {sheet}
    </ManageProvider>
  );
}
