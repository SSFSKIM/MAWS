// A row of My items (P2-B execution document §5.4; Claude Desktop's row,
// readable/app-2.16120.0/web/app/v1/c27f32a39-QZ0BG6_X.js:130-293, :325-395, :536-678): the image (UX wave U11c: the
// directory's icon, which the list reads for its rows, else the plugin's letter tile), the display name with "New",
// "by <author>", at the trailing edge the version, the switch and the overflow (Update, Uninstall…), each change through
// E8's confirm sheet at the representative installation's scope. The word cut (G215, G216, G218, P683; the owner's
// answer of 2026-11-16, ruled for All on 2026-11-20): that is the row at rest; its description (or, with none, its
// skills counted) and its date are its row note, shown on pointing or focus and the row's description at all times; the
// switch stands where "Disabled" and the menu's Turn on or off stood, greyed with where the plugin is managed when this
// session cannot change it. The row is one plugin, whatever its number of installations; a change acts on one installation,
// so its operation key is that installation's (E8's `installedKey`), and a result whose installation left the list is
// drawn by `Gone` beneath the list. An identity with no installation here and no user one offers no change and says
// where it is managed. The whole row is one target, "View <name>", opening the detail (M4): a button under the row's
// content, which sits above it so its tooltips show, a click on it still opening the detail; the row's own controls (the
// overflow, an operation's Stop or Reload again, the menu's items) keep their clicks.
// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, C2): on Customize's page, whose one book
// holds what Discover started too, a row with no line of its own draws the line of a Discover install of its plugin.
import { DropdownMenu } from 'radix-ui';
import { RowNote, useRowNote } from '../../ui/row-note';
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { PLUGINS_SCOPES, type PluginsAction, type PluginsScope } from '@shared/plugins/cli';
import { ItemImage } from '../../customize/image/ItemImage';
import { KindWord } from '../../customize/KindWord';
import { pluginSeedOf } from '../../customize/image/tile';
import { LIBRARY as L } from '../copy';
import { MoreIcon } from './icons';
import { basename, dateWords, displayNameOf, isNew, updatedOf, versionWords, type PluginIdentity } from './library';
import { CATALOG_KEY } from '../../customize/discover/add';
import { OperationLine, Switch, useManage } from './manage';
import { factsOf } from './operation';
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

type Change = Extract<PluginsAction, 'update' | 'uninstall' | 'enable' | 'disable'>;
const useAsking = (identity: PluginIdentity) => {
  const { ask } = useManage();
  const target = identity.representative;
  return (action: Change) => ask(installedKey(target), requestFor(action, { plugin: target.id, scope: scopeOfRow(target.scope) }, null));
};

function RowMenu({ identity, name, busy }: { identity: PluginIdentity; name: string; busy: boolean }) {
  const asking = useAsking(identity);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={L.moreActions(name)}
          title={L.more}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active"
        >
          <MoreIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float">
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

// Where a plugin with nothing to change from this session is managed: its other project by name, or how many there are
// with their names as the tooltip. A row shows no absolute path anywhere, its attributes included (acceptance 2).
function managedWords(identity: PluginIdentity): { text: string; title?: string } | null {
  const projects = [...new Set(identity.installations.filter((p) => p.projectPath !== null && !p.here).map((p) => p.projectPath!))];
  if (projects.length === 0) return null;
  return projects.length === 1 ? { text: L.managedIn(basename(projects[0])) } : { text: L.managedInMany(projects.length), title: [...new Set(projects.map(basename))].join('\n') };
}

// Why the switch is greyed: where the plugin is managed, as the detail's chips say it (./detail.ts, `chipManagedWords`).
function managedReason(identity: PluginIdentity, managed: { text: string } | null): string {
  if (managed !== null) return L.whereManaged(managed.text);
  return identity.representative.scope === 'synced' ? L.syncedThere : L.yoursThere;
}

// A click inside the row opens the detail unless it landed on a control of its own (React carries a portalled menu
// item's click through the row too).
const ownControl = (target: EventTarget): boolean => target instanceof Element && target.closest('button:not([data-row-open]), a, [role="menuitem"]') !== null;

// `iconUrl`: the directory's icon of this plugin, from the list's one read (`usePluginIcons`); null for its tile.
// `kindWord`: under Customize's All (UX wave U11c, §E), "Plugin" between the version and the switch, the menu last, as
// a mod's row ends (the M4 picture review: the version and the kind word in every kind's columns).
export function PluginRow({ identity, now, iconUrl, onOpen, kindWord = false }: { identity: PluginIdentity; now: number; iconUrl: string | null; onOpen(id: string): void; kindWord?: boolean }) {
  const { ops } = useManage();
  const target = identity.representative;
  const key = installedKey(target);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  const discovered = ops.entries.has(key) ? undefined : [...ops.entries.entries()].find(([opKey, entry]) => opKey.startsWith(CATALOG_KEY) && factsOf(entry).action === 'install' && factsOf(entry).target === identity.id)?.[0];
  const name = displayNameOf(identity.name, identity.manifest);
  const manifest = identity.manifest;
  const skills = manifest?.state === 'read' ? manifest.components.skills.length : 0;
  const updated = updatedOf(identity);
  const date = dateWords(updated, now);
  const noteWords = [manifest?.description ?? (skills > 0 ? L.skills(skills) : null), date && L.updated(date.text)].filter((part): part is string => part !== null && part !== '');
  const version = versionWords(target.version);
  const actionable = identity.actionable.length > 0;
  const managed = actionable ? null : managedWords(identity);
  const asking = useAsking(identity);
  const rowNote = useRowNote();
  const noted = noteWords.length > 0;
  return (
    <li
      data-plugin-row={identity.id}
      data-plugin-scope={target.scope}
      {...rowNote.rowProps}
      aria-describedby={noted ? rowNote.id : undefined}
      className="relative flex items-center gap-3 border-b border-border px-2 py-2 last:border-b-0 hover:bg-bg-hover"
      onClick={(event) => {
        if (!ownControl(event.target)) onOpen(identity.id);
      }}
    >
      <button type="button" data-row-open aria-label={L.view(name)} aria-describedby={noted ? rowNote.id : undefined} className="absolute inset-0 rounded-sm outline-accent -outline-offset-2 focus-visible:outline-2" />
      <ItemImage kind="plugin" seed={pluginSeedOf(identity.id)} iconUrl={iconUrl} size="row" />
      <div className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-fg" title={identity.id}>
            {name}
          </span>
          {isNew(updated, now) && (
            <span title={L.newTooltip} className={`${BADGE} bg-accent-soft text-accent`}>
              {L.isNew}
            </span>
          )}
        </span>
        {manifest?.author && <span className="truncate text-ui-sm text-fg-muted">{L.by(manifest.author)}</span>}
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
          <OperationLine opKey={discovered ?? key} />
        </div>
      </div>
      {noted && (
        <RowNote note={rowNote} className="pl-14">
          {noteWords.join(' · ')}
        </RowNote>
      )}
      {version !== null && (
        // the word cut (G218, ruled): the version stays at rest at every width, Customize's narrow page included
        <span data-plugin-version className="relative shrink-0 text-ui-sm text-fg-muted tabular-nums">
          {version}
        </span>
      )}
      {kindWord && <KindWord kind="plugin" />}
      <Switch checked={identity.enabledHere} label={L.enable(name)} disabled={busy} unavailable={actionable ? null : managedReason(identity, managed)} onClick={() => asking(identity.enabledHere ? 'disable' : 'enable')} />
      <span className="relative inline-flex shrink-0">{actionable ? <RowMenu identity={identity} name={name} busy={busy} /> : <span aria-hidden className="size-7" />}</span>
    </li>
  );
}
