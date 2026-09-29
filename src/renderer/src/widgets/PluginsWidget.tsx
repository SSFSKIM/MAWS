// `/plugins` (C11 execution document, the widget table): the plugins the engine loaded, from the latest `system/init`
// as C3's status carries them (name, version, source, path), with the init frame's plugin errors and warnings. The
// enable state lives in settings (`enabledPlugins`) and the terminal's `/plugins`; the widget shows what loaded. M2 is
// the read half; M3 adds Reload as an operation.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../stores/sessions';
import { NO_PLUGINS, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Group, Mono, Row, Rows } from './parts';
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
        <Group label="Problems" count={view.problems.length}>
          <Rows label="Plugin problems">
            {view.problems.map((p, i) => (
              <Row key={i} main={p.plugin} note={<span className={p.level === 'error' ? 'text-danger' : 'text-warning'}>{p.level}</span>} detail={p.text} />
            ))}
          </Rows>
        </Group>
      )}
      {view.plugins.length === 0 ? (
        <p className="m-0 text-ui-sm text-fg-muted">{NO_PLUGINS}</p>
      ) : (
        <Group label="Loaded" count={view.plugins.length}>
          <Rows label="Loaded plugins">
            {view.plugins.map((p) => (
              <Row key={`${p.name}:${p.path}`} main={p.name} note={p.version ?? undefined} detail={<Mono>{p.source ?? p.path}</Mono>} />
            ))}
          </Rows>
        </Group>
      )}
    </div>
  );
}

// No read: the status is C3's and already held, so only a session that never reported one is not running here.
export function PluginsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.plugins} command="plugins" foot={WIDGET_FOOT.plugins} state={status ? 'ready' : 'not_running'} error={null} close={close}>
      {status && <PluginsBody view={present(status)} />}
    </WidgetFrame>
  );
}
