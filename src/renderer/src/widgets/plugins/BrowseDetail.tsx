// A Browse card's detail (P2-B execution document §5.8): it replaces the grid (Back or ⌘[ returns to it as it was) with
// the plugin as its source offers it: the icon tile, the name, the credit, the version when the listing has one and the
// count when the engine supplies one; "Installed in other projects" when only other projects have it; "Also listed in
// <marketplace>" for a folded card; Install (E8's install sheet, whose scope is chosen there); and the Overview's
// description and What's inside, read (§5.5) from the files a marketplace's clone holds for it, from its installed copy
// when another project has it, or else "What's inside is listed once it is installed". Plain text throughout: a
// plugin's words never become a link or an action. A card installed for the user or here opens its My items detail
// instead (`PluginDetail`).
import { useEffect, useRef } from 'react';
import { LIBRARY as L } from '../copy';
import { installCountWords, isInstalledHere, titleOf, type BrowseCard } from './browse';
import { availableKey, InstallButton } from './BrowseCard';
import { PluginGlyph } from './icons';
import { manifestKeyOf } from './library';
import { OperationLine, useManage } from './manage';
import { usePluginManifests } from './manifests';
import { BackButton, backOnChord, ReadFailed } from './PluginDetail';
import { InsideSummary, InsideTabs } from './WhatsInside';

export function BrowseDetail({ card, onBack }: { card: BrowseCard; onBack(): void }) {
  const { cwd } = useManage();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.focus(), []); // the detail takes the keyboard (⌘[, Tab to Back) where it opens

  // what the offer's files say, when a marketplace's clone holds them; another project's installed copy otherwise
  const offered = card.inventoryFrom === null ? null : ({ kind: 'available', pluginId: card.inventoryFrom } as const);
  const own = usePluginManifests(cwd === '' ? null : cwd, offered ? [offered] : []);
  const view = offered ? (own.views.get(manifestKeyOf(offered)) ?? null) : (card.installed?.identity.manifest ?? null);
  const title = titleOf(card);
  const byline = [L.from(card.marketplace), card.version, card.installCount === null ? null : L.installs(installCountWords(card.installCount))].filter((part): part is string => part !== null);
  const description = card.description ?? view?.description ?? null;

  return (
    <div ref={root} tabIndex={-1} data-browse-detail={card.pluginId} className="flex min-h-0 flex-1 flex-col outline-none" onKeyDown={backOnChord(onBack)}>
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-3 pb-3">
        <BackButton to={L.browse} onBack={onBack} />
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-active text-fg-muted">
            <PluginGlyph className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h3 className="m-0 truncate text-prose font-semibold text-fg" title={card.pluginId}>
              {title}
            </h3>
            <p className="m-0 truncate text-ui-sm text-fg-muted">{byline.join(' · ')}</p>
          </div>
          {!isInstalledHere(card) && <InstallButton card={card} />}
        </div>
        {(card.installed !== null || card.alsoListedIn.length > 0) && (
          <div className="flex flex-col gap-0.5 text-ui-sm text-fg-muted">
            {card.installed?.where === 'otherProjects' && <p className="m-0">{L.installedElsewhere}</p>}
            {card.alsoListedIn.map((marketplace) => (
              <p key={marketplace} className="m-0">
                {L.alsoListedIn(marketplace)}
              </p>
            ))}
          </div>
        )}
        <div className="text-ui-sm empty:hidden">
          <OperationLine opKey={availableKey(card.pluginId)} />
        </div>
      </div>
      <InsideTabs
        label={title}
        view={view}
        overview={(openTab) => (
          <>
            <p className="m-0 text-ui text-fg [overflow-wrap:anywhere] whitespace-pre-line">{description ?? L.noDescription}</p>
            {offered && own.error !== null && <ReadFailed words={own.error} onRetry={own.retry} />}
            {offered || card.installed ? <InsideSummary view={view} onOpen={openTab} /> : <p className="m-0 text-ui-sm text-fg-muted">{L.insideOnceInstalled}</p>}
          </>
        )}
      />
    </div>
  );
}
