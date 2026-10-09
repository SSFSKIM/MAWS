// Manage marketplaces (P2-B execution document §5.9; Claude Desktop's dialog in its 2.16120.0 bundle, gated off for
// local Code there, readable/app-2.16120.0/web/app/v1/c6a2a31c4-DlHruLy-.js:2593-2675, :2929-3201): a `Sheet` beside the
// frame (E8 D-16), Desktop's medium width, its title and line, one bordered row per marketplace the engine lists (its
// name, its repository, URL or folder beneath, how many of its plugins are installed), each with a ⋮ menu holding Check
// for updates (E8's `marketplace-update`) and Remove… (E8's `marketplace-remove`, whose destructive sheet names the
// installations it uninstalls); the row's operation line beneath it; "No marketplaces added yet." when there are none;
// and Done. Every marketplace the engine lists is a row, `claude-plugins-official` included (Desktop leaves its default
// out; here this is the one place MAWS refreshes or removes it); the built-in directory is never one (the engine lists
// no row for it). E8's confirm sheet stacks above this one and is the binding confirmation. A removed marketplace's
// result stays beneath the rows.
import { DropdownMenu } from 'radix-ui';
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { Sheet } from '../../sessions/Sheet';
import { PRIMARY } from '../../sessions/ui';
import { LIBRARY as L } from '../copy';
import { MoreIcon } from './icons';
import { Gone, OperationLine, useManage } from './manage';
import { requestFor } from './present';
import type { PluginsReadResult } from './read';

export const MARKETPLACE_PREFIX = 'marketplace:';
export const marketplaceKey = (name: string) => `${MARKETPLACE_PREFIX}${name}`;

// The installations a removal of `name` uninstalls (the engine uninstalls every plugin installed from it, 2.1.291).
export const uninstallsOf = (installed: readonly InstalledPlugin[], name: string) => installed.filter((p) => p.marketplace === name).map(({ id, scope, projectPath }) => ({ id, scope, projectPath }));

const ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

function MarketplaceRow({ marketplace, installed }: { marketplace: Marketplace; installed: readonly InstalledPlugin[] }) {
  const { ops, ask } = useManage();
  const key = marketplaceKey(marketplace.name);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  const plugins = new Set(installed.filter((p) => p.marketplace === marketplace.name).map((p) => p.id)).size;
  return (
    <li data-marketplace-row={marketplace.name} data-marketplace-source={marketplace.source} className="flex items-start gap-2 rounded-lg border border-border-strong px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-fg">{marketplace.name}</span>
        {marketplace.locator !== null && <span className="text-ui-sm text-fg-muted [overflow-wrap:anywhere]">{marketplace.locator}</span>}
        {plugins > 0 && <span className="text-ui-sm text-fg-faint">{L.pluginsInstalled(plugins)}</span>}
        <div className="text-ui-sm empty:hidden">
          <OperationLine opKey={key} />
        </div>
      </div>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={L.moreActions(marketplace.name)}
            title={L.moreActions(marketplace.name)}
            disabled={busy}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint data-[state=open]:bg-bg-active"
          >
            <MoreIcon />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float">
            <DropdownMenu.Item className={ITEM} onSelect={() => ask(key, requestFor('marketplace-update', { name: marketplace.name }, marketplace.source))}>
              {L.checkForUpdates}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item className={`${ITEM} text-danger`} onSelect={() => ask(key, requestFor('marketplace-remove', { name: marketplace.name }, marketplace.source, { uninstalls: uninstallsOf(installed, marketplace.name) }))}>
              {L.remove}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}

export function ManageMarketplaces({ marketplaces, installed, onClose }: { marketplaces: PluginsReadResult<{ marketplaces: Marketplace[] }>; installed: readonly InstalledPlugin[]; onClose(): void }) {
  const { ops } = useManage();
  const rows = marketplaces.data?.marketplaces ?? [];
  const listed = new Set(rows.map((m) => marketplaceKey(m.name)));
  const gone = marketplaces.data ? [...ops.entries.keys()].filter((key) => key.startsWith(MARKETPLACE_PREFIX) && !listed.has(key)) : [];
  return (
    <Sheet title={L.manageMarketplaces} width="w-[min(520px,90vw)]" onClose={onClose} data-marketplaces-dialog="manage">
      <div className="flex flex-col gap-3">
        <p className="m-0 -mt-1 text-ui-sm text-fg-muted">{L.manageLine}</p>
        {marketplaces.error !== null && <p className={`m-0 text-ui-sm ${marketplaces.data ? 'text-warning' : 'text-danger'}`}>{marketplaces.error}</p>}
        {marketplaces.data &&
          (rows.length === 0 ? (
            <p className="m-0 py-4 text-ui-sm text-fg-muted">{L.noMarketplaces}</p>
          ) : (
            <ul aria-label={L.manageMarketplaces} className="m-0 flex max-h-[50vh] list-none flex-col gap-2 overflow-y-auto p-0">
              {rows.map((marketplace) => (
                <MarketplaceRow key={marketplace.name} marketplace={marketplace} installed={installed} />
              ))}
            </ul>
          ))}
        {gone.map((key) => (
          <Gone key={key} opKey={key} name={key.slice(MARKETPLACE_PREFIX.length)} data={{ 'data-marketplace-result': key.slice(MARKETPLACE_PREFIX.length) }} />
        ))}
        <div className="flex justify-end">
          <button type="button" autoFocus className={PRIMARY} onClick={onClose}>
            {L.done}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
