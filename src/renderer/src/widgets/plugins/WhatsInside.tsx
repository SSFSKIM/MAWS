// What's inside a plugin (P2-B execution document §5.7; Claude Desktop's summary and tabs,
// readable/app-2.16120.0/web/app/v1/c24c8737b-BY-86Rbf.js:1975-2028, :2887-3042, :4002-4076, the summary a gated variant
// there): the Overview's summary, one entry per non-empty kind in Desktop's order ("Skills · 5", up to three names, "and
// N more", one line on what the kind is), each opening its tab; and a tab's list, each item's name and description.
// Everything drawn is plain text from the host's redacted answer (names, kinds and counts; §5.5), so a plugin's words
// can never become a link or an action. No README (Desktop renders none).
import type { PluginManifestView } from '@shared/ipc/schema/plugins';
import { LIBRARY as L } from '../copy';
import { insideItems, insideSummary, type InsideKind } from './detail';

type Components = PluginManifestView['components'];

// The summary, or what stands for it: the plugin's files not on disk, not read, read only in part.
export function InsideSummary({ view, onOpen }: { view: PluginManifestView | null; onOpen(kind: InsideKind): void }) {
  if (view === null) return null; // still reading
  if (view.state === 'missing') return <Note>{L.missing}</Note>;
  if (view.state === 'unknown') return <Note>{L.unread}</Note>;
  const rows = insideSummary(view.components);
  if (rows.length === 0 && !view.partial) return null;
  return (
    <section aria-label={L.whatsInside} className="flex flex-col gap-2">
      <h4 className="m-0 text-ui font-semibold text-fg">{L.whatsInside}</h4>
      {rows.length > 0 && (
        <ul className="m-0 list-none rounded-md border border-border p-0">
          {rows.map((row) => (
            <li key={row.kind} data-inside={row.kind} className="flex min-w-0 flex-col gap-0.5 border-b border-border px-3 py-2 last:border-b-0">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <button type="button" onClick={() => onOpen(row.kind)} className="shrink-0 rounded-sm font-medium text-fg outline-accent hover:underline focus-visible:outline-2">
                  {L.kind[row.kind]} · {row.count}
                </button>
                {row.names.length > 0 && <span className="min-w-0 truncate text-ui-sm text-fg-muted">· {row.names.join(', ')}</span>}
                {row.more > 0 && <span className="shrink-0 text-ui-sm text-fg-muted">{L.more(row.more)}</span>}
              </span>
              <span className="truncate text-ui-sm text-fg-faint">{L.kindLine[row.kind]}</span>
            </li>
          ))}
        </ul>
      )}
      {view.partial && <Note>{L.partial}</Note>}
    </section>
  );
}

// One kind's tab: its items, the name (a slash name for skills and commands) and the description beneath.
export function InsideList({ components, kind }: { components: Components; kind: InsideKind }) {
  const items = insideItems(components, kind);
  return (
    <div className="flex flex-col gap-2">
      {kind === 'skills' && <p className="m-0 text-ui-sm text-fg-muted">{L.skillsHelper}</p>}
      <ul aria-label={L.kind[kind]} className="m-0 list-none rounded-md border border-border p-0">
        {items.map((item, i) => (
          <li key={`${item.name}:${i}`} className="flex min-w-0 flex-col gap-0.5 border-b border-border px-3 py-2 last:border-b-0">
            <span className={`min-w-0 [overflow-wrap:anywhere] text-fg ${kind === 'skills' || kind === 'commands' ? 'font-mono text-code' : 'font-medium'}`}>{item.name}</span>
            {item.description && <span className="text-ui-sm text-fg-muted [overflow-wrap:anywhere]">{item.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const Note = ({ children }: { children: string }) => <p className="m-0 text-ui-sm text-fg-muted">{children}</p>;
