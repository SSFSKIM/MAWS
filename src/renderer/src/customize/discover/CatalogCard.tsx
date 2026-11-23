// One Discover card (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "A card"; the owner's
// reference, Claude Desktop's Customize › Discover): the image (the directory's icon as main's data, else the letter tile; UX wave U11c), the name, "by <publisher>",
// the trust label with its tooltip, two lines of description, the components ("3 skills · MCP server · runs code" or
// "Contents shown after install") and the count where a source has one, and + at the trailing edge. Fixed height, so a
// shelf's cards align. The whole card is one target, "View <name>" (its detail; an item installed here opens it in My
// items); + is its own focus stop. Installed here shows a check in place of + ("Installed" its name and tooltip; word cut
// G278); installed only in another project reads "In another project" and keeps +. A change's operation line sits on the card it was asked from.
// In Discover › All's grid (UX wave U11c M4, §F) the card says its kind, Plugin or Connector, muted, beside its name; a
// card is always drawn as one kind's (`tab`), which decides what its + asks and what its contents say.
import type { CatalogItem, CatalogKindTab } from '@shared/ipc/schema/catalog';
import { IconButton, PlusIcon } from '../../app/IconButton';
import { Tip } from '../../ui/tip';
import { OperationLine, useManage } from '../../widgets/plugins/manage';
import { PAGE } from '../copy';
import { ItemImage } from '../image/ItemImage';
import { catalogSeedOf } from '../image/tile';
import { catalogKey, installRequestOf } from './add';
import { DISCOVER as D } from './copy';
import { addable, cardContentsWords, metricWords, trustOf } from './present';

export const CARD_HEIGHT = 'h-36';
// While a change's line stands on a card, the card grows from that height to hold it (the M4 picture review): the fixed
// height has no room for it beside the byline's two lines and a two-line description.
const CARD_HEIGHT_WITH_LINE = 'min-h-36';

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
export function AddButton({ item, tab, variant = 'icon' }: { item: CatalogItem; tab: CatalogKindTab; variant?: 'icon' | 'text' }) {
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

// An installed item's mark: the check alone, "Installed" its name and tooltip, focusable so the keyboard reaches the
// tooltip (word cut G278).
export function InstalledMark() {
  return (
    <Tip content={D.installed}>
      <span role="img" aria-label={D.installed} tabIndex={0} data-catalog-installed className="inline-flex h-7 shrink-0 items-center rounded-sm text-fg-muted outline-accent focus-visible:outline-2">
        <CheckIcon />
      </span>
    </Tip>
  );
}

export function CatalogCard({ item, tab, kindWord = false, onOpen }: { item: CatalogItem; tab: CatalogKindTab; kindWord?: boolean; onOpen(item: CatalogItem): void }) {
  const { ops } = useManage();
  const lined = ops.entries.has(catalogKey(item));
  const metric = metricWords(item);
  const here = item.installed === 'here';
  const name = (
    <span className="truncate font-medium text-fg" title={item.installName ?? item.name}>
      {item.name}
    </span>
  );
  return (
    <li
      data-catalog-card={item.id}
      data-installed={item.installed}
      data-install-name={item.install.kind === 'plugin' ? item.install.pluginName : undefined}
      data-install-marketplace={item.install.kind === 'plugin' ? item.install.marketplaceName : undefined}
      className={`relative flex ${lined ? CARD_HEIGHT_WITH_LINE : CARD_HEIGHT} min-w-0 flex-col gap-1 rounded-lg border border-border bg-bg-raised p-3 hover:border-border-strong`}
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest('button:not([data-card-open])'))) onOpen(item);
      }}
    >
      <button type="button" data-card-open aria-label={D.view(item.name)} className="absolute inset-0 rounded-lg outline-accent -outline-offset-1 focus-visible:outline-2" />
      <div className="relative flex min-w-0 items-start gap-3">
        <ItemImage kind={item.kind} seed={catalogSeedOf(item)} iconUrl={item.iconUrl} size="card" />
        <div className="flex min-w-0 flex-1 flex-col">
          {kindWord ? (
            <span className="flex min-w-0 items-baseline gap-1.5">
              {name}
              <span data-kind-word={item.kind} className="shrink-0 text-ui-sm text-fg-muted">
                {PAGE.kindWord[item.kind]}
              </span>
            </span>
          ) : (
            name
          )}
          {/* the publisher keeps its line and the trust label has its own beneath it, on every card: the description
              then starts at one height across a shelf, and the room a short one leaves is not all above the components
              (the card's height is fixed); the label once wrapped only where it did not fit, so it moved up on a card
              whose words beside the name grew shorter (G278's check, the M4 picture review). A card with no publisher
              keeps the publisher's line, empty, so its label and description stand where its neighbours' do */}
          <span data-catalog-byline className="flex min-w-0 flex-col items-start gap-0.5 text-ui-sm text-fg-muted">
            {item.publisher ? (
              <span data-catalog-publisher title={D.by(item.publisher)} className="max-w-full truncate">
                {D.by(item.publisher)}
              </span>
            ) : (
              <span aria-hidden="true" className="h-[1lh]" />
            )}
            <TrustLabel item={item} />
          </span>
        </div>
        {here ? <InstalledMark /> : addable(item) && <AddButton item={item} tab={tab} />}
      </div>
      {/* one line when the card also says where it is installed, so the byline's two lines still fit the fixed height */}
      <p data-catalog-description="" className={`relative m-0 ${item.installed === 'elsewhere' ? 'line-clamp-1' : 'line-clamp-2'} text-ui-sm text-fg-muted [overflow-wrap:anywhere]`}>{item.description ?? ''}</p>
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
