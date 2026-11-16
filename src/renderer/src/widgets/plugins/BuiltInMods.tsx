// "MAWS mods · Built in", the last group of My items (X20; the P2-C document, §9 and G7; the P2-B execution document
// §5.12). P2-B owns the mount and P2-C this content (the architect's ruling, the interface ledger §6, 2026-10-09): MAWS's
// own default, disableable mods in a session's plugin library, one row per registry entry in the library's row: its name,
// description and version; how its instructions reach this session, in words; the app's switch; this session's override
// (Default, On, Off); what a change still waits for, and the style mismatch. No overflow and no Uninstall: the registry
// is MAWS's, never the engine's. Hidden while the registry is empty or no row matches the library's search. A registry
// main cannot read says so, in main's words. UX wave U11c: Customize's My items, All draws the same rows, with no heading,
// after the plugins (customize/MineAll.tsx).
// UX wave U2b (M7; the execution document, §M, "The switch"; frame 11): in the mods list alone, a row that carries
// `summaries` draws a second line, the summaries' switch: its words and sentence in one label with the control, so the
// whole line is its hit area and the words are its name. Customize's All passes no such switch and draws the row as before.
import type { AppSessionId } from '@shared/graph/ids';
import type { ModRow } from '@shared/mods/registry';
import { Segment } from '../../settings-tab/parts';
import { REPORT } from '../../owner/view/copy'; // UX wave U2b: the view's words
import { ItemImage } from '../../customize/image/ItemImage';
import { KindWord } from '../../customize/KindWord';
import { LIBRARY as L } from '../copy';
import { useBuiltInMods, type BuiltInModsState, type ModRowsRead } from './builtin-mods';
import { Switch } from './manage';
import { GroupHeading } from './PluginRow';

// The mods a search keeps: by name and description (My items' rule for its mods).
export const modsMatching = (rows: readonly ModRow[], search: string): ModRow[] => {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => needle === '' || `${row.name} ${row.description}`.toLowerCase().includes(needle));
};

export function BuiltInMods({ appSessionId, search }: { appSessionId: AppSessionId | null; search: string }) {
  const mods = useBuiltInMods(appSessionId);
  const { read } = mods;
  if (read.state === 'loading') return null;
  if (read.state === 'unavailable')
    return (
      <section aria-label={L.group.builtIn} data-plugins-group="builtIn">
        <GroupHeading label={L.group.builtIn} />
        <ModsUnavailable read={read} />
      </section>
    );
  const rows = modsMatching(read.rows, search);
  if (rows.length === 0) return null;
  return (
    <section aria-label={L.group.builtIn} data-plugins-group="builtIn">
      <GroupHeading label={L.group.builtIn} count={rows.length} />
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <BuiltInModRow key={row.id} row={row} mods={mods} appSessionId={appSessionId} summariesSwitch />
        ))}
      </ul>
    </section>
  );
}

// A registry main cannot read, in main's words (or why a session on another machine cannot read it from here).
export function ModsUnavailable({ read }: { read: Extract<ModRowsRead, { state: 'unavailable' }> }) {
  return (
    <p role="status" data-mods-unavailable="" className="m-0 px-2 py-2 text-ui-sm text-fg-muted [overflow-wrap:anywhere]">
      {read.elsewhere ? read.reason : L.mod.unavailable(read.reason)}
    </p>
  );
}

// One mod's row. UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §E): under Customize's All,
// `kindWord` draws "Mod" before the switch. UX wave U2b (M7): `summariesSwitch`, passed by the mods list alone, draws the
// summaries' switch on a second line where the row carries `summaries`.
export function BuiltInModRow({ row, mods, appSessionId, kindWord = false, summariesSwitch = false }: { row: ModRow; mods: BuiltInModsState; appSessionId: AppSessionId | null; kindWord?: boolean; summariesSwitch?: boolean }) {
  const { failure, setEnabled, setOverride, setFoldSummaries } = mods;
  const summaries = summariesSwitch ? row.summaries : undefined;
  return (
    <li data-mod-row={row.id} className={`flex items-start border-b border-border px-2 py-2 last:border-b-0 ${summaries === undefined ? 'gap-3' : 'flex-wrap gap-x-3 gap-y-2'}`}>
      <ItemImage kind="mod" seed={row.name} iconUrl={null} size="row" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-ui-sm text-fg-muted">
        <span className="flex min-w-0 items-center gap-2 text-ui">
          <span className="truncate font-medium text-fg">{row.name}</span>
          <span className="shrink-0 rounded-sm bg-bg-active px-1.5 text-ui-sm text-fg-muted">{L.builtIn}</span>
        </span>
        <span>{row.description}</span>
        <span data-mod-source={row.source}>{L.mod.source[row.source]}</span>
        {appSessionId !== null && row.perSession !== undefined && (
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <span>{L.mod.session}</span>
            <Segment label={L.mod.sessionOverride(row.name)} value={row.perSession} options={L.mod.override(row.enabled)} onChange={(value) => void setOverride(row.id, value)} />
          </span>
        )}
        {row.pending !== undefined && <span data-mod-pending={row.pending}>{L.mod.pending[row.pending]}</span>}
        {row.mismatch !== undefined && <span role="note">{REPORT.mismatch(row.mismatch.observed, row.mismatch.resolved)}</span>}
        {failure !== null && (
          <span role="alert" className="text-danger [overflow-wrap:anywhere]">
            {L.mod.refused(failure)}
          </span>
        )}
      </div>
      <span className="shrink-0 text-ui-sm text-fg-muted tabular-nums">{L.mod.version(row.version)}</span>
      {kindWord && <KindWord kind="mod" />}
      <Switch checked={row.enabled} label={L.mod.appSwitch(row.name)} disabled={false} onClick={() => void setEnabled(row.id, !row.enabled)} />
      {summaries !== undefined && (
        // the line starts at the row's middle column: past the image (size-9) and the gap
        <label data-mod-summaries="" className="flex min-w-0 basis-full cursor-pointer items-start gap-3 pl-12 text-ui-sm text-fg-muted">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-ui text-fg">{L.mod.summaries.label}</span>
            <span>{L.mod.summaries.sentence}</span>
          </span>
          <Switch checked={summaries} label={L.mod.summaries.label} disabled={false} onClick={() => void setFoldSummaries(!summaries)} />
        </label>
      )}
    </li>
  );
}
