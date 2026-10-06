// Installed (E8 execution document, M2): one row per `claude plugin list --json` entry — `name@marketplace`, its version,
// `scope · enabled|disabled · marketplace`, the enable switch (its position always the last read's), Update and
// Uninstall…; each change asks first. A plugin the change took out of the list keeps its result beneath the rows. One
// id may be installed at several scopes (the user's, a project's, a local one), so a row is an installation: id, scope
// and project path (M2 review); `data-plugin-row` names the id and `data-plugin-scope` the scope. `plugin list` lists
// every project's installations but reports their enabled state as this project sees it, so an installation of another
// project is read-only here: it names its project and offers no action (E8 whole-branch review, round two).
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { PLUGINS_SCOPES, type PluginsAction, type PluginsScope } from '@shared/plugins/cli';
import { PLUGIN_MANAGEMENT as W } from '../copy';
import { Group, Row, Rows, TextButton } from '../parts';
import { Gone, OperationLine, Switch, useManage } from './manage';
import { requestFor } from './present';

type Installation = Pick<InstalledPlugin, 'id' | 'scope' | 'projectPath'>;

const PREFIX = 'installed:';
// The installation's identity: the React key, the operation key and the listed set's member.
const installedKey = (p: Installation) => `${PREFIX}${JSON.stringify([p.id, p.scope, p.projectPath])}`;
const installationOf = (key: string): Installation => {
  const [id, scope, projectPath] = JSON.parse(key.slice(PREFIX.length)) as [string, string, string | null];
  return { id, scope, projectPath };
};

// The row's own scope where the CLI takes it (a plugin installed for the project is changed for the project); a
// pseudo-scope the CLI lists (session, synced) falls back to user.
const scopeOfRow = (scope: string): PluginsScope => ((PLUGINS_SCOPES as readonly string[]).includes(scope) ? (scope as PluginsScope) : 'user');

function InstalledRow({ plugin }: { plugin: InstalledPlugin }) {
  const { ops, ask, cwd } = useManage();
  const key = installedKey(plugin);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  const elsewhere = plugin.projectPath !== null && plugin.projectPath !== cwd ? plugin.projectPath : null;
  const asking = (action: Extract<PluginsAction, 'update' | 'uninstall' | 'enable' | 'disable'>) => ask(key, requestFor(action, { plugin: plugin.id, scope: scopeOfRow(plugin.scope) }, null));
  return (
    <Row
      data-plugin-row={plugin.id}
      data-plugin-scope={plugin.scope}
      main={plugin.id}
      note={plugin.version ?? undefined}
      detail={
        <span className="flex flex-col gap-0.5">
          {/* another project's enabled state is not what this listing reports, so it is not shown */}
          <span>{[plugin.scope, elsewhere !== null ? '' : plugin.enabled ? W.enabled : W.disabled, plugin.marketplace].filter((part) => part !== '').join(' · ')}</span>
          {elsewhere !== null && <span className="break-all">{W.elsewhere(elsewhere)}</span>}
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
        elsewhere === null && (
          <span className="flex shrink-0 items-center gap-1">
            <Switch checked={plugin.enabled} label={W.enabledSwitch(plugin.id)} disabled={busy} onClick={() => asking(plugin.enabled ? 'disable' : 'enable')} />
            <TextButton onClick={() => asking('update')} disabled={busy}>
              {W.update}
            </TextButton>
            <TextButton onClick={() => asking('uninstall')} disabled={busy}>
              {W.uninstall}
            </TextButton>
          </span>
        )
      }
    />
  );
}

export function InstalledSection({ plugins }: { plugins: readonly InstalledPlugin[] }) {
  const { ops } = useManage();
  const listed = new Set(plugins.map(installedKey));
  const gone = [...ops.entries.keys()].filter((key) => key.startsWith(PREFIX) && !listed.has(key));
  return (
    <div data-plugins-section="installed">
      <Group label={W.installed} count={plugins.length}>
        {plugins.length === 0 ? (
          <p className="m-0 text-ui-sm text-fg-muted">{W.noInstalled}</p>
        ) : (
          <Rows label={W.installedList}>
            {plugins.map((plugin) => (
              <InstalledRow key={installedKey(plugin)} plugin={plugin} />
            ))}
          </Rows>
        )}
        {gone.map((key) => {
          const { id, scope } = installationOf(key);
          return <Gone key={key} opKey={key} name={id} data={{ 'data-plugin-result': id, 'data-plugin-scope': scope }} />;
        })}
      </Group>
    </div>
  );
}
