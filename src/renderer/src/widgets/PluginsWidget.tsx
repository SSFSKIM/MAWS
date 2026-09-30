// `/plugins` (C11 execution document, the widget table): the plugins the engine loaded, from the latest `system/init`
// as C3's status carries them (name, version, source, path), with the init frame's plugin errors and warnings. The
// enable state lives in settings (`enabledPlugins`) and the terminal's `/plugins`; the widget shows what loaded. Reload
// is `reload_plugins` as an operation (session-only for configuration): `Working…` from the receipt, then the reload
// summarised, or the error in words with the list as it was; the list itself follows the next init frame.
import * as z from 'zod';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../stores/sessions';
import { PLUGINS, RELOAD, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { operationLine, useOperation } from './operation';
import { Group, Mono, Row, Rows, TextButton } from './parts';
import { WidgetFrame } from './WidgetFrame';

// `reload_plugins`'s value: the refreshed lists and the error count (SPEC 45 §45.17:4207).
const ReloadValueSchema = z.looseObject({ commands: z.array(z.unknown()), agents: z.array(z.unknown()), plugins: z.array(z.unknown()), error_count: z.number() });

export const reloadSummary = (value: unknown): string => {
  const parsed = ReloadValueSchema.safeParse(value);
  return parsed.success ? RELOAD.reloaded(parsed.data.commands.length, parsed.data.agents.length, parsed.data.plugins.length, parsed.data.error_count) : RELOAD.done;
};

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

// No read: the status is C3's and already held, so only a session that never reported one is not running here.
export function PluginsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const reload = useOperation(appSessionId, 'session.reloadPlugins');
  const line = operationLine(reload.state, reloadSummary);
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.plugins} command="plugins" foot={WIDGET_FOOT.plugins} state={status ? 'ready' : 'not_running'} error={null} close={close}>
      {status && status.process !== 'ready' && <p className="m-0 mb-1 text-ui-sm text-fg-muted">{PLUGINS.lastReported}</p>}
      {status?.process === 'ready' && (
        <div className="mb-2 flex items-baseline gap-2">
          <TextButton onClick={() => void reload.run({})} disabled={reload.state.phase === 'working'}>
            {RELOAD.reload}
          </TextButton>
          {line !== null && (
            <span role="status" className="min-w-0 text-ui-sm text-fg-muted">
              {line}
            </span>
          )}
        </div>
      )}
      {status && <PluginsBody view={present(status)} />}
    </WidgetFrame>
  );
}
