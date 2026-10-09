// A card of Browse (P2-B execution document §5.8; the bundle's newer Discover cards, readable/app-2.16120.0/web/app/v1/
// ccea1f474-BHx9TdZi.js:1961-2049, and the directory browser's card, ca0e5677a-CC0fQ6mk.js:15-140): the icon tile, the
// display name, the credit "from <marketplace>" and the count "12.3K installs" when the engine supplies one, two lines
// of description, and at the trailing edge Install (E8's install sheet; the scope is chosen there, user by default) or
// the installed state: "Installed" with a check for a plugin installed for the user or here, or "Installed in other
// projects" beside Install when only other projects have it. The whole card is one target, "View <name>", opening its
// detail (an installed one's My items detail); Install keeps its own click. A change's operation line sits on the card
// it was asked from, keyed by the card's install target (E8's `available:<id>`), so the card that turns installed keeps it.
import { LIBRARY as L } from '../copy';
import { installCountWords, titleOf, type BrowseCard as Card } from './browse';
import { PluginGlyph } from './icons';
import { OperationLine, useManage } from './manage';
import { requestFor } from './present';

export const AVAILABLE_PREFIX = 'available:';
export const availableKey = (id: string) => `${AVAILABLE_PREFIX}${id}`;

const INSTALL = 'inline-flex h-7 shrink-0 items-center rounded-md border border-border-strong px-2.5 text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

// Install, for a card not installed here: E8's install sheet for the card's own id (the directory's when folded).
export function InstallButton({ card }: { card: Card }) {
  const { ops, ask } = useManage();
  const key = availableKey(card.pluginId);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  return (
    <button type="button" className={INSTALL} disabled={busy} onClick={() => ask(key, requestFor('install', { plugin: card.pluginId, scope: 'user' }, null))}>
      {L.install}
    </button>
  );
}

export function BrowseCard({ card, onOpen }: { card: Card; onOpen(card: Card): void }) {
  const title = titleOf(card);
  const here = card.installed?.where === 'here';
  const elsewhere = card.installed?.where === 'otherProjects';
  return (
    <li
      data-browse-card={card.pluginId}
      data-installed={card.installed?.where ?? 'no'}
      data-section={card.section}
      className="relative flex h-full min-w-0 flex-col gap-2 rounded-lg border border-border bg-bg p-3 hover:border-border-strong"
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest('button:not([data-card-open])'))) onOpen(card);
      }}
    >
      <button type="button" data-card-open aria-label={L.view(title)} className="absolute inset-0 rounded-lg outline-accent -outline-offset-1 focus-visible:outline-2" />
      <div className="relative flex min-w-0 items-center gap-3">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg-active text-fg-muted">
          <PluginGlyph className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium text-fg" title={card.pluginId}>
            {title}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-ui-sm text-fg-muted">
            <span className="truncate">{L.from(card.marketplace)}</span>
            {card.installCount !== null && (
              <>
                <span aria-hidden>·</span>
                <span data-install-count className="shrink-0 tabular-nums">
                  {L.installs(installCountWords(card.installCount))}
                </span>
              </>
            )}
          </span>
        </div>
        {here ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-ui-sm text-fg-muted">
            <CheckIcon />
            {L.installed}
          </span>
        ) : (
          <InstallButton card={card} />
        )}
      </div>
      <p className="relative m-0 line-clamp-2 text-ui-sm text-fg-muted [overflow-wrap:anywhere]">{card.description ?? L.noDescription}</p>
      {elsewhere && <p className="relative m-0 text-ui-sm text-fg-faint">{L.installedElsewhere}</p>}
      <div className="relative text-ui-sm empty:hidden">
        <OperationLine opKey={availableKey(card.pluginId)} />
      </div>
    </li>
  );
}
