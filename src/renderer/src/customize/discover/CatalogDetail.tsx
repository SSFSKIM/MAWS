// A Discover item's detail (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "A card", "Names",
// "One item per thing", "The trust label"): it stands in the list's place (Back or ⌘[ returns to it as it was) with the
// item as the catalog joined it: the icon, the display name and, when it differs, the name the command installs; who
// published it and the trust label with what it rests on; the count; the route it installs from and "Also listed by …";
// what's inside (each skill by name, each MCP server with how it runs, hooks, commands, agents, a CLI) or "Contents
// shown after install"; the runs-code warning; and + (the install sheet). An item the engine cannot install says why and
// shows its documentation link as text, with no +; a failed scan turns + off with its reason. Plain text throughout.
import { useEffect, useRef } from 'react';
import type { CatalogItem, CatalogTab } from '@shared/ipc/schema/catalog';
import { formatDate } from '@shared/app/date-format';
import { OperationLine } from '../../widgets/plugins/manage';
import { BackButton, backOnChord } from '../../widgets/plugins/PluginDetail';
import { catalogKey } from './add';
import { AddButton, InstalledMark, TrustLabel } from './CatalogCard';
import { CatalogIcon } from './CatalogIcon';
import { DISCOVER as D } from './copy';
import { addable, marketplaceOf, metricWords, runsCodeWords, trustOf } from './present';
import { useCatalogItem } from './read';

export function CatalogDetail({ item: opened, tab, cwd, onBack }: { item: CatalogItem; tab: CatalogTab; cwd: string | null; onBack(): void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.focus(), []);
  // the item as the catalog reads it now, else as it was opened (an install's change may drop and return it)
  const read = useCatalogItem(opened.id, cwd);
  const item = read.data ?? opened;
  const metric = metricWords(item);
  const c = item.components;
  const warning = runsCodeWords(item);
  const marketplace = marketplaceOf(item);
  const updated = item.updatedAt && Number.isFinite(Date.parse(item.updatedAt)) ? formatDate(Date.parse(item.updatedAt)) : null;
  const byline = [item.publisher && D.by(item.publisher), metric, updated && D.updatedOn(updated)].filter((part): part is string => Boolean(part));
  return (
    <div ref={root} tabIndex={-1} data-catalog-detail={item.id} className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none" onKeyDown={backOnChord(onBack)}>
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-3 pb-3">
        <BackButton to={D.discover} onBack={onBack} />
        <div className="flex min-w-0 items-start gap-3">
          <CatalogIcon item={item} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h3 className="m-0 truncate text-prose font-semibold text-fg">{item.name}</h3>
            {item.installName && item.installName !== item.name && <p className="m-0 font-mono text-ui-sm text-fg-muted">{D.installName(item.installName)}</p>}
            <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 text-ui-sm text-fg-muted">
              <span className="truncate">{byline.join(' · ')}</span>
              <TrustLabel item={item} />
            </p>
          </div>
          {item.installed === 'here' ? <InstalledMark /> : addable(item) && <AddButton item={item} tab={tab} variant="text" />}
        </div>
        <p data-trust-words className="m-0 text-ui-sm text-fg-muted">
          {trustOf(item).tooltip}
        </p>
        <div className="flex flex-col gap-0.5 text-ui-sm text-fg-muted">
          {item.installed === 'elsewhere' && <p className="m-0">{D.installedElsewhere}</p>}
          {marketplace && <p className="m-0">{D.from(marketplace)}</p>}
          {item.alsoListedBy.length > 0 && <p data-also-listed className="m-0">{D.alsoListedBy(item.alsoListedBy)}</p>}
          {item.install.kind === 'manual' && (
            <>
              <p data-not-installable className="m-0 text-fg">
                {item.install.reason}
              </p>
              {item.install.docsUrl && <p className="m-0 font-mono break-all select-text">{`${D.documentation}: ${item.install.docsUrl}`}</p>}
            </>
          )}
          {item.scanBlocked && <p className="m-0 text-danger">{D.scanBlocked(item.scanBlocked)}</p>}
        </div>
        <div className="text-ui-sm empty:hidden">
          <OperationLine opKey={catalogKey(item)} />
        </div>
      </div>
      <div className="flex flex-col gap-3 px-3 py-3">
        <p className="m-0 text-ui text-fg [overflow-wrap:anywhere] whitespace-pre-line">{item.description ?? ''}</p>
        {warning && (
          <p role="note" data-runs-code className="m-0 rounded-sm border border-warning px-2 py-1 text-ui-sm text-fg">
            {warning}
          </p>
        )}
        <section aria-label={D.whatsInside} className="flex flex-col gap-2">
          <h4 className="m-0 text-ui font-medium text-fg">{D.whatsInside}</h4>
          {c === null ? (
            <p className="m-0 text-ui-sm text-fg-muted">{D.contentsUnknown}</p>
          ) : (
            <dl className="m-0 flex flex-col gap-2 text-ui-sm">
              {c.skills.length > 0 && (
                <div>
                  <dt className="text-fg-muted">{D.skillsHeading}</dt>
                  <dd data-detail-skills className="m-0 font-mono text-fg">
                    {c.skills.join(', ')}
                  </dd>
                </div>
              )}
              {c.mcpServers.length > 0 && (
                <div>
                  <dt className="text-fg-muted">{D.mcpHeading}</dt>
                  {c.mcpServers.map((server) => (
                    <dd key={server.name} className="m-0 text-fg">
                      <span className="font-mono">{server.name}</span> · {D.transport[server.transport]}
                    </dd>
                  ))}
                </div>
              )}
              {c.hooks && <dd className="m-0 text-fg">{D.hooksLine}</dd>}
              {c.commands > 0 && <dd className="m-0 text-fg">{D.commands(c.commands)}</dd>}
              {c.agents > 0 && <dd className="m-0 text-fg">{D.agents(c.agents)}</dd>}
              {c.cli && <dd className="m-0 text-fg">{D.cliLine}</dd>}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}

