// Installed (E8 execution document, M2): one row per `claude plugin list --json` entry — `name@marketplace`, its version,
// `scope · enabled|disabled · marketplace`, the enable switch (its position always the last read's), Update and
// Uninstall…; each change asks first. A plugin the change took out of the list keeps its result beneath the rows.
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { PLUGINS_SCOPES, type PluginsAction, type PluginsScope } from '@shared/plugins/cli';
import { PLUGIN_MANAGEMENT as W } from '../copy';
import { Group, Row, Rows, TextButton } from '../parts';
import { Gone, OperationLine, Switch, useManage } from './manage';
import { requestFor } from './present';

const installedKey = (id: string) => `installed:${id}`;

// The row's own scope where the CLI takes it (a plugin installed for the project is changed for the project); a
// pseudo-scope the CLI lists (session, synced) falls back to user.
const scopeOfRow = (scope: string): PluginsScope => (PLUGINS_SCOPES as readonly string[]).includes(scope) ? (scope as PluginsScope) : 'user';

function InstalledRow({ plugin }: { plugin: InstalledPlugin }) {
  const { ops, ask } = useManage();
  const key = installedKey(plugin.id);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  const asking = (action: Extract<PluginsAction, 'update' | 'uninstall' | 'enable' | 'disable'>) => ask(key, requestFor(action, { plugin: plugin.id, scope: scopeOfRow(plugin.scope) }, null));
  return (
    <Row
      data-plugin-row={plugin.id}
      main={plugin.id}
      note={plugin.version ?? undefined}
      detail={
        <span className="flex flex-col gap-0.5">
          <span>{[plugin.scope, plugin.enabled ? W.enabled : W.disabled, plugin.marketplace].filter((part) => part !== '').join(' · ')}</span>
          {plugin.errors.map((error, i) => (
            <span key={`e${i}`} className="text-danger">
              {error}
            </span>
          ))}
          {plugin.notes.map((note, i) => (
            <span key={`n${i}`}>{note}</span>
          ))}
          <OperationLine opKey={key} />
        </span>
      }
      actions={
        <span className="flex shrink-0 items-center gap-1">
          <Switch checked={plugin.enabled} label={W.enabledSwitch(plugin.id)} disabled={busy} onClick={() => asking(plugin.enabled ? 'disable' : 'enable')} />
          <TextButton onClick={() => asking('update')} disabled={busy}>
            {W.update}
          </TextButton>
          <TextButton onClick={() => asking('uninstall')} disabled={busy}>
            {W.uninstall}
          </TextButton>
        </span>
      }
    />
  );
}

export function InstalledSection({ plugins }: { plugins: readonly InstalledPlugin[] }) {
  const { ops } = useManage();
  const listed = new Set(plugins.map((p) => installedKey(p.id)));
  const gone = [...ops.entries.keys()].filter((key) => key.startsWith('installed:') && !listed.has(key));
  return (
    <div data-plugins-section="installed">
      <Group label={W.installed} count={plugins.length}>
        {plugins.length === 0 ? (
          <p className="m-0 text-ui-sm text-fg-muted">{W.noInstalled}</p>
        ) : (
          <Rows label={W.installedList}>
            {plugins.map((plugin) => (
              <InstalledRow key={plugin.id} plugin={plugin} />
            ))}
          </Rows>
        )}
        {gone.map((key) => (
          <Gone key={key} opKey={key} name={key.slice('installed:'.length)} attribute="data-plugin-result" />
        ))}
      </Group>
    </div>
  );
}
