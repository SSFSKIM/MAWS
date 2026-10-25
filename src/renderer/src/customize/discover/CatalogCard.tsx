// One Discover card (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "A card"; the owner's
// reference, Claude Desktop's Customize › Discover): the icon (main's data, else a monogram), the name, "by <publisher>",
// the trust label with its tooltip, two lines of description, the components ("3 skills · MCP server · runs code" or
// "Contents shown after install") and the count where a source has one, and + at the trailing edge. Fixed height, so a
// shelf's cards align. The whole card is one target, "View <name>" (its detail; an item installed here opens it in My
// items); + is its own focus stop. Installed here reads "Installed" in place of +; installed only in another project
// reads "Installed in another project" and keeps +. A change's operation line sits on the card it was asked from.
import type { CatalogItem, CatalogTab } from '@shared/ipc/schema/catalog';
import { IconButton, PlusIcon } from '../../app/IconButton';
import { OperationLine, useManage } from '../../widgets/plugins/manage';
import { catalogKey, installRequestOf } from './add';
import { CatalogIcon } from './CatalogIcon';
import { DISCOVER as D } from './copy';
import { addable, cardContentsWords, metricWords, trustOf } from './present';

export const CARD_HEIGHT = 'h-36';

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

/** The trust label: a quiet pill whose tooltip says what the label rests on. */
export function TrustLabel({ item }: { item: CatalogItem }) {
  const trust = trustOf(item);
  return (
    <span data-trust={trust.label} data-trust-tooltip={trust.tooltip} title={trust.tooltip} className="shrink-0 rounded-sm border border-border px-1 text-ui-sm leading-4 text-fg-muted">
      {trust.label}
    </span>
  );
}

/** + for an item: the install sheet for its chosen route; disabled while its change runs. */
export function AddButton({ item, tab, variant = 'icon' }: { item: CatalogItem; tab: CatalogTab; variant?: 'icon' | 'text' }) {
  const { ops, ask } = useManage();
  const key = catalogKey(item);
  const request = installRequestOf(item, tab);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  if (request === null) return null;
  const open = () => ask(key, request);
  if (variant === 'text')
    return (
      <button type="button" data-catalog-add disabled={busy} onClick={open} className="inline-flex h-7 shrink-0 items-center rounded-md border border-fg bg-fg px-3 text-ui text-bg outline-accent hover:bg-fg-muted focus-visible:outline-2 disabled:border-fg-faint disabled:bg-fg-faint">
        {D.add}
      </button>
    );
  return (
    <IconButton label={D.addName(item.name)} data-catalog-add disabled={busy} onClick={open} className="border border-border bg-bg">
      <PlusIcon />
    </IconButton>
  );
}

export function InstalledMark() {
  return (
    <span data-catalog-installed className="inline-flex h-7 shrink-0 items-center gap-1 text-ui-sm text-fg-muted">
      <CheckIcon />
      {D.installed}
    </span>
  );
}

export function CatalogCard({ item, tab, onOpen }: { item: CatalogItem; tab: CatalogTab; onOpen(item: CatalogItem): void }) {
  const metric = metricWords(item);
  const here = item.installed === 'here';
  return (
    <li
      data-catalog-card={item.id}
      data-installed={item.installed}
      data-install-name={item.install.kind === 'plugin' ? item.install.pluginName : undefined}
      data-install-marketplace={item.install.kind === 'plugin' ? item.install.marketplaceName : undefined}
      className={`relative flex ${CARD_HEIGHT} min-w-0 flex-col gap-1 rounded-lg border border-border bg-bg-raised p-3 hover:border-border-strong`}
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest('button:not([data-card-open])'))) onOpen(item);
      }}
    >
      <button type="button" data-card-open aria-label={D.view(item.name)} className="absolute inset-0 rounded-lg outline-accent -outline-offset-1 focus-visible:outline-2" />
      <div className="relative flex min-w-0 items-start gap-3">
        <CatalogIcon item={item} size="md" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-fg" title={item.installName ?? item.name}>
            {item.name}
          </span>
          {/* the publisher keeps its line: the trust label wraps beneath it when both do not fit, into the room a
              two-line description leaves above the components (the card's height is fixed) */}
          <span data-catalog-byline className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ui-sm text-fg-muted">
            {item.publisher && (
              <span data-catalog-publisher title={D.by(item.publisher)} className="max-w-full truncate">
                {D.by(item.publisher)}
              </span>
            )}
            <TrustLabel item={item} />
          </span>
        </div>
        {here ? <InstalledMark /> : addable(item) && <AddButton item={item} tab={tab} />}
      </div>
      {/* one line when the card also says where it is installed, so a wrapped byline still fits the fixed height */}
      <p className={`relative m-0 ${item.installed === 'elsewhere' ? 'line-clamp-1' : 'line-clamp-2'} text-ui-sm text-fg-muted [overflow-wrap:anywhere]`}>{item.description ?? ''}</p>
      <p className="relative m-0 mt-auto flex min-w-0 items-center gap-1.5 text-ui-sm text-fg-faint">
        <span data-catalog-components className="truncate">
          {cardContentsWords(item, tab)}
        </span>
        {metric && (
          <>
            <span aria-hidden>·</span>
            <span data-catalog-metric className="shrink-0 tabular-nums">
              {metric}
            </span>
          </>
        )}
      </p>
      {item.installed === 'elsewhere' && <p className="relative m-0 truncate text-ui-sm text-fg-faint">{D.installedElsewhere}</p>}
      <div className="relative truncate text-ui-sm empty:hidden">
        <OperationLine opKey={catalogKey(item)} />
      </div>
    </li>
  );
}
