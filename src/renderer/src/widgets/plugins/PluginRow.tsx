// A row of My items (P2-B execution document §5.4; Claude Desktop's row,
// readable/app-2.16120.0/web/app/v1/c27f32a39-QZ0BG6_X.js:130-293, :325-395, :536-678): the icon tile, the display
// name with "New" and "Disabled", "by <author> · <description>", at the trailing edge the version and the date, and the
// overflow (Turn on or off, Update, Uninstall…), each change through E8's confirm sheet at the representative
// installation's scope. The row is one plugin, whatever its number of installations; a change acts on one installation,
// so its operation key is that installation's (E8's `installedKey`), and a result whose installation left the list is
// drawn by `Gone` beneath the list. An identity with no installation here and no user one offers no change and says
// where it is managed. Opening the detail is M4's.
import { DropdownMenu } from 'radix-ui';
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { PLUGINS_SCOPES, type PluginsAction, type PluginsScope } from '@shared/plugins/cli';
import { LIBRARY as L } from '../copy';
import { MoreIcon, PluginGlyph } from './icons';
import { dateWords, displayNameOf, isNew, updatedOf, versionWords, type PluginIdentity } from './library';
import { OperationLine, useManage } from './manage';
import { requestFor } from './present';

type Installation = Pick<InstalledPlugin, 'id' | 'scope' | 'projectPath'>;

export const INSTALLED_PREFIX = 'installed:';
// An installation's identity: the operation key and the listed set's member (E8's, moved from its Installed section).
export const installedKey = (p: Installation) => `${INSTALLED_PREFIX}${JSON.stringify([p.id, p.scope, p.projectPath])}`;
export const installationOf = (key: string): Installation => {
  const [id, scope, projectPath] = JSON.parse(key.slice(INSTALLED_PREFIX.length)) as [string, string, string | null];
  return { id, scope, projectPath };
};
// The installation's own scope where the CLI takes it; a pseudo-scope falls back to user (E8).
const scopeOfRow = (scope: string): PluginsScope => ((PLUGINS_SCOPES as readonly string[]).includes(scope) ? (scope as PluginsScope) : 'user');

const basename = (path: string) => path.slice(path.replace(/\/+$/, '').lastIndexOf('/') + 1) || path;

export function PluginTile() {
  return (
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg-active text-fg-muted">
      <PluginGlyph className="size-4" />
    </span>
  );
}

// A group's heading in the scrolling list, held at the top while its rows pass under it.
export function GroupHeading({ label, count }: { label: string; count?: number }) {
  return (
    <h4 className="sticky top-0 z-10 m-0 flex items-baseline gap-1.5 bg-bg-overlay px-2 pt-3 pb-1 text-ui-sm font-semibold text-fg-muted">
      {label}
      {count !== undefined && <span className="font-normal text-fg-faint">{count}</span>}
    </h4>
  );
}

const BADGE = 'shrink-0 rounded-sm px-1.5 text-ui-sm leading-[18px]';
const ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

function RowMenu({ identity, name, busy }: { identity: PluginIdentity; name: string; busy: boolean }) {
  const { ask } = useManage();
  const target = identity.representative;
  const asking = (action: Extract<PluginsAction, 'update' | 'uninstall' | 'enable' | 'disable'>) => ask(installedKey(target), requestFor(action, { plugin: target.id, scope: scopeOfRow(target.scope) }, null));
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={L.moreActions(name)}
          title={L.moreActions(name)}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active"
        >
          <MoreIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float">
          <DropdownMenu.Item className={ITEM} disabled={busy} onSelect={() => asking(identity.enabledHere ? 'disable' : 'enable')}>
            {identity.enabledHere ? L.turnOff : L.turnOn}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} disabled={busy} onSelect={() => asking('update')}>
            {L.update}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={`${ITEM} text-danger`} disabled={busy} onSelect={() => asking('uninstall')}>
            {L.uninstall}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// Where a plugin with nothing to change from this session is managed: its other project, or how many there are.
function managedWords(identity: PluginIdentity): { text: string; title: string } | null {
  const projects = [...new Set(identity.installations.filter((p) => p.projectPath !== null && !p.here).map((p) => p.projectPath!))];
  if (projects.length === 0) return null;
  return projects.length === 1 ? { text: L.managedIn(basename(projects[0])), title: projects[0] } : { text: L.managedInMany(projects.length), title: projects.join('\n') };
}

export function PluginRow({ identity, now }: { identity: PluginIdentity; now: number }) {
  const { ops } = useManage();
  const target = identity.representative;
  const key = installedKey(target);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  const name = displayNameOf(identity.name, identity.manifest);
  const manifest = identity.manifest;
  const skills = manifest?.state === 'read' ? manifest.components.skills.length : 0;
  const byline = [manifest?.author ? L.by(manifest.author) : null, manifest?.description ?? (skills > 0 ? L.skills(skills) : null)].filter((part): part is string => part !== null);
  const updated = updatedOf(identity);
  const date = dateWords(updated, now);
  const version = versionWords(target.version);
  const actionable = identity.actionable.length > 0;
  const managed = actionable ? null : managedWords(identity);
  return (
    <li data-plugin-row={identity.id} data-plugin-scope={target.scope} className="flex items-center gap-3 border-b border-border px-2 py-2 last:border-b-0">
      <PluginTile />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-fg" title={identity.id}>
            {name}
          </span>
          {isNew(updated, now) && (
            <span title={L.newTooltip} className={`${BADGE} bg-accent-soft text-accent`}>
              {L.isNew}
            </span>
          )}
          {!identity.enabledHere && <span className={`${BADGE} bg-bg-active text-fg-muted`}>{L.disabled}</span>}
        </span>
        {byline.length > 0 && <span className="truncate text-ui-sm text-fg-muted">{byline.join(' · ')}</span>}
        {managed && (
          <span className="truncate text-ui-sm text-fg-muted" title={managed.title}>
            {managed.text}
          </span>
        )}
        {target.errors.map((error, i) => (
          <span key={`e${i}`} className="text-ui-sm text-danger [overflow-wrap:anywhere]">
            {error}
          </span>
        ))}
        <div className="text-ui-sm empty:hidden">
          <OperationLine opKey={key} />
        </div>
      </div>
      {(version !== null || date !== null) && (
        <span className="shrink-0 text-ui-sm text-fg-muted tabular-nums">
          {version}
          {version !== null && date !== null && ' · '}
          {date && (
            <time dateTime={updated ?? undefined} title={date.title}>
              {date.text}
            </time>
          )}
        </span>
      )}
      {actionable ? <RowMenu identity={identity} name={name} busy={busy} /> : <span aria-hidden className="size-7 shrink-0" />}
    </li>
  );
}
