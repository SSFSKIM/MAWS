// The library's Add menu (P2-B execution document §5.9): a dropdown at the right of the head, aria-label "Add", holding
// exactly "Add marketplace" and "Manage marketplaces", the entries Claude Desktop's 2.16120.0 bundle defines for them
// (readable/app-2.16120.0/web/app/v1/c4e819c83-BZ4HmSD7.js:185-195; gated off for local Code there). Its cloud entries,
// Upload plugin and Create with Claude, are not drawn. The `/plugins` dialog's menu starts with "Discover plugins"
// (`onDiscover`), which closes it and opens Customize › Discover, the head keeping no button of its own (word cut P655);
// Customize, whose view switch already reaches Discover, passes none.
import { DropdownMenu } from 'radix-ui';
import { IconButton, PlusIcon } from '../../app/IconButton';
import { LIBRARY as L } from '../copy';

export type MarketplaceDialog = 'add' | 'manage';

const ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover';

export function AddMenu({ onOpen, onDiscover = null }: { onOpen(dialog: MarketplaceDialog): void; onDiscover?: (() => void) | null }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={L.add}>
          <PlusIcon />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float">
          {onDiscover && (
            <DropdownMenu.Item data-open-discover className={ITEM} onSelect={onDiscover}>
              {L.discoverPlugins}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className={ITEM} onSelect={() => onOpen('add')}>
            {L.addMarketplace}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} onSelect={() => onOpen('manage')}>
            {L.manageMarketplaces}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
